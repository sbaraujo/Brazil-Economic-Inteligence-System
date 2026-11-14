import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { AlertService } from '../server/services/alertService';
import { ApiQuotaService } from '../server/services/apiQuotaService';
import { CryptoMicroservice } from '../server/services/cryptoService';
import { buildHeatmapFromCache, type PersistedEmCache } from '../server/services/emergingMarketsService';
import { QuantEconometricsService } from '../server/services/quantEngine';
import { ReportService } from '../server/services/reportService';
import { computeNextRunIso, ReportSchedulerService } from '../server/services/schedulerService';
import { scoreTextSentiment, SentimentService } from '../server/services/sentimentService';
import { TimeSeriesStore } from '../server/services/timeseriesStore';
import type { IndicatorSnapshot, ObservationPoint } from '../server/types/domain';

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sygma-test-'));

afterAll(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('SYGMA CryptoMicroservice (E2EE, Anti-Replay, Vault & Merkle Audit)', () => {
  it('completes ECDH-P256 handshake, encrypt/decrypt roundtrip, and blocks replay attacks', () => {
    const kms = new CryptoMicroservice(path.join(TEST_ROOT, 'kms1'));
    const meta = kms.getServerHandshakeMetadata();
    expect(meta.fingerprint).toHaveLength(16);

    const clientKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const clientPubDer = clientKeys.publicKey.export({ type: 'spki', format: 'der' });
    const session = kms.establishSession(Buffer.from(clientPubDer).toString('base64'));
    expect(session.keyId).toMatch(/^sygma-e2ee-/);
    expect(kms.hasValidSession(session.keyId)).toBe(true);

    const original = { indicator: 'USD_BRL_PTAX', value: 5.6518, status: 'PERIODIC' };
    const envelope = kms.encryptEnvelope(session.keyId, original);
    expect(envelope.version).toBe('SYGMA-E2EE-1.0');
    expect(envelope.ciphertext).not.toContain('5.6518');

    const decoded = kms.decryptEnvelope<typeof original>(envelope);
    expect(decoded).toEqual(original);

    // Replay of identical envelope nonce must be rejected
    expect(() => kms.decryptEnvelope(envelope)).toThrow(/Replay/i);
  });

  it('persists vault master key across restarts and unseals sealed credentials', () => {
    const dir = path.join(TEST_ROOT, 'kms-persist');
    const kmsA = new CryptoMicroservice(dir);
    kmsA.sealCredential('anbima-api', 'secret-token-xyz-987');

    const kmsB = new CryptoMicroservice(dir);
    expect(kmsB.hasSealedCredential('anbima-api')).toBe(true);
    expect(kmsB.unsealCredential('anbima-api')).toBe('secret-token-xyz-987');
  });

  it('maintains valid SHA-256 Merkle-linked audit chain', () => {
    const kms = new CryptoMicroservice(path.join(TEST_ROOT, 'kms-audit'));
    kms.recordAudit('svc-test', 'UNIT_TEST', 'VERIFY_CHAIN', 'TEST_RES', 'SUCCESS');
    const verification = kms.verifyAuditChain();
    expect(verification.valid).toBe(true);
    expect(verification.totalEvents).toBeGreaterThan(0);
  });
});

describe('SYGMA QuantEconometricsService & TimeSeriesStore', () => {
  const quant = new QuantEconometricsService();

  it('computes exact Pearson correlation = 1.0 for collinear positive series', () => {
    const r = quant.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r).toBeCloseTo(1.0, 6);
  });

  it('computes exact Spearman rank correlation = -1.0 for strictly inverse series', () => {
    const rho = quant.spearman([10, 20, 30, 40, 50], [100, 50, 25, 10, 1]);
    expect(rho).toBeCloseTo(-1.0, 6);
  });

  it('computes Scenarios A-J dynamically consistent with portfolio weights', () => {
    const risk = quant.computeRiskReport(20261113, 2000);
    expect(risk.stressScenarios).toHaveLength(10);
    // Verify Scenario A: 0.35*(-6.4) + 0.25*(-2.5) + 0.20*(0) + 0.20*(-2.0) = -3.265 (IEEE-754 toFixed(2) => -3.26)
    const scenA = risk.stressScenarios.find((s) => s.code === 'A');
    expect(scenA?.estimatedPortfolioImpactPct).toBeCloseTo(-3.26, 2);
    expect(scenA?.estimatedBrlImpactPer100M).toBe(-3_260_000);
  });

  it('tracks historical revisions non-destructively in isolated TimeSeriesStore', () => {
    const store = new TimeSeriesStore(path.join(TEST_ROOT, 'ts-store'));
    const basePoint: ObservationPoint = {
      date: '2026-01-01',
      value: 0.45,
      referencePeriod: '2026-01',
      publishedAt: '2026-02-10',
      ingestedAt: '2026-02-10T12:00:00Z',
      revisionCount: 0,
      status: 'PERIODIC',
      sourceId: 'bcb-sgs',
      sourceName: 'BCB SGS',
      digestSha256: '',
    };
    const first = store.upsertObservations('IPCA_MENSAL', [basePoint]);
    expect(first.inserted).toBe(1);

    const revised = store.upsertObservations('IPCA_MENSAL', [{ ...basePoint, value: 0.49 }]);
    expect(revised.revised).toBe(1);
    const revLog = store.getRevisions('IPCA_MENSAL');
    expect(revLog.length).toBe(1);
    expect(revLog[0].previousValue).toBe(0.45);
    expect(revLog[0].newValue).toBe(0.49);
  });
});

describe('SYGMA AlertService & Binary PDF ReportService', () => {
  it('evaluates Watchlist threshold rules, enforces cooldown, and acknowledges alerts', () => {
    const alerts = new AlertService(path.join(TEST_ROOT, 'alerts'));
    const rule = alerts.createRule({
      indicatorId: 'USD_BRL_PTAX',
      thresholdPct: 1.5,
      direction: 'UP',
      cooldownMinutes: 60,
    });
    expect(rule.enabled).toBe(true);

    const mockSnap: IndicatorSnapshot = {
      definition: {
        id: 'USD_BRL_PTAX',
        code: 'PTAX-USD',
        namePt: 'USD/BRL (PTAX Venda BCB)',
        nameEn: 'USD/BRL',
        category: 'FX',
        unit: 'BRL/USD',
        currency: 'BRL',
        frequency: 'DAILY',
        freshnessThresholdHours: 96,
        providerId: 'bcb-sgs',
        externalSeriesId: '1',
        methodologyNote: 'Test',
        isOfficial: true,
      },
      latest: {
        date: '2026-11-14',
        value: 5.85,
        referencePeriod: '2026-11-14',
        publishedAt: '2026-11-14',
        ingestedAt: '2026-11-14T12:00:00Z',
        revisionCount: 0,
        status: 'PERIODIC',
        sourceId: 'bcb-sgs',
        sourceName: 'BCB',
        digestSha256: 'abc',
      },
      previous: null,
      changeAbs: 0.15,
      changePct: 2.63,
      observationsCount: 100,
      status: 'PERIODIC',
    };

    const firstHit = alerts.evaluateSnapshots([mockSnap]);
    expect(firstHit).toHaveLength(1);
    expect(firstHit[0].observedPctChange).toBe(2.63);
    expect(alerts.getUnreadCount()).toBe(1);

    // Cooldown prevents duplicate firing immediately
    const secondHit = alerts.evaluateSnapshots([mockSnap]);
    expect(secondHit).toHaveLength(0);

    alerts.acknowledgeAlert(firstHit[0].id);
    expect(alerts.getUnreadCount()).toBe(0);
  });

  it('renders a valid binary PDF document with %PDF- signature including CONSOLIDATED_BRAZIL_SWOT', async () => {
    const rep = new ReportService();
    const buf = await rep.renderPdf('CONSOLIDATED_BRAZIL_SWOT');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(3000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const swot = rep.buildConsolidatedSwotAnalysis();
    expect(swot.swotMatrix.strengths.length).toBeGreaterThanOrEqual(3);
    expect(swot.swotMatrix.weaknesses.length).toBeGreaterThanOrEqual(3);
    expect(swot.swotMatrix.opportunities.length).toBeGreaterThanOrEqual(3);
    expect(swot.swotMatrix.threats.length).toBeGreaterThanOrEqual(3);
    expect(swot.stressScenariosPlain).toHaveLength(10);

    const exported = rep.exportDataset({ scope: 'RISK_SCENARIOS', format: 'csv' });
    expect(exported.recordCount).toBe(10);
    expect(exported.sha256).toHaveLength(64);
    expect(exported.content).toContain('scenario_code');

    const viewPdf = await rep.renderViewSnapshotPdf({
      viewTitle: 'Dashboard SWOT Brasil',
      activeView: 'SWOT_DASHBOARD',
      filters: { categoryFilter: 'FX', watchlistIds: ['USD_BRL_PTAX'] },
      snapshots: [
        {
          code: 'PTAX-USD',
          name: 'USD/BRL PTAX',
          value: 5.6518,
          unit: 'BRL/USD',
          changePct: 0.42,
          date: '2026-11-13',
          status: 'PERIODIC',
        },
      ],
      tables: [
        {
          title: 'Tabela Customizada SWOT',
          columns: ['Quadrante', 'Fator', 'Evidência'],
          rows: [['Forças', 'Reservas', 'US$ 364.4 bi']],
        },
      ],
      includeSwot: true,
      includeStressScenarios: true,
    });
    expect(viewPdf.sha256).toHaveLength(64);
    expect(viewPdf.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(viewPdf.buffer.length).toBeGreaterThan(2500);
  });
});

describe('SYGMA ReportSchedulerService (Automated PDF Scheduling)', () => {
  it('computes future nextRunAt, executes due SYSTEM schedules, archives binary PDF, and tracks unread count', async () => {
    const scheduler = new ReportSchedulerService(path.join(TEST_ROOT, 'sched-sys'));
    const nextIso = computeNextRunIso({
      cadence: 'DAILY',
      timeOfDay: '08:30',
      timezone: 'America/Sao_Paulo',
    });
    expect(Date.parse(nextIso)).toBeGreaterThan(Date.now());

    const sch = scheduler.createSchedule({
      name: 'Briefing Automático Sistema',
      reportType: 'DAILY_BRIEFING',
      deliveryChannel: 'SYSTEM',
      cadence: 'INTERVAL_MINUTES',
      intervalMinutes: 15,
    });
    expect(sch.enabled).toBe(true);
    expect(sch.nextRunAt).toBeTruthy();

    // Advance simulated clock 20 minutes past creation to make schedule due
    const futureMs = Date.parse(sch.nextRunAt!) + 5 * 60_000;
    const dueExecutions = await scheduler.processDueSchedules(futureMs);
    expect(dueExecutions).toHaveLength(1);
    expect(dueExecutions[0].status).toBe('DELIVERED');
    expect(dueExecutions[0].systemStatus).toBe('STORED');
    expect(dueExecutions[0].sha256).toHaveLength(64);

    const archived = scheduler.getDeliveryPdfBuffer(dueExecutions[0].id);
    expect(archived).not.toBeNull();
    expect(archived!.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(archived!.buffer.length).toBeGreaterThan(2000);

    expect(scheduler.getUnreadDeliveriesCount()).toBe(1);
    scheduler.acknowledgeAllDeliveries();
    expect(scheduler.getUnreadDeliveriesCount()).toBe(0);
  });

  it('reports NOT_CONFIGURED honestly when EMAIL delivery runs without SMTP credentials', async () => {
    const scheduler = new ReportSchedulerService(path.join(TEST_ROOT, 'sched-email'));
    const sch = scheduler.createSchedule({
      name: 'Envio Email Sem SMTP',
      reportType: 'FX_ANALYSIS',
      deliveryChannel: 'EMAIL',
      recipientEmail: 'desk@instituicao.com.br',
      cadence: 'DAILY',
      timeOfDay: '09:00',
    });

    const dlv = await scheduler.triggerScheduleNow(sch.id);
    expect(dlv.emailStatus).toBe('NOT_CONFIGURED');
    expect(dlv.status).toBe('FAILED');
  });
});

describe('SYGMA Emerging Markets Relative Normalization & Historical Backtesting', () => {
  it('normalizes EM macro indicators with polarity adjustment and builds historical Brazil rank trajectory', () => {
    const sampleCache: PersistedEmCache = {
      syncedAt: '2026-11-14T12:00:00Z',
      datasetTag: 'WEO:2025-04',
      years: ['2024', '2025'],
      values: {
        BRA: { NGDP_RPCH: { '2024': 3.4, '2025': 2.1 }, PCPIPCH: { '2024': 4.4, '2025': 5.3 } },
        IND: { NGDP_RPCH: { '2024': 6.5, '2025': 6.2 }, PCPIPCH: { '2024': 4.7, '2025': 4.2 } },
        MEX: { NGDP_RPCH: { '2024': 1.5, '2025': -0.2 }, PCPIPCH: { '2024': 4.7, '2025': 3.5 } },
      },
      latestMarketValues: {
        BRA: { EQUITY_1Y_USD: { value: 12.5, refPeriod: '2026-11-13' } },
        IND: { EQUITY_1Y_USD: { value: 8.2, refPeriod: '2026-11-13' } },
        MEX: { EQUITY_1Y_USD: { value: -4.1, refPeriod: '2026-11-13' } },
      },
    };

    const report = buildHeatmapFromCache(sampleCache, '2025', 'LIVE');
    expect(report.selectedYear).toBe('2025');
    // Higher inflation for BRA (5.3%) vs IND (4.2%) and MEX (3.5%) => negative relativeZScore because lower CPI is better
    const braCpi = report.cells.find((c) => c.iso3 === 'BRA' && c.indicatorId === 'PCPIPCH');
    expect(braCpi?.relativeZScore).toBeLessThan(0);
    expect(braCpi?.rank).toBe(3);

    // Higher GDP for IND (6.2%) => rank 1 and positive relativeZScore
    const indGdp = report.cells.find((c) => c.iso3 === 'IND' && c.indicatorId === 'NGDP_RPCH');
    expect(indGdp?.rank).toBe(1);
    expect(indGdp?.relativeZScore).toBeGreaterThan(0);

    expect(report.brazilSummary.historicalBrazilScoreSeries).toHaveLength(2);
  });

  it('executes strictly causal historical backtesting with valid drawdown, Sharpe, and annual breakdown', () => {
    const quant = new QuantEconometricsService();
    // Deterministic 180-day series with clear cycle + uptrend
    const series: ObservationPoint[] = [];
    const baseDate = new Date('2025-01-02T00:00:00Z');
    for (let i = 0; i < 180; i++) {
      const d = new Date(baseDate.getTime() + i * 86400_000).toISOString().slice(0, 10);
      const val = 100 + i * 0.25 + Math.sin(i / 8) * 6;
      series.push({
        date: d,
        value: Number(val.toFixed(4)),
        referencePeriod: d,
        publishedAt: d,
        ingestedAt: d,
        revisionCount: 0,
        status: 'HISTORICAL',
        sourceId: 'test',
        sourceName: 'Test Series',
        digestSha256: 'hash',
      });
    }

    const resSma = quant.evaluateHistoricalBacktest(series, {
      indicatorId: 'IBOV_TEST',
      category: 'EQUITIES_BR',
      frequency: 'DAILY',
      strategy: 'TREND_SMA_CROSSOVER',
      range: 'MAX',
      transactionCostBps: 10,
    });
    expect(resSma.observationsTested).toBeGreaterThan(100);
    expect(resSma.metrics.maxDrawdownPct).toBeLessThanOrEqual(0);
    expect(Number.isFinite(resSma.metrics.sharpeRatio)).toBe(true);
    expect(resSma.equityCurve.length).toBeGreaterThan(50);
    expect(resSma.annualBreakdown.length).toBeGreaterThanOrEqual(1);

    const resAr1 = quant.evaluateHistoricalBacktest(series, {
      indicatorId: 'IBOV_TEST',
      category: 'EQUITIES_BR',
      frequency: 'DAILY',
      strategy: 'AR1_WALK_FORWARD',
      range: 'MAX',
      transactionCostBps: 5,
    });
    expect(resAr1.metrics.walkForwardMae).toBeGreaterThan(0);
    expect(resAr1.metrics.directionalAccuracyPct).toBeGreaterThanOrEqual(0);

    // Insufficient data guard (< 24 points)
    const emptyRes = quant.evaluateHistoricalBacktest(series.slice(0, 10), {
      indicatorId: 'SHORT_TEST',
    });
    expect(emptyRes.observationsTested).toBe(0);
  });
});

describe('SYGMA ApiQuotaService & Macro-Stress Heat Map', () => {
  it('tracks external API request consumption, remaining monthly quotas, quota edits, and UTC rollovers', () => {
    const quotaSvc = new ApiQuotaService(path.join(TEST_ROOT, 'quota-svc'));
    const day1 = new Date('2026-11-14T15:00:00Z');
    quotaSvc.recordCall('bcb-sgs', { ok: true, latencyMs: 120, records: 40 }, day1);
    quotaSvc.recordCall('bcb-sgs', { ok: false, latencyMs: 240, records: 0 }, day1);
    quotaSvc.recordCall('yahoo-market', { ok: true, latencyMs: 180, records: 250 }, day1);

    const snap1 = quotaSvc.getQuotaSnapshot([], day1);
    expect(snap1.billingMonth).toBe('2026-11');
    expect(snap1.summary.totalRequestsMonth).toBe(3);
    expect(snap1.summary.totalRequestsToday).toBe(3);

    const bcb = snap1.providers.find((p) => p.providerId === 'bcb-sgs');
    expect(bcb?.requestsThisMonth).toBe(2);
    expect(bcb?.requestsRemaining).toBe(25000 - 2);
    expect(bcb?.successRatePct).toBe(50);

    // Custom monthly quota edit
    quotaSvc.setMonthlyQuota('bcb-sgs', 30000);
    const snapEdited = quotaSvc.getQuotaSnapshot([], day1);
    expect(snapEdited.providers.find((p) => p.providerId === 'bcb-sgs')?.requestsRemaining).toBe(29998);

    // Next UTC day keeps monthly counter but resets requestsToday
    const day2 = new Date('2026-11-15T01:00:00Z');
    const snapDay2 = quotaSvc.getQuotaSnapshot([], day2);
    expect(snapDay2.summary.totalRequestsToday).toBe(0);
    expect(snapDay2.summary.totalRequestsMonth).toBe(3);

    // Next UTC month resets monthly counters cleanly
    const nextMonth = new Date('2026-12-01T00:05:00Z');
    const snapNextMonth = quotaSvc.getQuotaSnapshot([], nextMonth);
    expect(snapNextMonth.billingMonth).toBe('2026-12');
    expect(snapNextMonth.summary.totalRequestsMonth).toBe(0);
    expect(snapNextMonth.providers.find((p) => p.providerId === 'bcb-sgs')?.requestsRemaining).toBe(30000);
  });

  it('builds 10x6 macro-stress heatmap matching portfolio risk scenarios and USD/BRL inverse valence', () => {
    const quant = new QuantEconometricsService();
    const heatmap = quant.computeMacroStressHeatmap();

    expect(heatmap.factors).toHaveLength(6);
    expect(heatmap.scenarios).toHaveLength(10);
    expect(heatmap.cells).toHaveLength(60);

    for (const f of heatmap.factors) {
      expect(f.empiricalMonthlyVolPct).toBeGreaterThan(0);
    }

    const scenAPort = heatmap.cells.find((c) => c.scenarioCode === 'A' && c.factorId === 'PORTFOLIO_NET');
    expect(scenAPort?.shockPct).toBeCloseTo(-3.26, 2);

    // USD_BRL +18% in Scenario H is currency depreciation stress => negative stressValence (-18)
    const scenHUsd = heatmap.cells.find((c) => c.scenarioCode === 'H' && c.factorId === 'USD_BRL');
    expect(scenHUsd?.shockPct).toBe(18);
    expect(scenHUsd?.stressValence).toBe(-18);
  });
});

function extractPdfAsciiText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts: string[] = [raw];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(raw)) !== null) {
    try {
      const inflated = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      parts.push(inflated);
      // Decode PDFKit hex-encoded glyph runs (<HEX>) inside TJ arrays
      const lineJoined = inflated.replace(/\[([^\]]+)\]\s*TJ/g, (_, arr: string) => {
        const hexMatches = arr.match(/<([0-9a-fA-F]+)>/g) || [];
        return hexMatches
          .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
          .join('');
      });
      parts.push(lineJoined);
    } catch {
      // Non-deflated stream
    }
  }
  return parts.join('\n');
}

describe('SYGMA Institutional PDF Disclaimers & Sentiment Analysis Engine', () => {
  it('embeds Institutional Disclaimers, timestamp, user identification, and CVM compliance notice into every PDF and HTML report', async () => {
    const rep = new ReportService();
    const customUser = 'Analista Mesa Macro #402';

    const reportPdf = await rep.renderPdf('DAILY_BRIEFING', {
      userIdentification: customUser,
      e2eeSessionId: 'sygma-e2ee-test-99',
    });
    const decodedReportText = extractPdfAsciiText(reportPdf);
    expect(decodedReportText).toContain('Institutional Disclaimers');
    expect(decodedReportText).toContain(customUser);
    expect(decodedReportText).toContain('sygma-e2ee-test-99');
    expect(decodedReportText).toContain('CVM 19/2021 e 20/2021');
    expect(decodedReportText).toContain('Timestamp UTC');

    const snapshotPdf = await rep.renderViewSnapshotPdf({
      viewTitle: 'Monitor Macro',
      activeView: 'MACRO',
      userIdentification: 'Diretoria Risco #11',
      e2eeSessionId: 'sygma-e2ee-snap-01',
    });
    const decodedSnapText = extractPdfAsciiText(snapshotPdf.buffer);
    expect(decodedSnapText).toContain('Institutional Disclaimers');
    expect(decodedSnapText).toContain('Diretoria Risco #11');
    expect(decodedSnapText).toContain('CVM 19/2021 e 20/2021');

    const html = rep.renderHtml('DAILY_BRIEFING', { userIdentification: customUser });
    expect(html).toContain('Institutional Disclaimers');
    expect(html).toContain(customUser);
    expect(html).toContain('CVM 19/2021 e 20/2021');
  });

  it('scores PT/EN macro & COPOM text accurately and produces valid 5-pillar composite SentimentAnalysisReport', () => {
    const hawkNeg = scoreTextSentiment(
      'Comite destaca risco fiscal, pressao inflacionaria e necessidade de aperto monetario e elevacao da taxa selic.'
    );
    expect(hawkNeg.polarity).toBe('NEGATIVE');
    expect(hawkNeg.monetaryStance).toBe('HAWKISH');
    expect(hawkNeg.scoreNormalized).toBeLessThan(45);
    expect(hawkNeg.hawkishHits.length).toBeGreaterThanOrEqual(2);

    const dovePos = scoreTextSentiment(
      'Desaceleracao da inflacao e superavit sustentam convergencia a meta e ciclo de cortes com reducao da taxa selic.'
    );
    expect(dovePos.polarity).toBe('POSITIVE');
    expect(dovePos.monetaryStance).toBe('DOVISH');
    expect(dovePos.scoreNormalized).toBeGreaterThan(55);
    expect(dovePos.dovishHits.length).toBeGreaterThanOrEqual(2);

    const svc = new SentimentService();
    const report = svc.analyzeCurrentSentiment();
    expect(report.compositeScore).toBeGreaterThanOrEqual(0);
    expect(report.compositeScore).toBeLessThanOrEqual(100);
    expect(report.pillars).toHaveLength(5);
    const weightSum = report.pillars.reduce((acc, p) => acc + p.weight, 0);
    expect(weightSum).toBeCloseTo(1.0, 5);
  });
});


