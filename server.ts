import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { aiAnalystService } from './server/services/aiAnalystService.ts';
import { alertService } from './server/services/alertService.ts';
import { apiQuotaService } from './server/services/apiQuotaService.ts';
import { connectorEngine } from './server/services/connectors/connectorEngine.ts';
import { cryptoService } from './server/services/cryptoService.ts';
import { dataQualityEngine } from './server/services/dataQualityEngine.ts';
import { emergingMarketsService } from './server/services/emergingMarketsService.ts';
import { quantEngine, type BacktestStrategy } from './server/services/quantEngine.ts';
import { reportService, type ExportScope, type ReportType } from './server/services/reportService.ts';
import { schedulerService } from './server/services/schedulerService.ts';
import { sentimentService } from './server/services/sentimentService.ts';
import { timeSeriesStore } from './server/services/timeseriesStore.ts';
import type { EncryptedEnvelope } from './server/types/domain.ts';

const PORT = 3000;

// Simple sliding-window rate limiter per IP
const rateBucket = new Map<string, { count: number; resetAt: number }>();
function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'local';
  const now = Date.now();
  const entry = rateBucket.get(ip);
  if (!entry || now > entry.resetAt) {
    rateBucket.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 240) {
    return res.status(429).json({ error: 'Rate limit excedido. Aguarde antes de novas requisições.' });
  }
  return next();
}

function sendE2eeAware(req: Request, res: Response, payload: unknown) {
  const keyId = req.header('x-sygma-e2ee-keyid');
  if (keyId && cryptoService.hasValidSession(keyId)) {
    const envelope = cryptoService.encryptEnvelope(keyId, payload);
    res.setHeader('x-sygma-e2ee-active', 'true');
    return res.json({ e2ee: true, envelope });
  }
  return res.json(payload);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimiter);

  // Security headers (iframe-compatible for AI Studio preview)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Latency instrumentation middleware
  const recentLatencies: number[] = [];
  app.use('/api', (req, res, next) => {
    const t0 = performance.now();
    res.on('finish', () => {
      const dt = performance.now() - t0;
      recentLatencies.push(dt);
      if (recentLatencies.length > 100) recentLatencies.shift();
    });
    next();
  });

  // ==========================================
  // 1. E2EE CRYPTO & HANDSHAKE MICROSERVICE
  // ==========================================
  app.get('/api/v1/crypto/handshake', (_req, res) => {
    res.json(cryptoService.getServerHandshakeMetadata());
  });

  app.post('/api/v1/crypto/session', (req, res) => {
    const schema = z.object({ clientPublicKeySpkiBase64: z.string().min(20) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Chave pública ECDH inválida.' });
    }
    try {
      const session = cryptoService.establishSession(parsed.data.clientPublicKeySpkiBase64);
      return res.json(session);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Falha no handshake E2EE' });
    }
  });

  // Encrypted RPC endpoint for sensitive AI Analyst queries
  app.post('/api/v1/e2ee/ai/analyze', async (req, res) => {
    try {
      const envelope = req.body?.envelope as EncryptedEnvelope | undefined;
      if (!envelope || envelope.version !== 'SYGMA-E2EE-1.0') {
        return res.status(400).json({ error: 'Envelope criptográfico SYGMA-E2EE-1.0 obrigatório.' });
      }
      const decrypted = cryptoService.decryptEnvelope<{
        prompt: string;
        history?: Array<{ role: 'user' | 'model'; text: string }>;
      }>(envelope);
      if (!decrypted.prompt || typeof decrypted.prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt inválido após descriptografia.' });
      }
      const result = await aiAnalystService.askAnalyst(decrypted.prompt, decrypted.history ?? []);
      const responseEnvelope = cryptoService.encryptEnvelope(envelope.keyId, result);
      return res.json({ e2ee: true, envelope: responseEnvelope });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro no serviço AI E2EE' });
    }
  });

  // ==========================================
  // 2. SYSTEM HEALTH & PERFORMANCE TELEMETRY
  // ==========================================
  app.get('/api/v1/health', (req, res) => {
    const quality = dataQualityEngine.evaluateAll();
    const mem = process.memoryUsage();
    const avgLatency =
      recentLatencies.length > 0
        ? Number((recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length).toFixed(2))
        : 0;
    return sendE2eeAware(req, res, {
      ...quality,
      performance: {
        uptimeSeconds: Math.round(process.uptime()),
        avgApiLatencyMs: avgLatency,
        heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
        lastGlobalSyncAt: connectorEngine.getLastGlobalSyncAt(),
      },
      auditVerification: cryptoService.verifyAuditChain(),
      auditEvents: cryptoService.getAuditEvents(25),
      backupStatus: timeSeriesStore.getBackupStatus(),
    });
  });

  // ==========================================
  // 3. DATA INGESTION & INDICATORS MICROSERVICE
  // ==========================================
  app.get('/api/v1/indicators', (req, res) => {
    return sendE2eeAware(req, res, {
      lastGlobalSyncAt: connectorEngine.getLastGlobalSyncAt(),
      snapshots: connectorEngine.getAllSnapshots(),
      focusExpectations: connectorEngine.getFocusExpectations(),
    });
  });

  app.get('/api/v1/indicators/:id/series', (req, res) => {
    const id = req.params.id;
    const snapshot = connectorEngine.getIndicatorSnapshot(id);
    if (!snapshot) {
      return res.status(404).json({ error: `Indicador ${id} não encontrado.` });
    }
    const range = String(req.query.range || 'MAX');
    let series = timeSeriesStore.getSeries(id);
    if (range !== 'MAX' && series.length > 0) {
      const lastTs = Date.parse(series[series.length - 1].date);
      const daysMap: Record<string, number> = {
        '5D': 7,
        '1M': 31,
        '3M': 93,
        '6M': 186,
        '1Y': 366,
        '3Y': 1096,
        '5Y': 1827,
      };
      const days = daysMap[range];
      if (days && !Number.isNaN(lastTs)) {
        const cutoff = lastTs - days * 86400_000;
        series = series.filter((p) => Date.parse(p.date) >= cutoff);
      }
    }

    return sendE2eeAware(req, res, {
      snapshot,
      series,
      technicalAnalysis: quantEngine.computeTechnicalAnalysis(id),
      revisions: timeSeriesStore.getRevisions(id),
    });
  });

  app.post('/api/v1/sync', async (req, res) => {
    try {
      const result = await connectorEngine.runFullSync();
      return sendE2eeAware(req, res, result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro de sincronização' });
    }
  });

  app.get('/api/v1/providers', (req, res) => {
    const providers = connectorEngine.getProviders();
    return sendE2eeAware(req, res, {
      providers,
      quotaSnapshot: apiQuotaService.getQuotaSnapshot(providers),
    });
  });

  app.get('/api/v1/providers/quota', (req, res) => {
    const providers = connectorEngine.getProviders();
    return sendE2eeAware(req, res, apiQuotaService.getQuotaSnapshot(providers));
  });

  app.patch('/api/v1/providers/:id/quota', (req, res) => {
    const schema = z.object({ monthlyQuota: z.number().int().min(100).max(100_000_000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Cota mensal inválida (mínimo 100 requisições).' });
    }
    try {
      apiQuotaService.setMonthlyQuota(req.params.id, parsed.data.monthlyQuota);
      cryptoService.recordAudit('svc-data-ingestion', 'ADMIN', 'API_QUOTA_UPDATED', req.params.id, 'SUCCESS', {
        monthlyQuota: parsed.data.monthlyQuota,
      });
      return sendE2eeAware(req, res, apiQuotaService.getQuotaSnapshot(connectorEngine.getProviders()));
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Provedor não encontrado' });
    }
  });

  app.post('/api/v1/providers/:id/test', async (req, res) => {
    try {
      const updated = await connectorEngine.testProviderConnection(req.params.id);
      return sendE2eeAware(req, res, { provider: updated });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Erro ao testar provedor' });
    }
  });

  app.post('/api/v1/providers/:id/toggle', (req, res) => {
    const schema = z.object({ enabled: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Parâmetro enabled booleano obrigatório.' });
    try {
      const updated = connectorEngine.setProviderEnabled(req.params.id, parsed.data.enabled);
      return sendE2eeAware(req, res, { provider: updated });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Provedor não encontrado' });
    }
  });

  app.post('/api/v1/providers/:id/credentials', (req, res) => {
    const schema = z.object({ apiKey: z.string().min(4).max(512) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Credencial inválida.' });
    try {
      const updated = connectorEngine.configureProviderCredential(req.params.id, parsed.data.apiKey);
      return sendE2eeAware(req, res, { provider: updated });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Provedor não encontrado' });
    }
  });

  // ==========================================
  // 4. QUANTITATIVE, ECONOMETRICS & RISK
  // ==========================================
  app.get('/api/v1/quant/correlation', (req, res) => {
    const xId = String(req.query.x || 'SELIC_META');
    const yId = String(req.query.y || 'IPCA_MENSAL');
    const freq = req.query.freq === 'DAILY' ? 'DAILY' : 'MONTHLY';
    return sendE2eeAware(req, res, quantEngine.analyzeCrossIndicator(xId, yId, freq));
  });

  app.get('/api/v1/quant/matrix', (req, res) => {
    const idsParam = String(
      req.query.ids || 'USD_BRL_PTAX,SELIC_META,IPCA_MENSAL,IBOV,BRENT,VALE3,DIVIDA_BRUTA_PIB,IBC_BR'
    );
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    const freq = req.query.freq === 'DAILY' ? 'DAILY' : 'MONTHLY';
    return sendE2eeAware(req, res, quantEngine.computeCorrelationMatrix(ids, freq));
  });

  app.get('/api/v1/quant/forecast/:id', (req, res) => {
    const steps = Math.min(36, Math.max(3, Number(req.query.steps) || 12));
    return sendE2eeAware(req, res, quantEngine.generateForecast(req.params.id, steps));
  });

  app.get('/api/v1/quant/risk', (req, res) => {
    const seed = Number(req.query.seed) || 20261113;
    const simulations = Math.min(25000, Math.max(1000, Number(req.query.simulations) || 10000));
    return sendE2eeAware(req, res, quantEngine.computeRiskReport(seed, simulations));
  });

  app.get('/api/v1/quant/pulse', (req, res) => {
    return sendE2eeAware(req, res, quantEngine.computeBrazilPulse());
  });

  app.get('/api/v1/quant/stress-heatmap', (req, res) => {
    return sendE2eeAware(req, res, quantEngine.computeMacroStressHeatmap());
  });

  app.get('/api/v1/quant/emerging-markets', async (req, res) => {
    const year = String(req.query.year || 'LATEST');
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    try {
      const report = await emergingMarketsService.getHeatmapReport(year, refresh);
      return sendE2eeAware(req, res, report);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao consultar matriz de Mercados Emergentes',
      });
    }
  });

  app.post('/api/v1/quant/emerging-markets/refresh', async (req, res) => {
    const year = String(req.body?.year || req.query.year || 'LATEST');
    try {
      const report = await emergingMarketsService.getHeatmapReport(year, true);
      return sendE2eeAware(req, res, report);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao atualizar matriz de Mercados Emergentes',
      });
    }
  });

  const validBacktestStrategies: BacktestStrategy[] = [
    'TREND_SMA_CROSSOVER',
    'MEAN_REVERSION_ZSCORE',
    'AR1_WALK_FORWARD',
    'MOMENTUM_REGIME',
  ];

  app.get('/api/v1/quant/backtest', (req, res) => {
    const indicatorId = String(req.query.indicatorId || 'IBOV');
    const rawStrat = String(req.query.strategy || 'TREND_SMA_CROSSOVER') as BacktestStrategy;
    const strategy = validBacktestStrategies.includes(rawStrat) ? rawStrat : 'TREND_SMA_CROSSOVER';
    const range = String(req.query.range || '3Y');
    const costBps = Math.max(0, Math.min(200, Number(req.query.costBps ?? 10)));
    const report = quantEngine.runHistoricalBacktest(indicatorId, strategy, range, costBps);
    return sendE2eeAware(req, res, report);
  });

  app.post('/api/v1/quant/backtest', (req, res) => {
    const schema = z.object({
      indicatorId: z.string().min(2).max(64),
      strategy: z.enum(['TREND_SMA_CROSSOVER', 'MEAN_REVERSION_ZSCORE', 'AR1_WALK_FORWARD', 'MOMENTUM_REGIME']).optional(),
      range: z.enum(['6M', '1Y', '3Y', '5Y', 'MAX']).optional(),
      transactionCostBps: z.number().min(0).max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos para Backtesting Histórico.' });
    }
    const report = quantEngine.runHistoricalBacktest(
      parsed.data.indicatorId,
      parsed.data.strategy ?? 'TREND_SMA_CROSSOVER',
      parsed.data.range ?? '3Y',
      parsed.data.transactionCostBps ?? 10
    );
    return sendE2eeAware(req, res, report);
  });

  // ==========================================
  // 5. WATCHLIST ALERTS MICROSERVICE
  // ==========================================
  app.get('/api/v1/alerts', (req, res) => {
    return sendE2eeAware(req, res, {
      rules: alertService.getRules(),
      alerts: alertService.getTriggeredAlerts(100),
      unreadCount: alertService.getUnreadCount(),
    });
  });

  app.post('/api/v1/alerts/rules', (req, res) => {
    const schema = z.object({
      indicatorId: z.string().min(2).max(64),
      thresholdPct: z.number().min(0.01).max(100),
      direction: z.enum(['BOTH', 'UP', 'DOWN']).optional(),
      cooldownMinutes: z.number().int().min(1).max(1440).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Regra de alerta inválida. Informe indicatorId e thresholdPct (> 0).' });
    }
    const rule = alertService.createRule(parsed.data);
    const triggered = alertService.evaluateSnapshots(connectorEngine.getAllSnapshots());
    return sendE2eeAware(req, res, {
      rule,
      triggered,
      unreadCount: alertService.getUnreadCount(),
    });
  });

  app.patch('/api/v1/alerts/rules/:id', (req, res) => {
    const schema = z.object({
      enabled: z.boolean().optional(),
      thresholdPct: z.number().min(0.01).max(100).optional(),
      direction: z.enum(['BOTH', 'UP', 'DOWN']).optional(),
      cooldownMinutes: z.number().int().min(1).max(1440).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Parâmetros de atualização inválidos.' });
    }
    try {
      const rule = alertService.updateRule(req.params.id, parsed.data);
      return sendE2eeAware(req, res, { rule });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Regra não encontrada' });
    }
  });

  app.delete('/api/v1/alerts/rules/:id', (req, res) => {
    try {
      alertService.deleteRule(req.params.id);
      return sendE2eeAware(req, res, { deleted: true });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Regra não encontrada' });
    }
  });

  app.post('/api/v1/alerts/evaluate', (req, res) => {
    const triggered = alertService.evaluateSnapshots(connectorEngine.getAllSnapshots());
    return sendE2eeAware(req, res, {
      triggered,
      alerts: alertService.getTriggeredAlerts(100),
      unreadCount: alertService.getUnreadCount(),
    });
  });

  app.post('/api/v1/alerts/ack-all', (req, res) => {
    const updated = alertService.acknowledgeAll();
    return sendE2eeAware(req, res, { updated, unreadCount: 0 });
  });

  app.post('/api/v1/alerts/:id/ack', (req, res) => {
    try {
      const alert = alertService.acknowledgeAlert(req.params.id);
      return sendE2eeAware(req, res, { alert, unreadCount: alertService.getUnreadCount() });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Alerta não encontrado' });
    }
  });

  // ==========================================
  // 6. INSTITUTIONAL AUDIT LOGS, EXPORT ENGINE & REPORTS
  // ==========================================
  app.get('/api/v1/audit/logs', (req, res) => {
    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 250));
    const verification = cryptoService.verifyAuditChain();
    return sendE2eeAware(req, res, {
      verification,
      latestHash: cryptoService.getAuditRootHash(),
      events: cryptoService.getAuditEvents(limit),
    });
  });

  app.post('/api/v1/audit/verify', (req, res) => {
    const verification = cryptoService.verifyAuditChain();
    cryptoService.recordAudit(
      'svc-crypto-kms',
      'USER',
      'AUDIT_INTEGRITY_VERIFIED',
      'MERKLE_SHA256_CHAIN',
      verification.valid ? 'SUCCESS' : 'ERROR',
      { totalEvents: verification.totalEvents, valid: verification.valid }
    );
    const updatedVerification = cryptoService.verifyAuditChain();
    return sendE2eeAware(req, res, {
      verifiedAt: new Date().toISOString(),
      verification: updatedVerification,
      latestHash: cryptoService.getAuditRootHash(),
      events: cryptoService.getAuditEvents(250),
    });
  });

  app.get('/api/v1/export/data', (req, res) => {
    const validScopes: ExportScope[] = [
      'SNAPSHOTS',
      'TIMESERIES',
      'MACRO_BCB',
      'MARKETS',
      'RISK_SCENARIOS',
      'FOCUS_PULSE',
      'AUDIT_LOGS',
    ];
    const scopeParam = String(req.query.scope || 'SNAPSHOTS').toUpperCase() as ExportScope;
    const scope = validScopes.includes(scopeParam) ? scopeParam : 'SNAPSHOTS';
    const format = String(req.query.format || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
    const range = String(req.query.range || 'MAX');
    const idsParam = typeof req.query.ids === 'string' && req.query.ids.trim() ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

    const exported = reportService.exportDataset({ scope, format, range, ids: idsParam });
    cryptoService.recordAudit('svc-reports', 'USER', 'DATA_EXPORT_EXECUTED', `${scope}.${format}`, 'SUCCESS', {
      recordCount: exported.recordCount,
      range,
      sha256: exported.sha256.slice(0, 16),
    });

    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('X-Sygma-Sha256', exported.sha256);
    res.setHeader('X-Sygma-Record-Count', String(exported.recordCount));
    return res.send(exported.content);
  });

  app.post('/api/v1/export/view-pdf', async (req, res) => {
    const swotItemSchema = z.object({
      title: z.string().min(1).max(160),
      evidence: z.string().max(240),
      plainLanguage: z.string().max(500),
    });
    const schema = z.object({
      viewTitle: z.string().min(1).max(160),
      activeView: z.string().min(1).max(64),
      language: z.enum(['pt', 'en']).optional(),
      filters: z
        .object({
          categoryFilter: z.string().optional(),
          searchQuery: z.string().optional(),
          selectedIndicatorId: z.string().optional(),
          watchlistIds: z.array(z.string()).optional(),
        })
        .optional(),
      snapshots: z
        .array(
          z.object({
            code: z.string(),
            name: z.string(),
            category: z.string().optional(),
            value: z.number().nullable(),
            unit: z.string(),
            changePct: z.number().nullable(),
            date: z.string().nullable(),
            status: z.string(),
            source: z.string().optional(),
          })
        )
        .optional(),
      tables: z
        .array(
          z.object({
            title: z.string(),
            columns: z.array(z.string()),
            rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
          })
        )
        .optional(),
      swotMatrix: z
        .object({
          strengths: z.array(swotItemSchema),
          weaknesses: z.array(swotItemSchema),
          opportunities: z.array(swotItemSchema),
          threats: z.array(swotItemSchema),
        })
        .optional(),
      includeSwot: z.boolean().optional(),
      includeStressScenarios: z.boolean().optional(),
      userIdentification: z.string().max(160).optional(),
      e2eeSessionId: z.string().max(120).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload de exportação de visualização inválido.' });
    }

    const e2eeSessionId =
      parsed.data.e2eeSessionId?.trim() || req.header('x-sygma-e2ee-keyid') || undefined;
    const userIdentification =
      parsed.data.userIdentification?.trim() ||
      req.header('x-sygma-user-id')?.trim() ||
      (e2eeSessionId ? `Operador Web E2EE (${e2eeSessionId})` : `Operador Web (${req.ip || 'local'})`);

    try {
      const { buffer, sha256 } = await reportService.renderViewSnapshotPdf({
        ...parsed.data,
        userIdentification,
        e2eeSessionId,
      });
      const slug = parsed.data.activeView.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      cryptoService.recordAudit('svc-reports', 'USER', 'VIEW_PDF_EXPORTED', parsed.data.activeView, 'SUCCESS', {
        viewTitle: parsed.data.viewTitle,
        userIdentification,
        sha256: sha256.slice(0, 16),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="sygma_${slug}_institucional.pdf"`);
      res.setHeader('X-Sygma-Sha256', sha256);
      return res.send(buffer);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro ao exportar visualização em PDF' });
    }
  });

  app.get('/api/v1/reports/consolidated-swot', (req, res) => {
    return sendE2eeAware(req, res, reportService.buildConsolidatedSwotAnalysis());
  });

  app.get('/api/v1/news', (req, res) => {
    return sendE2eeAware(req, res, { news: connectorEngine.getNewsFeed() });
  });

  app.get('/api/v1/sentiment', (req, res) => {
    return sendE2eeAware(req, res, sentimentService.analyzeCurrentSentiment());
  });

  app.post('/api/v1/sentiment/analyze-text', (req, res) => {
    const schema = z.object({ text: z.string().min(4).max(4000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Informe um texto ou comunicado válido (mínimo 4 caracteres).' });
    }
    return sendE2eeAware(req, res, sentimentService.analyzeText(parsed.data.text));
  });

  app.post('/api/v1/backup/create', (req, res) => {
    const backup = timeSeriesStore.createSnapshotBackup();
    cryptoService.recordAudit('svc-timeseries-store', 'ADMIN', 'BACKUP_CREATED', backup.path, 'SUCCESS', {
      totalRecords: backup.totalRecords,
    });
    return sendE2eeAware(req, res, backup);
  });

  app.get('/api/v1/reports/:type', async (req, res) => {
    const validTypes: ReportType[] = [
      'CONSOLIDATED_BRAZIL_SWOT',
      'DAILY_BRIEFING',
      'INFLATION_MONETARY',
      'FISCAL_RISK',
      'FX_ANALYSIS',
      'QUANTITATIVE_RISK',
    ];
    const type = (validTypes.includes(req.params.type as ReportType)
      ? req.params.type
      : 'CONSOLIDATED_BRAZIL_SWOT') as ReportType;
    const format = String(req.query.format || 'json').toLowerCase();
    const e2eeSessionId = req.header('x-sygma-e2ee-keyid') || undefined;
    const rawUserQuery = typeof req.query.user === 'string' ? req.query.user.trim().slice(0, 160) : '';
    const userIdentification =
      rawUserQuery ||
      req.header('x-sygma-user-id')?.trim() ||
      (e2eeSessionId ? `Operador Web E2EE (${e2eeSessionId})` : `Operador Web (${req.ip || 'local'})`);

    cryptoService.recordAudit('svc-reports', 'USER', 'REPORT_EXPORTED', `${type}.${format}`, 'SUCCESS', {
      userIdentification,
    });

    if (format === 'pdf') {
      try {
        const pdfBuffer = await reportService.renderPdf(type, { userIdentification, e2eeSessionId });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="sygma_${type.toLowerCase()}.pdf"`);
        return res.send(pdfBuffer);
      } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro ao gerar PDF' });
      }
    }
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="sygma_${type.toLowerCase()}.csv"`);
      return res.send(reportService.renderCsv(type));
    }
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="sygma_${type.toLowerCase()}.html"`);
      }
      return res.send(reportService.renderHtml(type, { userIdentification, e2eeSessionId }));
    }
    return sendE2eeAware(req, res, reportService.buildReportPayload(type));
  });

  // ==========================================
  // 6B. SCHEDULED PDF REPORT DELIVERY ENGINE
  // ==========================================
  const scheduleReportTypeEnum = z.enum([
    'CONSOLIDATED_BRAZIL_SWOT',
    'DAILY_BRIEFING',
    'INFLATION_MONETARY',
    'FISCAL_RISK',
    'FX_ANALYSIS',
    'QUANTITATIVE_RISK',
  ]);
  const scheduleChannelEnum = z.enum(['SYSTEM', 'EMAIL', 'BOTH']);
  const scheduleCadenceEnum = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'INTERVAL_MINUTES']);

  app.get('/api/v1/schedules', (req, res) => {
    return sendE2eeAware(req, res, {
      schedules: schedulerService.getSchedules(),
      deliveries: schedulerService.getDeliveries(100),
      unreadDeliveriesCount: schedulerService.getUnreadDeliveriesCount(),
      smtpStatus: schedulerService.getSmtpStatus(),
    });
  });

  app.post('/api/v1/schedules', (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(120),
      reportType: scheduleReportTypeEnum,
      deliveryChannel: scheduleChannelEnum,
      recipientEmail: z.string().max(180).optional().default(''),
      cadence: scheduleCadenceEnum,
      timeOfDay: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/).optional().default('08:30'),
      timezone: z.string().min(2).max(60).optional().default('America/Sao_Paulo'),
      dayOfWeek: z.number().int().min(0).max(6).optional(),
      dayOfMonth: z.number().int().min(1).max(28).optional(),
      intervalMinutes: z.number().int().min(5).max(1440).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos para agendamento de relatório PDF.' });
    }
    if (
      (parsed.data.deliveryChannel === 'EMAIL' || parsed.data.deliveryChannel === 'BOTH') &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.recipientEmail.trim())
    ) {
      return res.status(400).json({ error: 'Informe um endereço de e-mail válido para envio por e-mail.' });
    }
    const schedule = schedulerService.createSchedule(parsed.data);
    return sendE2eeAware(req, res, { schedule });
  });

  app.patch('/api/v1/schedules/:id', (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(120).optional(),
      enabled: z.boolean().optional(),
      deliveryChannel: scheduleChannelEnum.optional(),
      recipientEmail: z.string().max(180).optional(),
      cadence: scheduleCadenceEnum.optional(),
      timeOfDay: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/).optional(),
      dayOfWeek: z.number().int().min(0).max(6).optional(),
      dayOfMonth: z.number().int().min(1).max(28).optional(),
      intervalMinutes: z.number().int().min(5).max(1440).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Parâmetros de atualização de agendamento inválidos.' });
    }
    try {
      const schedule = schedulerService.updateSchedule(req.params.id, parsed.data);
      return sendE2eeAware(req, res, { schedule });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Agendamento não encontrado' });
    }
  });

  app.delete('/api/v1/schedules/:id', (req, res) => {
    try {
      schedulerService.deleteSchedule(req.params.id);
      return sendE2eeAware(req, res, { deleted: true });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Agendamento não encontrado' });
    }
  });

  app.post('/api/v1/schedules/:id/run', async (req, res) => {
    try {
      const delivery = await schedulerService.triggerScheduleNow(req.params.id);
      return sendE2eeAware(req, res, {
        delivery,
        schedules: schedulerService.getSchedules(),
        deliveries: schedulerService.getDeliveries(100),
        unreadDeliveriesCount: schedulerService.getUnreadDeliveriesCount(),
      });
    } catch (err) {
      return res.status(404).json({ error: err instanceof Error ? err.message : 'Erro ao executar agendamento' });
    }
  });

  app.post('/api/v1/schedules/deliveries/ack-all', (req, res) => {
    const updated = schedulerService.acknowledgeAllDeliveries();
    return sendE2eeAware(req, res, { updated, unreadDeliveriesCount: 0 });
  });

  app.get('/api/v1/schedules/deliveries/:id/pdf', (req, res) => {
    const item = schedulerService.getDeliveryPdfBuffer(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Arquivo PDF agendado não encontrado.' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${item.record.pdfFilename}"`);
    res.setHeader('X-Sygma-Sha256', item.record.sha256);
    return res.send(item.buffer);
  });

  app.get('/api/v1/schedules/smtp', (req, res) => {
    return sendE2eeAware(req, res, { smtpStatus: schedulerService.getSmtpStatus() });
  });

  app.post('/api/v1/schedules/smtp', (req, res) => {
    const schema = z.object({
      host: z.string().min(2).max(180),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean().default(false),
      user: z.string().min(1).max(180),
      pass: z.string().min(1).max(300),
      fromAddress: z.string().email().max(180),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Configuração SMTP inválida. Verifique host, porta, usuário, senha e remetente.' });
    }
    const smtpStatus = schedulerService.saveSmtpConfig(parsed.data);
    return sendE2eeAware(req, res, { smtpStatus });
  });

  app.delete('/api/v1/schedules/smtp', (req, res) => {
    const smtpStatus = schedulerService.clearSmtpConfig();
    return sendE2eeAware(req, res, { smtpStatus });
  });

  app.post('/api/v1/schedules/smtp/test', async (req, res) => {
    const result = await schedulerService.testSmtpConnection();
    return sendE2eeAware(req, res, result);
  });

  // ==========================================
  // 7. AI ECONOMIC ANALYST (STANDARD + E2EE)
  // ==========================================
  app.post('/api/v1/ai/analyze', async (req, res) => {
    const schema = z.object({
      prompt: z.string().min(2).max(4000),
      history: z
        .array(z.object({ role: z.enum(['user', 'model']), text: z.string() }))
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Pergunta inválida para o Analista AI.' });
    }
    try {
      const result = await aiAnalystService.askAnalyst(parsed.data.prompt, parsed.data.history ?? []);
      return sendE2eeAware(req, res, result);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao consultar SYGMA AI Economic Analyst',
      });
    }
  });

  app.post('/api/v1/ai/briefing', async (req, res) => {
    const lang = req.body?.language === 'en' ? 'en' : 'pt';
    try {
      const result = await aiAnalystService.generateExecutiveBriefing(lang);
      return sendE2eeAware(req, res, result);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao gerar Briefing Executivo',
      });
    }
  });

  // ==========================================
  // VITE DEV / STATIC SERVING
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYGMA-GATEWAY] Running on http://0.0.0.0:${PORT}`);
    // Trigger initial real official data sync immediately on startup
    connectorEngine.runFullSync().then((res) => {
      console.log(`[SYGMA-INGESTION] Initial sync complete: ${res.indicatorsUpdated} indicators @ ${res.syncedAt}`);
    }).catch((err) => {
      console.error('[SYGMA-INGESTION] Initial sync error:', err);
    });

    // Periodic background refresh every 10 minutes
    setInterval(() => {
      connectorEngine.runFullSync().catch(() => {});
    }, 10 * 60 * 1000);

    // Scheduled PDF report delivery daemon (polls every 30s)
    schedulerService.start(30_000);
  });
}

startServer();
