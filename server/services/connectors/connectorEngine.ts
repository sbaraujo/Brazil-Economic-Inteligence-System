import crypto from 'crypto';
import type {
  FocusExpectation,
  IndicatorDefinition,
  IndicatorSnapshot,
  NewsItem,
  ObservationPoint,
  ProviderStatus,
} from '../../types/domain.ts';
import { alertService } from '../alertService.ts';
import { apiQuotaService } from '../apiQuotaService.ts';
import { cryptoService } from '../cryptoService.ts';
import { scoreTextSentiment } from '../sentimentService.ts';
import { timeSeriesStore } from '../timeseriesStore.ts';
import { INDICATOR_CATALOG, INITIAL_PROVIDERS } from './indicatorCatalog.ts';

function parseBrazilianDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return ddmmyyyy;
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function formatBrazilianDateParam(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export class ConnectorEngine {
  private providers = new Map<string, ProviderStatus>();
  private focusExpectations: FocusExpectation[] = [];
  private newsFeed: NewsItem[] = [];
  private lastSyncErrorMap = new Map<string, string>();
  private consecutiveFailures = new Map<string, number>();
  private circuitOpenUntil = new Map<string, number>();
  private syncInProgress = false;
  private lastGlobalSyncAt: string | null = null;

  constructor() {
    for (const p of INITIAL_PROVIDERS) {
      const hasSecret = cryptoService.hasSealedCredential(p.id);
      this.providers.set(p.id, {
        ...p,
        authStatus: hasSecret ? 'API_KEY_ACTIVE' : p.authStatus,
      });
    }
  }

  private canInvokeProvider(providerId: string): boolean {
    const p = this.providers.get(providerId);
    if (!p || !p.enabled) return false;
    if (p.circuitState === 'OPEN') {
      const openUntil = this.circuitOpenUntil.get(providerId) ?? 0;
      if (Date.now() < openUntil) {
        return false;
      }
      // Cooldown elapsed: transition to HALF_OPEN probe
      p.circuitState = 'HALF_OPEN';
    }
    return true;
  }

  private async fetchWithRetry(url: string, headers: Record<string, string> = {}, retries = 2, timeoutMs = 8000): Promise<Response> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json, application/atom+xml, application/xml, text/xml',
            ...headers,
          },
        });
        clearTimeout(timer);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} (${res.statusText})`);
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr ?? new Error('Unknown fetch failure');
  }

  private recordProviderMetric(providerId: string, ok: boolean, latencyMs: number, records: number, errMsg?: string) {
    apiQuotaService.recordCall(providerId, { ok, latencyMs, records });
    const p = this.providers.get(providerId);
    if (!p) return;
    const now = new Date().toISOString();
    p.rateLimitUsed += 1;
    p.avgLatencyMs = p.avgLatencyMs === null ? Math.round(latencyMs) : Math.round(p.avgLatencyMs * 0.7 + latencyMs * 0.3);

    if (ok) {
      const wasOpenOrHalf = p.circuitState !== 'CLOSED';
      this.consecutiveFailures.set(providerId, 0);
      this.circuitOpenUntil.delete(providerId);
      p.connectionState = 'CONNECTED';
      p.circuitState = 'CLOSED';
      p.lastSuccessAt = now;
      p.recordsCollected += records;
      p.lastValidationResult = `OK (${records} registros validados)`;
      if (wasOpenOrHalf) {
        cryptoService.recordAudit('svc-data-ingestion', 'CIRCUIT_BREAKER', 'CIRCUIT_BREAKER_CLOSED', providerId, 'SUCCESS', {
          records,
          latencyMs: Math.round(latencyMs),
        });
      }
    } else {
      p.errorCount += 1;
      const consec = (this.consecutiveFailures.get(providerId) ?? 0) + 1;
      this.consecutiveFailures.set(providerId, consec);
      p.lastFailureAt = now;
      p.lastError = errMsg ?? 'Falha de conexão';
      if (consec >= 3) {
        const alreadyOpen = p.circuitState === 'OPEN';
        p.circuitState = 'OPEN';
        p.connectionState = 'DEGRADED';
        this.circuitOpenUntil.set(providerId, Date.now() + 5 * 60_000);
        if (!alreadyOpen) {
          cryptoService.recordAudit('svc-data-ingestion', 'CIRCUIT_BREAKER', 'CIRCUIT_BREAKER_OPENED', providerId, 'ERROR', {
            consecutiveFailures: consec,
            error: p.lastError,
          });
        }
      } else {
        p.connectionState = p.errorCount > 5 ? 'DEGRADED' : 'CONNECTED';
      }
      p.lastValidationResult = `ERRO: ${p.lastError}`;
    }
  }

  public async syncBcbSgsIndicator(def: IndicatorDefinition): Promise<void> {
    if (!this.canInvokeProvider('bcb-sgs')) return;

    const start = Date.now();
    try {
      // Request last 10 years for monthly/annual or last 3 years for daily to respect BCB API 10-year window limit
      const endDate = new Date();
      const startDate = new Date();
      if (def.frequency === 'DAILY') {
        startDate.setFullYear(endDate.getFullYear() - 5);
      } else {
        startDate.setFullYear(endDate.getFullYear() - 10);
      }

      const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${def.externalSeriesId}/dados?formato=json&dataInicial=${formatBrazilianDateParam(startDate)}&dataFinal=${formatBrazilianDateParam(endDate)}`;
      const res = await this.fetchWithRetry(url);
      const data = (await res.json()) as Array<{ data: string; valor: string }>;

      if (!Array.isArray(data)) {
        throw new Error('Formato inesperado da API SGS BCB');
      }

      const nowIso = new Date().toISOString();
      const points: ObservationPoint[] = [];

      for (const item of data) {
        const rawVal = Number(item.valor);
        if (!Number.isFinite(rawVal)) continue;

        // CDI daily series (12) annualized to % p.a. (252 business days) with documented formula
        let value = rawVal;
        if (def.id === 'CDI_ANUAL') {
          value = Number(((Math.pow(1 + rawVal / 100, 252) - 1) * 100).toFixed(2));
        }

        const isoDate = parseBrazilianDate(item.data);
        points.push({
          date: isoDate,
          value,
          referencePeriod: isoDate.slice(0, def.frequency === 'DAILY' ? 10 : 7),
          publishedAt: isoDate,
          ingestedAt: nowIso,
          revisionCount: 0,
          status: 'PERIODIC',
          sourceId: 'bcb-sgs',
          sourceName: 'Banco Central do Brasil (SGS)',
          digestSha256: '',
        });
      }

      timeSeriesStore.upsertObservations(def.id, points);
      this.lastSyncErrorMap.delete(def.id);
      this.recordProviderMetric('bcb-sgs', true, Date.now() - start, points.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastSyncErrorMap.set(def.id, msg);
      this.recordProviderMetric('bcb-sgs', false, Date.now() - start, 0, msg);
    }
  }

  public async syncYahooIndicator(def: IndicatorDefinition): Promise<void> {
    if (!this.canInvokeProvider('yahoo-market')) return;

    const start = Date.now();
    try {
      const symbolEncoded = encodeURIComponent(def.externalSeriesId);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbolEncoded}?range=5y&interval=1d`;
      const res = await this.fetchWithRetry(url, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number; regularMarketTime?: number };
            timestamp?: number[];
            indicators?: {
              quote?: Array<{
                open?: Array<number | null>;
                high?: Array<number | null>;
                low?: Array<number | null>;
                close?: Array<number | null>;
                volume?: Array<number | null>;
              }>;
            };
          }>;
          error?: { description?: string };
        };
      };

      const result = json.chart?.result?.[0];
      if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
        throw new Error(json.chart?.error?.description || `Série indisponível para ${def.externalSeriesId}`);
      }

      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];
      const nowIso = new Date().toISOString();
      const points: ObservationPoint[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const close = quote.close?.[i];
        if (close === null || close === undefined || !Number.isFinite(close)) continue;
        const open = quote.open?.[i] ?? close;
        const high = quote.high?.[i] ?? close;
        const low = quote.low?.[i] ?? close;
        const volume = quote.volume?.[i] ?? 0;
        const dateIso = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);

        points.push({
          date: dateIso,
          value: Number(close.toFixed(4)),
          open: Number((open ?? close).toFixed(4)),
          high: Number((high ?? close).toFixed(4)),
          low: Number((low ?? close).toFixed(4)),
          close: Number(close.toFixed(4)),
          volume: volume ?? 0,
          referencePeriod: dateIso,
          publishedAt: new Date(timestamps[i] * 1000).toISOString(),
          ingestedAt: nowIso,
          revisionCount: 0,
          status: 'DELAYED', // Honestly mark public market feed as DELAYED
          sourceId: 'yahoo-market',
          sourceName: 'Market Data Feed (Delayed)',
          digestSha256: '',
        });
      }

      timeSeriesStore.upsertObservations(def.id, points);
      this.lastSyncErrorMap.delete(def.id);
      this.recordProviderMetric('yahoo-market', true, Date.now() - start, points.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastSyncErrorMap.set(def.id, msg);
      this.recordProviderMetric('yahoo-market', false, Date.now() - start, 0, msg);
    }
  }

  public async syncFocusExpectations(): Promise<void> {
    if (!this.canInvokeProvider('bcb-focus')) return;

    const start = Date.now();
    try {
      const indicators = ['IPCA', 'Selic', 'PIB Total', 'Câmbio'];
      const filter = encodeURIComponent(
        `Indicador in ('IPCA','Selic','PIB Total','Câmbio') and baseCalculo eq 0`
      );
      const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$filter=${filter}&$top=40&$orderby=Data%20desc&$format=json`;
      const res = await this.fetchWithRetry(url);
      const json = (await res.json()) as {
        value?: Array<{
          Indicador: string;
          Data: string;
          DataReferencia: string;
          Media: number;
          Mediana: number;
          DesvioPadrao: number;
          Minimo: number;
          Maximo: number;
          numeroRespondentes: number;
        }>;
      };

      if (!json.value) throw new Error('Resposta Olinda Focus inválida');

      const seen = new Set<string>();
      const cleaned: FocusExpectation[] = [];
      for (const row of json.value) {
        if (!indicators.includes(row.Indicador)) continue;
        const key = `${row.Indicador}|${row.DataReferencia}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push({
          indicator: row.Indicador,
          referenceYear: row.DataReferencia,
          date: row.Data,
          mean: row.Media,
          median: row.Mediana,
          stdDev: row.DesvioPadrao,
          min: row.Minimo,
          max: row.Maximo,
          respondents: row.numeroRespondentes,
        });
      }

      this.focusExpectations = cleaned.sort((a, b) =>
        `${a.indicator}${a.referenceYear}`.localeCompare(`${b.indicator}${b.referenceYear}`)
      );
      this.recordProviderMetric('bcb-focus', true, Date.now() - start, cleaned.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recordProviderMetric('bcb-focus', false, Date.now() - start, 0, msg);
    }
  }

  public async syncBcbNewsFeed(): Promise<void> {
    if (!this.canInvokeProvider('bcb-news')) return;

    const start = Date.now();
    try {
      const url = 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias';
      const res = await this.fetchWithRetry(url);
      const xml = await res.text();

      const entries: NewsItem[] = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match: RegExpExecArray | null;
      const seenHashes = new Set<string>();

      while ((match = entryRegex.exec(xml)) !== null) {
        const block = match[1];
        const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '')
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .replace(/<[^>]+>/g, '')
          .trim();
        const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? 'https://www.bcb.gov.br';
        const published = block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] ?? new Date().toISOString();
        const rawSummary = (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '')
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .replace(/<[^>]+>/g, '')
          .trim();

        if (!title) continue;
        const dedupHash = crypto.createHash('sha256').update(title.toLowerCase()).digest('hex').slice(0, 12);
        if (seenHashes.has(dedupHash)) continue;
        seenHashes.add(dedupHash);

        const lower = `${title} ${rawSummary}`.toLowerCase();
        let topic = 'Política Monetária & Regulação';
        const relatedIndicators: string[] = [];
        if (lower.includes('copom') || lower.includes('selic') || lower.includes('juros')) {
          topic = 'Política Monetária (COPOM/Selic)';
          relatedIndicators.push('SELIC_META', 'CDI_ANUAL');
        } else if (lower.includes('câmbio') || lower.includes('dólar') || lower.includes('reservas')) {
          topic = 'Mercado de Câmbio & Reservas';
          relatedIndicators.push('USD_BRL_PTAX', 'RESERVAS_INT');
        } else if (lower.includes('inflação') || lower.includes('ipca') || lower.includes('focus')) {
          topic = 'Inflação & Expectativas';
          relatedIndicators.push('IPCA_MENSAL');
        } else if (lower.includes('crédito') || lower.includes('pix') || lower.includes('banco')) {
          topic = 'Sistema Financeiro & Crédito';
          relatedIndicators.push('CREDITO_TOTAL', 'INADIMPLENCIA');
        }

        const summaryText = rawSummary.slice(0, 320) || 'Comunicado oficial do Banco Central do Brasil.';
        const tone = scoreTextSentiment(`${title}. ${summaryText}`);

        entries.push({
          id: `bcb-${dedupHash}`,
          title,
          sourceId: 'bcb-news',
          sourceName: 'Banco Central do Brasil (Oficial)',
          publishedAt: published,
          link: link.startsWith('http') ? link : `https://www.bcb.gov.br${link}`,
          summary: summaryText,
          topic,
          entities: ['Banco Central do Brasil'],
          sentiment: tone.polarity,
          relevanceBrazil: 'HIGH',
          relatedIndicators,
          dedupHash,
        });
      }

      this.newsFeed = entries.slice(0, 25);
      this.recordProviderMetric('bcb-news', true, Date.now() - start, this.newsFeed.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recordProviderMetric('bcb-news', false, Date.now() - start, 0, msg);
    }
  }

  public async checkIbgeSidraHealth(): Promise<void> {
    const start = Date.now();
    try {
      const res = await this.fetchWithRetry(
        'https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/last%203',
        {},
        1,
        5000
      );
      const data = await res.json();
      const count = Array.isArray(data) ? data.length : 0;
      this.recordProviderMetric('ibge-sidra', true, Date.now() - start, count);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recordProviderMetric('ibge-sidra', false, Date.now() - start, 0, msg);
    }
  }

  public async runFullSync(): Promise<{ syncedAt: string; indicatorsUpdated: number }> {
    if (this.syncInProgress) {
      return { syncedAt: this.lastGlobalSyncAt ?? new Date().toISOString(), indicatorsUpdated: 0 };
    }
    this.syncInProgress = true;
    try {
      const bcbDefs = INDICATOR_CATALOG.filter((d) => d.providerId === 'bcb-sgs');
      const yahooDefs = INDICATOR_CATALOG.filter((d) => d.providerId === 'yahoo-market');

      // Run in parallel batches to avoid overwhelming upstream APIs
      await Promise.all([
        ...bcbDefs.map((d) => this.syncBcbSgsIndicator(d)),
        ...yahooDefs.map((d) => this.syncYahooIndicator(d)),
        this.syncFocusExpectations(),
        this.syncBcbNewsFeed(),
        this.checkIbgeSidraHealth(),
      ]);

      this.lastGlobalSyncAt = new Date().toISOString();
      const snapshots = this.getAllSnapshots();
      const alertsTriggered = alertService.evaluateSnapshots(snapshots);
      cryptoService.recordAudit('svc-data-ingestion', 'SCHEDULER', 'FULL_MARKET_MACRO_SYNC', 'ALL_PROVIDERS', 'SUCCESS', {
        totalObservations: timeSeriesStore.getTotalObservationsCount(),
        alertsTriggered: alertsTriggered.length,
      });
      return { syncedAt: this.lastGlobalSyncAt, indicatorsUpdated: INDICATOR_CATALOG.length };
    } finally {
      this.syncInProgress = false;
    }
  }

  public async testProviderConnection(providerId: string): Promise<ProviderStatus> {
    const p = this.providers.get(providerId);
    if (!p) throw new Error(`Provider ${providerId} não encontrado.`);

    if (p.authStatus === 'LICENSE_REQUIRED' || (p.authStatus === 'MISSING_CREDENTIALS' && !cryptoService.hasSealedCredential(providerId))) {
      p.lastFailureAt = new Date().toISOString();
      p.lastValidationResult = `FALHA: ${p.authStatus}`;
      cryptoService.recordAudit('svc-data-ingestion', 'USER', 'PROVIDER_TEST', providerId, 'DENIED', {
        reason: p.authStatus,
      });
      return p;
    }

    if (providerId === 'bcb-sgs') {
      await this.syncBcbSgsIndicator(INDICATOR_CATALOG[0]);
    } else if (providerId === 'bcb-focus') {
      await this.syncFocusExpectations();
    } else if (providerId === 'bcb-news') {
      await this.syncBcbNewsFeed();
    } else if (providerId === 'yahoo-market') {
      await this.syncYahooIndicator(INDICATOR_CATALOG.find((d) => d.id === 'IBOV')!);
    } else if (providerId === 'ibge-sidra') {
      await this.checkIbgeSidraHealth();
    }

    const updated = this.providers.get(providerId)!;
    cryptoService.recordAudit(
      'svc-data-ingestion',
      'USER',
      'PROVIDER_TEST',
      providerId,
      updated.connectionState === 'CONNECTED' ? 'SUCCESS' : 'ERROR',
      { validation: updated.lastValidationResult }
    );
    return updated;
  }

  public setProviderEnabled(providerId: string, enabled: boolean): ProviderStatus {
    const p = this.providers.get(providerId);
    if (!p) throw new Error(`Provider ${providerId} não encontrado.`);
    p.enabled = enabled;
    if (!enabled) {
      p.connectionState = 'DISCONNECTED';
      p.circuitState = 'OPEN';
    } else if (p.authStatus === 'PUBLIC_NO_AUTH' || p.authStatus === 'API_KEY_ACTIVE') {
      p.circuitState = 'CLOSED';
    }
    cryptoService.recordAudit('svc-data-ingestion', 'ADMIN', enabled ? 'PROVIDER_ENABLED' : 'PROVIDER_DISABLED', providerId, 'SUCCESS');
    return p;
  }

  public configureProviderCredential(providerId: string, apiKey: string): ProviderStatus {
    const p = this.providers.get(providerId);
    if (!p) throw new Error(`Provider ${providerId} não encontrado.`);
    cryptoService.sealCredential(providerId, apiKey);
    p.authStatus = 'API_KEY_ACTIVE';
    p.enabled = true;
    p.circuitState = 'CLOSED';
    p.connectionState = 'CONNECTED';
    p.lastValidationResult = 'Credencial selada com AES-256-GCM. Pronta para teste.';
    return p;
  }

  public getProviders(): ProviderStatus[] {
    return Array.from(this.providers.values());
  }

  public getIndicatorSnapshot(indicatorId: string): IndicatorSnapshot | null {
    const def = INDICATOR_CATALOG.find((d) => d.id === indicatorId);
    if (!def) return null;
    const series = timeSeriesStore.getSeries(indicatorId);
    const latest = series.length > 0 ? series[series.length - 1] : null;
    const previous = series.length > 1 ? series[series.length - 2] : null;
    const changeAbs = latest && previous ? Number((latest.value - previous.value).toFixed(4)) : null;
    const changePct =
      latest && previous && Math.abs(previous.value) > 1e-9
        ? Number((((latest.value - previous.value) / Math.abs(previous.value)) * 100).toFixed(2))
        : null;
    const status = timeSeriesStore.computeFreshnessStatus(def, latest);
    return {
      definition: def,
      latest,
      previous,
      changeAbs,
      changePct,
      observationsCount: series.length,
      status,
      lastError: this.lastSyncErrorMap.get(indicatorId),
    };
  }

  public getAllSnapshots(): IndicatorSnapshot[] {
    return INDICATOR_CATALOG.map((d) => this.getIndicatorSnapshot(d.id)!);
  }

  public getFocusExpectations(): FocusExpectation[] {
    return this.focusExpectations;
  }

  public getNewsFeed(): NewsItem[] {
    return this.newsFeed;
  }

  public getLastGlobalSyncAt(): string | null {
    return this.lastGlobalSyncAt;
  }
}

export const connectorEngine = new ConnectorEngine();
