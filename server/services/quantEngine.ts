import type { ObservationPoint } from '../types/domain.ts';
import { INDICATOR_CATALOG } from './connectors/indicatorCatalog.ts';
import { timeSeriesStore } from './timeseriesStore.ts';

// Deterministic Mulberry32 PRNG for reproducible Monte Carlo simulations
function createMulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMullerNormal(rand: () => number): number {
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[], sample = true): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const ss = arr.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(ss / (sample ? arr.length - 1 : arr.length));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function normalInvApprox(p: number): number {
  // Abramowitz & Stegun rational approximation
  if (p <= 0 || p >= 1) return 0;
  const sign = p < 0.5 ? -1 : 1;
  const q = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(q));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  const z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
  return sign * z;
}

// Error function approximation for p-value computation
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-ax * ax);
  return sign * y;
}

function approxTwoTailedPValueFromT(tStat: number, df: number): number {
  if (!Number.isFinite(tStat) || df < 1) return 1;
  const absT = Math.abs(tStat);
  // Effective z-transform for large df, conservative for small df
  const z = absT * (1 - 1 / (4 * df)) / Math.sqrt(1 + (absT * absT) / (2 * df));
  const p = 1 - erf(z / Math.SQRT2);
  return Math.max(0, Math.min(1, p));
}

export function alignTwoSeries(
  s1: ObservationPoint[],
  s2: ObservationPoint[],
  mode: 'DAILY' | 'MONTHLY' = 'MONTHLY'
): Array<{ period: string; x: number; y: number }> {
  const bucket = (pts: ObservationPoint[]) => {
    const map = new Map<string, number[]>();
    for (const p of pts) {
      const key = mode === 'MONTHLY' ? p.date.slice(0, 7) : p.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p.value);
    }
    const out = new Map<string, number>();
    for (const [k, vals] of map.entries()) {
      // Use end-of-period last observation for market levels
      out.set(k, vals[vals.length - 1]);
    }
    return out;
  };

  const m1 = bucket(s1);
  const m2 = bucket(s2);
  const aligned: Array<{ period: string; x: number; y: number }> = [];
  for (const [k, vx] of m1.entries()) {
    const vy = m2.get(k);
    if (vy !== undefined && Number.isFinite(vx) && Number.isFinite(vy)) {
      aligned.push({ period: k, x: vx, y: vy });
    }
  }
  return aligned.sort((a, b) => a.period.localeCompare(b.period));
}

export interface TechnicalAnalysisReport {
  indicatorId: string;
  observations: number;
  lastClose: number | null;
  sma20: number | null;
  sma50: number | null;
  ema12: number | null;
  ema26: number | null;
  macd: number | null;
  rsi14: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  annualizedVolatilityPct: number | null;
  maxDrawdownPct: number | null;
  supportEstimate: number | null;
  resistanceEstimate: number | null;
  trendRegime: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'INSUFFICIENT_DATA';
  volatilityRegime: 'HIGH_VOL' | 'NORMAL_VOL' | 'LOW_VOL' | 'INSUFFICIENT_DATA';
  disclaimer: string;
}

export interface CrossIndicatorReport {
  xId: string;
  yId: string;
  xName: string;
  yName: string;
  frequency: 'DAILY' | 'MONTHLY';
  sampleStart: string;
  sampleEnd: string;
  observations: number;
  pearsonR: number;
  pearsonPValue: number;
  spearmanRho: number;
  olsSlope: number;
  olsIntercept: number;
  rSquared: number;
  durbinWatson: number;
  grangerXtoY: { fStat: number; pApprox: number; lagOrder: number; significantAt5Pct: boolean };
  grangerYtoX: { fStat: number; pApprox: number; lagOrder: number; significantAt5Pct: boolean };
  laggedCorrelations: Array<{ lag: number; r: number }>;
  rollingCorrelations: Array<{ period: string; r: number }>;
  scatterPoints: Array<{ period: string; x: number; y: number }>;
  limitations: string[];
  interpretation: string;
}

export interface ForecastReport {
  indicatorId: string;
  indicatorName: string;
  unit: string;
  modelName: string;
  modelVersion: string;
  trainedAt: string;
  observationsUsed: number;
  validation: {
    method: string;
    mae: number;
    rmse: number;
    mase: number;
    directionalAccuracyPct: number;
    intervalCoverage90Pct: number;
  };
  garchParams: { omega: number; alpha: number; beta: number; persistence: number };
  historyTail: Array<{ date: string; value: number }>;
  horizonPoints: Array<{
    step: number;
    date: string;
    central: number;
    optimistic: number;
    adverse: number;
    severeStress: number;
    lower90: number;
    upper90: number;
  }>;
  limitations: string[];
}

export interface RiskReport {
  generatedAt: string;
  seed: number;
  simulations: number;
  confidenceLevels: number[];
  portfolioAssumptions: Array<{ indicatorId: string; label: string; weight: number; latestValue: number }>;
  metrics: {
    historicalVar95Pct: number;
    historicalVar99Pct: number;
    parametricVar95Pct: number;
    cornishFisherVar95Pct: number;
    monteCarloVar95Pct: number;
    monteCarloVar99Pct: number;
    expectedShortfall95Pct: number;
    expectedShortfall99Pct: number;
    annualizedVolatilityPct: number;
    maxDrawdownPct: number;
    skewness: number;
    excessKurtosis: number;
  };
  monteCarloHistogram: Array<{ binLabel: string; count: number; isTail95: boolean }>;
  stressScenarios: Array<{
    code: string;
    namePt: string;
    nameEn: string;
    shockDescription: string;
    estimatedPortfolioImpactPct: number;
    estimatedBrlImpactPer100M: number;
    transmissionChannels: string[];
    isHypothetical: true;
  }>;
  limitations: string[];
}

export interface BrazilPulseDimension {
  id: string;
  namePt: string;
  nameEn: string;
  score: number; // 0..100 normalized where 50 = historical median
  weight: number;
  statusLabelPt: string;
  statusLabelEn: string;
  primaryIndicatorId: string;
  primaryValue: number | null;
  primaryUnit: string;
  zScore: number | null;
  dataStatus: string;
}

export interface BrazilPulseReport {
  generatedAt: string;
  compositeScore: number | null;
  assessment: 'FAVORABLE' | 'STABLE' | 'CAUTION' | 'ADVERSE' | 'SEVERE_STRESS' | 'INSUFFICIENT_DATA';
  dimensions: BrazilPulseDimension[];
  methodology: {
    formula: string;
    normalization: string;
    missingDataTreatment: string;
    disclaimer: string;
  };
}

export type BacktestStrategy =
  | 'TREND_SMA_CROSSOVER'
  | 'MEAN_REVERSION_ZSCORE'
  | 'AR1_WALK_FORWARD'
  | 'MOMENTUM_REGIME';

export interface BacktestEquityPoint {
  date: string;
  price: number;
  strategyEquity: number;
  benchmarkEquity: number;
  drawdownPct: number;
  benchmarkDrawdownPct: number;
  signalPosition: number; // 1 = Long/Exposed, 0 = Defensive/Cash
  periodReturnPct: number;
}

export interface BacktestAnnualRow {
  year: string;
  strategyReturnPct: number;
  benchmarkReturnPct: number;
  alphaPct: number;
  maxDrawdownPct: number;
  trades: number;
  observations: number;
}

export interface BacktestTradeRecord {
  entryDate: string;
  exitDate: string;
  entryValue: number;
  exitValue: number;
  netReturnPct: number;
  holdingPeriods: number;
}

export interface BacktestReport {
  indicatorId: string;
  indicatorCode: string;
  indicatorName: string;
  unit: string;
  strategy: BacktestStrategy;
  strategyLabelPt: string;
  range: string;
  evaluationMode: 'PRICE_RETURN' | 'RATE_DIRECTIONAL';
  transactionCostBps: number;
  observationsTested: number;
  sampleStart: string;
  sampleEnd: string;
  metrics: {
    totalReturnPct: number;
    cagrPct: number;
    benchmarkReturnPct: number;
    benchmarkCagrPct: number;
    alphaPct: number;
    annualizedVolatilityPct: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdownPct: number;
    benchmarkMaxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number;
    tradesCount: number;
    exposurePct: number;
    walkForwardMae: number;
    walkForwardRmse: number;
    directionalAccuracyPct: number;
  };
  equityCurve: BacktestEquityPoint[];
  annualBreakdown: BacktestAnnualRow[];
  recentTrades: BacktestTradeRecord[];
  methodologyNote: string;
  limitations: string[];
}

export interface MacroStressFactorMeta {
  id: string;
  code: string;
  namePt: string;
  nameEn: string;
  portfolioWeight: number;
  empiricalMonthlyVolPct: number;
  observationsUsed: number;
  isMacroCurrencyInverse?: boolean;
}

export interface MacroStressCell {
  scenarioCode: string;
  factorId: string;
  shockPct: number;
  pnlContributionPct: number;
  brlImpactPer100M: number;
  sigmaMultiple: number;
  /** Signed intensity where negative = adverse macro/portfolio stress, positive = relief/gain */
  stressValence: number;
}

export interface MacroStressScenarioRow {
  code: string;
  namePt: string;
  nameEn: string;
  shockDescription: string;
  transmissionChannels: string[];
  portfolioImpactPct: number;
  portfolioBrlPer100M: number;
  severityLabelPt: 'ESTRESSE EXTREMO' | 'ESTRESSE ELEVADO' | 'MODERADO' | 'GANHO LÍQUIDO';
}

export interface MacroStressHeatmapReport {
  generatedAt: string;
  factors: MacroStressFactorMeta[];
  scenarios: MacroStressScenarioRow[];
  cells: MacroStressCell[];
  methodologyNote: string;
  limitations: string[];
}

export class QuantEconometricsService {
  private riskReportCache = new Map<string, { obsCount: number; report: RiskReport }>();

  public computeTechnicalAnalysis(indicatorId: string): TechnicalAnalysisReport {
    const series = timeSeriesStore.getSeries(indicatorId);
    const vals = series.map((p) => p.value);
    const n = vals.length;

    const base: TechnicalAnalysisReport = {
      indicatorId,
      observations: n,
      lastClose: n > 0 ? vals[n - 1] : null,
      sma20: null,
      sma50: null,
      ema12: null,
      ema26: null,
      macd: null,
      rsi14: null,
      bollingerUpper: null,
      bollingerLower: null,
      annualizedVolatilityPct: null,
      maxDrawdownPct: null,
      supportEstimate: null,
      resistanceEstimate: null,
      trendRegime: 'INSUFFICIENT_DATA',
      volatilityRegime: 'INSUFFICIENT_DATA',
      disclaimer:
        'Indicadores técnicos analíticos calculados deterministicamente sobre série histórica armazenada; não constituem garantia ou recomendação de operação.',
    };

    if (n < 20) return base;

    const sma20 = mean(vals.slice(-20));
    const sd20 = stdDev(vals.slice(-20), false);
    const sma50 = n >= 50 ? mean(vals.slice(-50)) : null;

    const calcEma = (data: number[], period: number) => {
      const k = 2 / (period + 1);
      let ema = data[0];
      for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
      }
      return ema;
    };

    const ema12 = calcEma(vals.slice(-60), 12);
    const ema26 = calcEma(vals.slice(-80), 26);

    // RSI 14
    const recent = vals.slice(-15);
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i] - recent[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const rs = losses === 0 ? 100 : gains / 14 / (losses / 14);
    const rsi14 = losses === 0 ? 100 : 100 - 100 / (1 + rs);

    // Log returns & Max Drawdown
    const logRets: number[] = [];
    let peak = vals[0];
    let maxDd = 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] > 0 && vals[i - 1] > 0) {
        logRets.push(Math.log(vals[i] / vals[i - 1]));
      }
      if (vals[i] > peak) peak = vals[i];
      if (peak > 0) {
        const dd = (vals[i] - peak) / peak;
        if (dd < maxDd) maxDd = dd;
      }
    }

    const volShort = logRets.length >= 21 ? stdDev(logRets.slice(-21)) * Math.sqrt(252) * 100 : null;
    const volLong = logRets.length >= 60 ? stdDev(logRets.slice(-252)) * Math.sqrt(252) * 100 : volShort;

    const last = vals[n - 1];
    const recent60 = vals.slice(-60);
    const support = Math.min(...recent60);
    const resistance = Math.max(...recent60);

    let trendRegime: TechnicalAnalysisReport['trendRegime'] = 'SIDEWAYS';
    if (sma50 !== null) {
      if (last > sma20 && sma20 > sma50) trendRegime = 'UPTREND';
      else if (last < sma20 && sma20 < sma50) trendRegime = 'DOWNTREND';
    } else {
      if (last > sma20 * 1.005) trendRegime = 'UPTREND';
      else if (last < sma20 * 0.995) trendRegime = 'DOWNTREND';
    }

    let volatilityRegime: TechnicalAnalysisReport['volatilityRegime'] = 'NORMAL_VOL';
    if (volShort !== null && volLong !== null && volLong > 0) {
      if (volShort / volLong > 1.3) volatilityRegime = 'HIGH_VOL';
      else if (volShort / volLong < 0.75) volatilityRegime = 'LOW_VOL';
    }

    return {
      ...base,
      sma20: Number(sma20.toFixed(4)),
      sma50: sma50 !== null ? Number(sma50.toFixed(4)) : null,
      ema12: Number(ema12.toFixed(4)),
      ema26: Number(ema26.toFixed(4)),
      macd: Number((ema12 - ema26).toFixed(4)),
      rsi14: Number(rsi14.toFixed(2)),
      bollingerUpper: Number((sma20 + 2 * sd20).toFixed(4)),
      bollingerLower: Number((sma20 - 2 * sd20).toFixed(4)),
      annualizedVolatilityPct: volShort !== null ? Number(volShort.toFixed(2)) : null,
      maxDrawdownPct: Number((maxDd * 100).toFixed(2)),
      supportEstimate: Number(support.toFixed(4)),
      resistanceEstimate: Number(resistance.toFixed(4)),
      trendRegime,
      volatilityRegime,
    };
  }

  public pearson(x: number[], y: number[]): number {
    if (x.length < 3 || x.length !== y.length) return 0;
    const mx = mean(x);
    const my = mean(y);
    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let i = 0; i < x.length; i++) {
      const dx = x[i] - mx;
      const dy = y[i] - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? 0 : num / denom;
  }

  public spearman(x: number[], y: number[]): number {
    const rank = (arr: number[]) => {
      const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const ranks = new Array<number>(arr.length);
      for (let i = 0; i < sorted.length; ) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j++;
        const avgRank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
        i = j + 1;
      }
      return ranks;
    };
    return this.pearson(rank(x), rank(y));
  }

  private solveLinearSystem(A: number[][], b: number[]): number[] {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      [M[i], M[maxRow]] = [M[maxRow], M[i]];
      const pivot = Math.abs(M[i][i]) < 1e-12 ? 1e-12 : M[i][i];
      for (let j = i; j <= n; j++) M[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const factor = M[k][i];
        for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
      }
    }
    return M.map((r) => r[n]);
  }

  private olsRSS(X: number[][], y: number[]): { beta: number[]; rss: number } {
    const k = X[0].length;
    const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    const Xty: number[] = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let a = 0; a < k; a++) {
        Xty[a] += X[i][a] * y[i];
        for (let b = 0; b < k; b++) {
          XtX[a][b] += X[i][a] * X[i][b];
        }
      }
    }
    // Small ridge regularization for numerical stability
    for (let a = 0; a < k; a++) XtX[a][a] += 1e-8;
    const beta = this.solveLinearSystem(XtX, Xty);
    let rss = 0;
    for (let i = 0; i < X.length; i++) {
      let pred = 0;
      for (let a = 0; a < k; a++) pred += X[i][a] * beta[a];
      rss += (y[i] - pred) ** 2;
    }
    return { beta, rss };
  }

  private grangerTest(target: number[], driver: number[], lag = 2) {
    if (target.length < lag + 12) {
      return { fStat: 0, pApprox: 1, lagOrder: lag, significantAt5Pct: false };
    }
    // First-difference to avoid spurious non-stationary regression
    const dy: number[] = [];
    const dx: number[] = [];
    for (let i = 1; i < target.length; i++) {
      dy.push(target[i] - target[i - 1]);
      dx.push(driver[i] - driver[i - 1]);
    }

    const Xr: number[][] = [];
    const Xu: number[][] = [];
    const Y: number[] = [];
    for (let t = lag; t < dy.length; t++) {
      const rowR = [1];
      const rowU = [1];
      for (let l = 1; l <= lag; l++) {
        rowR.push(dy[t - l]);
        rowU.push(dy[t - l]);
      }
      for (let l = 1; l <= lag; l++) {
        rowU.push(dx[t - l]);
      }
      Xr.push(rowR);
      Xu.push(rowU);
      Y.push(dy[t]);
    }

    const { rss: rssR } = this.olsRSS(Xr, Y);
    const { rss: rssU } = this.olsRSS(Xu, Y);
    const df1 = lag;
    const df2 = Math.max(1, Y.length - (2 * lag + 1));
    const fStat = rssU > 1e-12 ? ((rssR - rssU) / df1) / (rssU / df2) : 0;
    const pApprox = approxTwoTailedPValueFromT(Math.sqrt(Math.max(0, fStat)), df2);

    return {
      fStat: Number(Math.max(0, fStat).toFixed(3)),
      pApprox: Number(pApprox.toFixed(4)),
      lagOrder: lag,
      significantAt5Pct: pApprox < 0.05 && fStat > 3.1,
    };
  }

  public analyzeCrossIndicator(xId: string, yId: string, frequency: 'DAILY' | 'MONTHLY' = 'MONTHLY'): CrossIndicatorReport {
    const defX = INDICATOR_CATALOG.find((d) => d.id === xId);
    const defY = INDICATOR_CATALOG.find((d) => d.id === yId);
    const s1 = timeSeriesStore.getSeries(xId);
    const s2 = timeSeriesStore.getSeries(yId);
    const aligned = alignTwoSeries(s1, s2, frequency);

    const xs = aligned.map((p) => p.x);
    const ys = aligned.map((p) => p.y);
    const n = aligned.length;

    if (n < 8) {
      return {
        xId,
        yId,
        xName: defX?.namePt ?? xId,
        yName: defY?.namePt ?? yId,
        frequency,
        sampleStart: aligned[0]?.period ?? 'N/A',
        sampleEnd: aligned[n - 1]?.period ?? 'N/A',
        observations: n,
        pearsonR: 0,
        pearsonPValue: 1,
        spearmanRho: 0,
        olsSlope: 0,
        olsIntercept: 0,
        rSquared: 0,
        durbinWatson: 0,
        grangerXtoY: { fStat: 0, pApprox: 1, lagOrder: 2, significantAt5Pct: false },
        grangerYtoX: { fStat: 0, pApprox: 1, lagOrder: 2, significantAt5Pct: false },
        laggedCorrelations: [],
        rollingCorrelations: [],
        scatterPoints: aligned,
        limitations: ['Amostra sobreposta insuficiente (< 8 observações comuns) para inferência estatística confiável.'],
        interpretation: 'Dados insuficientes para cálculo de correlação ou regressão.',
      };
    }

    const r = this.pearson(xs, ys);
    const rho = this.spearman(xs, ys);
    const tStat = Math.abs(r) < 0.9999 ? (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r) : 99;
    const pValue = approxTwoTailedPValueFromT(tStat, n - 2);

    // OLS
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = my - slope * mx;

    const residuals = aligned.map((p) => p.y - (intercept + slope * p.x));
    let dwNum = 0;
    let dwDen = 0;
    for (let i = 0; i < residuals.length; i++) {
      dwDen += residuals[i] ** 2;
      if (i > 0) dwNum += (residuals[i] - residuals[i - 1]) ** 2;
    }
    const durbinWatson = dwDen > 1e-12 ? dwNum / dwDen : 2;

    // Lagged correlations (-6 to +6)
    const laggedCorrelations: Array<{ lag: number; r: number }> = [];
    for (let lag = -6; lag <= 6; lag++) {
      const lx: number[] = [];
      const ly: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = i + lag;
        if (j >= 0 && j < n) {
          lx.push(xs[i]);
          ly.push(ys[j]);
        }
      }
      laggedCorrelations.push({
        lag,
        r: lx.length >= 6 ? Number(this.pearson(lx, ly).toFixed(3)) : 0,
      });
    }

    // Rolling correlation
    const win = Math.min(24, Math.max(8, Math.floor(n / 3)));
    const rollingCorrelations: Array<{ period: string; r: number }> = [];
    for (let i = win; i <= n; i++) {
      const subX = xs.slice(i - win, i);
      const subY = ys.slice(i - win, i);
      rollingCorrelations.push({
        period: aligned[i - 1].period,
        r: Number(this.pearson(subX, subY).toFixed(3)),
      });
    }

    const grangerXtoY = this.grangerTest(ys, xs, 2);
    const grangerYtoX = this.grangerTest(xs, ys, 2);

    const strength =
      Math.abs(r) >= 0.7 ? 'forte' : Math.abs(r) >= 0.4 ? 'moderada' : Math.abs(r) >= 0.2 ? 'fraca' : 'desprezível';
    const dir = r >= 0 ? 'positiva' : 'negativa';

    const limitations = [
      'Correlação estatística não implica causalidade econômica direta.',
      durbinWatson < 1.3
        ? `Durbin-Watson = ${durbinWatson.toFixed(2)} indica autocorrelação positiva nos resíduos em nível; teste de Granger executado em primeiras diferenças.`
        : `Durbin-Watson = ${durbinWatson.toFixed(2)} dentro da faixa de referência.`,
      'Relações macroeconômicas podem sofrer quebras estruturais entre regimes monetários e choques externos.',
    ];

    return {
      xId,
      yId,
      xName: defX?.namePt ?? xId,
      yName: defY?.namePt ?? yId,
      frequency,
      sampleStart: aligned[0].period,
      sampleEnd: aligned[n - 1].period,
      observations: n,
      pearsonR: Number(r.toFixed(4)),
      pearsonPValue: Number(pValue.toFixed(4)),
      spearmanRho: Number(rho.toFixed(4)),
      olsSlope: Number(slope.toFixed(4)),
      olsIntercept: Number(intercept.toFixed(4)),
      rSquared: Number((r * r).toFixed(4)),
      durbinWatson: Number(durbinWatson.toFixed(3)),
      grangerXtoY,
      grangerYtoX,
      laggedCorrelations,
      rollingCorrelations,
      scatterPoints: aligned.slice(-180),
      limitations,
      interpretation: `Correlação linear de Pearson ${strength} e ${dir} (r = ${r.toFixed(3)}, p = ${pValue.toFixed(4)}, N = ${n}). Spearman ρ = ${rho.toFixed(3)} confirma monotonicidade. ${
        grangerXtoY.significantAt5Pct
          ? `Teste de Granger (lag 2 em Δ) sugere precedência estatística de ${defX?.code ?? xId} sobre ${defY?.code ?? yId} (F = ${grangerXtoY.fStat}).`
          : `Sem evidência estatística robusta de precedência de Granger ao nível de 5% na defasagem 2.`
      }`,
    };
  }

  public computeCorrelationMatrix(indicatorIds: string[], frequency: 'DAILY' | 'MONTHLY' = 'MONTHLY') {
    const matrix: Array<{ x: string; y: string; r: number; n: number }> = [];
    for (let i = 0; i < indicatorIds.length; i++) {
      for (let j = 0; j < indicatorIds.length; j++) {
        if (i === j) {
          matrix.push({ x: indicatorIds[i], y: indicatorIds[j], r: 1, n: timeSeriesStore.getSeries(indicatorIds[i]).length });
        } else {
          const aligned = alignTwoSeries(
            timeSeriesStore.getSeries(indicatorIds[i]),
            timeSeriesStore.getSeries(indicatorIds[j]),
            frequency
          );
          const r = aligned.length >= 6 ? this.pearson(aligned.map((a) => a.x), aligned.map((a) => a.y)) : 0;
          matrix.push({ x: indicatorIds[i], y: indicatorIds[j], r: Number(r.toFixed(3)), n: aligned.length });
        }
      }
    }
    return { indicatorIds, matrix };
  }

  /**
   * Econometric forecast with AR(1)+Damped-Trend+GARCH(1,1) & strict walk-forward validation.
   */
  public generateForecast(indicatorId: string, steps = 12): ForecastReport {
    const def = INDICATOR_CATALOG.find((d) => d.id === indicatorId);
    const series = timeSeriesStore.getSeries(indicatorId);
    const vals = series.map((p) => p.value);
    const n = vals.length;

    if (n < 15) {
      return {
        indicatorId,
        indicatorName: def?.namePt ?? indicatorId,
        unit: def?.unit ?? '',
        modelName: 'AR(1)-Damped + GARCH(1,1)',
        modelVersion: '1.0.0-quant',
        trainedAt: new Date().toISOString(),
        observationsUsed: n,
        validation: { method: 'Walk-Forward', mae: 0, rmse: 0, mase: 0, directionalAccuracyPct: 0, intervalCoverage90Pct: 0 },
        garchParams: { omega: 0, alpha: 0.1, beta: 0.85, persistence: 0.95 },
        historyTail: series.slice(-30).map((p) => ({ date: p.date, value: p.value })),
        horizonPoints: [],
        limitations: ['Série histórica insuficiente (< 15 observações) para estimação econométrica e validação walk-forward.'],
      };
    }

    // Walk-forward validation (zero look-ahead bias) on the last 30% of observations
    const minTrain = Math.max(10, Math.floor(n * 0.65));
    const errors: number[] = [];
    const absErrors: number[] = [];
    const naiveErrors: number[] = [];
    let dirCorrect = 0;
    let dirTotal = 0;
    let covered90 = 0;

    const fitAr1Drift = (train: number[]) => {
      const diffs: number[] = [];
      for (let i = 1; i < train.length; i++) diffs.push(train[i] - train[i - 1]);
      const mu = mean(diffs);
      const sd = Math.max(1e-6, stdDev(diffs));
      let num = 0;
      let den = 0;
      for (let i = 1; i < diffs.length; i++) {
        num += (diffs[i] - mu) * (diffs[i - 1] - mu);
        den += (diffs[i - 1] - mu) ** 2;
      }
      const phi = den > 1e-10 ? Math.max(-0.85, Math.min(0.85, num / den)) : 0;
      const lastDiff = diffs[diffs.length - 1] ?? 0;
      const nextDiff = mu + phi * (lastDiff - mu);
      return { pred: train[train.length - 1] + nextDiff, mu, phi, sigma: sd };
    };

    for (let t = minTrain; t < n; t++) {
      const train = vals.slice(0, t);
      const { pred, sigma } = fitAr1Drift(train);
      const actual = vals[t];
      const err = actual - pred;
      errors.push(err);
      absErrors.push(Math.abs(err));
      naiveErrors.push(Math.abs(actual - train[train.length - 1]));

      if (Math.sign(pred - train[train.length - 1]) === Math.sign(actual - train[train.length - 1])) {
        dirCorrect++;
      }
      dirTotal++;
      if (Math.abs(err) <= 1.645 * sigma) covered90++;
    }

    const mae = mean(absErrors);
    const rmse = Math.sqrt(mean(errors.map((e) => e * e)));
    const naiveMae = Math.max(1e-6, mean(naiveErrors));
    const mase = mae / naiveMae;

    // Fit full model & GARCH(1,1) conditional variance recursion
    const fullFit = fitAr1Drift(vals);
    const diffs: number[] = [];
    for (let i = 1; i < vals.length; i++) diffs.push(vals[i] - vals[i - 1]);
    const uncondVar = Math.max(1e-8, stdDev(diffs) ** 2);
    const alpha = 0.12;
    const beta = 0.82;
    const omega = uncondVar * (1 - alpha - beta);
    let h = uncondVar;
    for (const d of diffs.slice(-60)) {
      const eps = d - fullFit.mu;
      h = omega + alpha * eps * eps + beta * h;
    }

    const lastDate = new Date(series[n - 1].date);
    const isMonthly = def?.frequency === 'MONTHLY' || def?.frequency === 'ANNUAL';

    const horizonPoints: ForecastReport['horizonPoints'] = [];
    let currentLevel = vals[n - 1];
    let prevDiff = diffs[diffs.length - 1] ?? 0;
    let cumVar = 0;

    for (let s = 1; s <= steps; s++) {
      const dNext = fullFit.mu * Math.pow(0.92, s) + fullFit.phi * (prevDiff - fullFit.mu);
      currentLevel += dNext;
      prevDiff = dNext;
      h = omega + (alpha + beta) * h;
      cumVar += h;
      const sigmaH = Math.sqrt(cumVar);

      const nextDate = new Date(lastDate);
      if (isMonthly) nextDate.setMonth(nextDate.getMonth() + s);
      else nextDate.setDate(nextDate.getDate() + s);

      const lowerIsBetter =
        def?.category === 'INFLATION' ||
        def?.category === 'FISCAL' ||
        def?.id === 'USD_BRL_PTAX' ||
        def?.id === 'EUR_BRL_PTAX' ||
        def?.id === 'SELIC_META' ||
        def?.id === 'CDI_ANUAL' ||
        def?.id === 'DESEMPREGO_PNAD' ||
        def?.id === 'INADIMPLENCIA';
      const sign = lowerIsBetter ? 1 : -1;

      horizonPoints.push({
        step: s,
        date: nextDate.toISOString().slice(0, 10),
        central: Number(currentLevel.toFixed(4)),
        optimistic: Number((currentLevel - 0.85 * sigmaH * sign).toFixed(4)),
        adverse: Number((currentLevel + 1.28 * sigmaH * sign).toFixed(4)),
        severeStress: Number((currentLevel + 2.1 * sigmaH * sign).toFixed(4)),
        lower90: Number((currentLevel - 1.645 * sigmaH).toFixed(4)),
        upper90: Number((currentLevel + 1.645 * sigmaH).toFixed(4)),
      });
    }

    return {
      indicatorId,
      indicatorName: def?.namePt ?? indicatorId,
      unit: def?.unit ?? '',
      modelName: 'ARIMA(1,1,0)-Damped + GARCH(1,1)',
      modelVersion: 'SYGMA-QUANT-1.4',
      trainedAt: new Date().toISOString(),
      observationsUsed: n,
      validation: {
        method: `Walk-Forward Rolling Origin (N=${errors.length} passos fora da amostra, sem look-ahead)`,
        mae: Number(mae.toFixed(4)),
        rmse: Number(rmse.toFixed(4)),
        mase: Number(mase.toFixed(3)),
        directionalAccuracyPct: Number(((dirCorrect / Math.max(1, dirTotal)) * 100).toFixed(1)),
        intervalCoverage90Pct: Number(((covered90 / Math.max(1, errors.length)) * 100).toFixed(1)),
      },
      garchParams: {
        omega: Number(omega.toFixed(6)),
        alpha,
        beta,
        persistence: Number((alpha + beta).toFixed(3)),
      },
      historyTail: series.slice(-36).map((p) => ({ date: p.date, value: p.value })),
      horizonPoints,
      limitations: [
        'Projeções econométricas não são fatos confirmados e dependem de estabilidade estrutural.',
        'Choques fiscais, decisões extraordinárias do COPOM ou eventos geopolíticos não são antecipados por modelos univariados.',
      ],
    };
  }

  /**
   * 10,000-simulation Monte Carlo VaR + Historical/Parametric/Cornish-Fisher VaR + Dynamic Scenarios A..J.
   */
  public computeRiskReport(seed = 20261113, simulations = 10000): RiskReport {
    const totalObs = timeSeriesStore.getTotalObservationsCount();
    const cacheKey = `${seed}:${simulations}`;
    const cached = this.riskReportCache.get(cacheKey);
    if (cached && cached.obsCount === totalObs) {
      return cached.report;
    }

    const assets = [
      { indicatorId: 'IBOV', label: 'Renda Variável Brasil (IBOV)', weight: 0.35 },
      { indicatorId: 'USD_BRL_PTAX', label: 'Exposição Cambial (USD/BRL)', weight: 0.25 },
      { indicatorId: 'BRENT', label: 'Energia / Petróleo (Brent)', weight: 0.20 },
      { indicatorId: 'VALE3', label: 'Metais / Mineração (VALE3 Proxy)', weight: 0.20 },
    ];

    const seriesMap = assets.map((a) => ({
      ...a,
      series: timeSeriesStore.getSeries(a.indicatorId),
    }));

    // Build daily return matrix on overlapping dates
    const retMaps = seriesMap.map((item) => {
      const m = new Map<string, number>();
      for (let i = 1; i < item.series.length; i++) {
        const prev = item.series[i - 1].value;
        const curr = item.series[i].value;
        if (prev > 0 && curr > 0) {
          m.set(item.series[i].date, Math.log(curr / prev));
        }
      }
      return m;
    });

    const commonDates = Array.from(retMaps[0].keys())
      .filter((d) => retMaps.every((m) => m.has(d)))
      .sort();

    const portfolioReturns: number[] = [];
    for (const d of commonDates) {
      let r = 0;
      for (let k = 0; k < assets.length; k++) {
        r += assets[k].weight * (retMaps[k].get(d) ?? 0);
      }
      portfolioReturns.push(r);
    }

    const sortedHist = [...portfolioReturns].sort((a, b) => a - b);
    const histVar95 = sortedHist.length > 10 ? -percentile(sortedHist, 0.05) * 100 : 0;
    const histVar99 = sortedHist.length > 10 ? -percentile(sortedHist, 0.01) * 100 : 0;

    const mu = mean(portfolioReturns);
    const sigma = Math.max(1e-6, stdDev(portfolioReturns));
    const paramVar95 = -(mu + normalInvApprox(0.05) * sigma) * 100;

    // Skewness & Excess Kurtosis for Cornish-Fisher
    let m3 = 0;
    let m4 = 0;
    for (const r of portfolioReturns) {
      const z = (r - mu) / sigma;
      m3 += z ** 3;
      m4 += z ** 4;
    }
    const n = Math.max(1, portfolioReturns.length);
    const skew = m3 / n;
    const exKurt = m4 / n - 3;
    const z95 = normalInvApprox(0.05);
    const zCF =
      z95 +
      ((z95 * z95 - 1) * skew) / 6 +
      ((z95 ** 3 - 3 * z95) * exKurt) / 24 -
      ((2 * z95 ** 3 - 5 * z95) * skew * skew) / 36;
    const cornishFisherVar95 = -(mu + zCF * sigma) * 100;

    // 10,000-path Monte Carlo simulation (t-student heavy tail df=6 approximation via normal + chi2 scaling)
    const rand = createMulberry32(seed);
    const mcReturns: number[] = [];
    for (let i = 0; i < simulations; i++) {
      const z = boxMullerNormal(rand);
      const tailFactor = Math.sqrt(6 / Math.max(1.5, 4 + boxMullerNormal(rand) ** 2));
      mcReturns.push(mu + sigma * z * Math.min(2.2, Math.max(0.7, tailFactor)));
    }
    const sortedMc = [...mcReturns].sort((a, b) => a - b);
    const mcVar95 = -percentile(sortedMc, 0.05) * 100;
    const mcVar99 = -percentile(sortedMc, 0.01) * 100;

    const cutoff95 = Math.max(1, Math.floor(sortedMc.length * 0.05));
    const cutoff99 = Math.max(1, Math.floor(sortedMc.length * 0.01));
    const es95 = -mean(sortedMc.slice(0, cutoff95)) * 100;
    const es99 = -mean(sortedMc.slice(0, cutoff99)) * 100;

    // Max Drawdown of composite portfolio
    let equity = 100;
    let peak = 100;
    let maxDd = 0;
    for (const r of portfolioReturns) {
      equity *= Math.exp(r);
      if (equity > peak) peak = equity;
      const dd = (equity - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }

    // Histogram bins (24 bins)
    const minR = sortedMc[0] * 100;
    const maxR = sortedMc[sortedMc.length - 1] * 100;
    const bins = 24;
    const step = (maxR - minR) / bins || 0.1;
    const hist: RiskReport['monteCarloHistogram'] = [];
    for (let b = 0; b < bins; b++) {
      const lo = minR + b * step;
      const hi = lo + step;
      const count = mcReturns.filter((r) => {
        const pct = r * 100;
        return b === bins - 1 ? pct >= lo && pct <= hi : pct >= lo && pct < hi;
      }).length;
      hist.push({
        binLabel: `${lo.toFixed(2)}%`,
        count,
        isTail95: hi <= -mcVar95,
      });
    }

    // Dynamic empirical factor-beta estimation for Stress Scenarios A-J
    // Computes portfolio beta with respect to each external factor from historical monthly/daily percentage changes
    const estimatePortfolioFactorBeta = (factorId: string, fallbackBeta: number): number => {
      if (commonDates.length < 20) return fallbackBeta;
      const factorSeries = timeSeriesStore.getSeries(factorId);
      if (factorSeries.length < 20) return fallbackBeta;

      const aligned = alignTwoSeries(
        commonDates.map((d, idx) => ({
          date: d,
          value: portfolioReturns[idx],
          referencePeriod: d,
          publishedAt: d,
          ingestedAt: d,
          revisionCount: 0,
          status: 'HISTORICAL' as const,
          sourceId: 'portfolio',
          sourceName: 'Portfolio',
          digestSha256: '',
        })),
        factorSeries,
        'MONTHLY'
      );

      if (aligned.length < 18) return fallbackBeta;
      const pChanges: number[] = [];
      const fChanges: number[] = [];
      for (let i = 1; i < aligned.length; i++) {
        if (Math.abs(aligned[i - 1].y) > 1e-6) {
          pChanges.push(aligned[i].x * 21); // monthly scale proxy
          fChanges.push((aligned[i].y - aligned[i - 1].y) / Math.abs(aligned[i - 1].y));
        }
      }
      if (fChanges.length < 12) return fallbackBeta;
      const mf = mean(fChanges);
      const mp = mean(pChanges);
      let cov = 0;
      let vf = 0;
      for (let i = 0; i < fChanges.length; i++) {
        cov += (fChanges[i] - mf) * (pChanges[i] - mp);
        vf += (fChanges[i] - mf) ** 2;
      }
      if (vf <= 1e-10) return fallbackBeta;
      const beta = cov / vf;
      return Math.max(-1.8, Math.min(1.8, Number(beta.toFixed(3))));
    };

    const betaSp500 = estimatePortfolioFactorBeta('SP500', 0.42);
    const betaIron = estimatePortfolioFactorBeta('IRON_ORE', 0.24);

    // Direct asset weights: [0]=IBOV(0.35), [1]=USD_BRL(0.25), [2]=BRENT(0.20), [3]=VALE3(0.20)
    const evalShock = (assetShocksPct: { ibov: number; usdBrl: number; brent: number; vale3: number }) => {
      const impactPct =
        assets[0].weight * assetShocksPct.ibov +
        assets[1].weight * assetShocksPct.usdBrl +
        assets[2].weight * assetShocksPct.brent +
        assets[3].weight * assetShocksPct.vale3;
      const roundedPct = Number(impactPct.toFixed(2));
      return {
        estimatedPortfolioImpactPct: roundedPct,
        estimatedBrlImpactPer100M: Math.round((roundedPct / 100) * 100_000_000),
      };
    };

    // Scenarios A-J (Dynamic weight-driven propagation of documented hypothetical shocks)
    const scenarioSpecs = [
      {
        code: 'A',
        namePt: 'Choque Monetário: SELIC +2,00 p.p.',
        nameEn: 'Monetary Shock: SELIC +200 bps',
        shockDescription: 'Aumento súbito de +200 bps na taxa básica; compressão de múltiplos B3 (-6,4%), apreciação cambial (-2,5%), VALE3 (-2,0%) e Brent neutro (0%).',
        ...evalShock({ ibov: -6.4, usdBrl: -2.5, brent: 0, vale3: -2.0 }),
        transmissionChannels: ['Custo de capital (WACC)', 'Curva DI longa', 'Consumo e crédito corporativo'],
      },
      {
        code: 'B',
        namePt: 'Choque Cambial: USD/BRL +15%',
        nameEn: 'FX Shock: USD/BRL +15%',
        shockDescription: 'Depreciação aguda de 15% do Real; componente cambial (+15%) e exportadora VALE3 (+5%) parcialmente compensados por ações domésticas (-4,5%) e Brent (+2%).',
        ...evalShock({ ibov: -4.5, usdBrl: 15.0, brent: 2.0, vale3: 5.0 }),
        transmissionChannels: ['Repasse inflacionário (pass-through)', 'Dívida externa corporativa', 'Receita de exportadoras'],
      },
      {
        code: 'C',
        namePt: 'Choque Energético: Brent -25%',
        nameEn: 'Energy Shock: Brent -25%',
        shockDescription: 'Queda de 25% no Brent; impacto direto na parcela energia (-25%), pressão em IBOV/Petrobras (-4,2%) e desvalorização parcial em commodities (-2%).',
        ...evalShock({ ibov: -4.2, usdBrl: 1.5, brent: -25.0, vale3: -3.5 }),
        transmissionChannels: ['Exportações de óleo bruto', 'Arrecadação de royalties', 'Ações de energia'],
      },
      {
        code: 'D',
        namePt: 'Choque Metais: Minério de Ferro -30%',
        nameEn: 'Metals Shock: Iron Ore -30%',
        shockDescription: `Queda de 30% no minério de ferro (beta empírico portfólio=${betaIron}); choque direto em VALE3 (-24%), IBOV (-4,8%) e pressão cambial (+2,5%).`,
        ...evalShock({ ibov: -4.8, usdBrl: 2.5, brent: -4.0, vale3: Number((-30 * Math.max(0.65, betaIron + 0.55)).toFixed(2)) }),
        transmissionChannels: ['Balança comercial FOB', 'Termos de troca', 'VALE3 e siderurgia'],
      },
      {
        code: 'E',
        namePt: 'Choque Inflacionário: IPCA +3,00 p.p.',
        nameEn: 'Inflation Shock: IPCA +300 bps',
        shockDescription: 'Desancoragem inflacionária exigindo prêmio na curva real (NTN-B), retração em IBOV (-7,5%), alta no dólar (+4,0%) e VALE3 (-4,5%).',
        ...evalShock({ ibov: -7.5, usdBrl: 4.0, brent: 2.0, vale3: -4.5 }),
        transmissionChannels: ['Poder de compra', 'Reprecificação da curva de juros', 'Margens do varejo'],
      },
      {
        code: 'F',
        namePt: 'Desaceleração da China (-2,0 p.p. PIB)',
        nameEn: 'China Growth Slowdown',
        shockDescription: 'Contração da demanda chinesa por minério e petróleo; queda em VALE3 (-18%), Brent (-14%), IBOV (-8%) e depreciação do Real (+4%).',
        ...evalShock({ ibov: -8.0, usdBrl: 4.0, brent: -14.0, vale3: -18.0 }),
        transmissionChannels: ['Exportações brasileiras (31% destino China)', 'Minério e agro', 'Fluxo cambial'],
      },
      {
        code: 'G',
        namePt: 'Recessão nos Estados Unidos',
        nameEn: 'US Recession Scenario',
        shockDescription: `Aversão global ao risco (beta empírico S&P 500=${betaSp500}), queda de Brent (-18%), VALE3 (-12%), IBOV (-11%) e USD/BRL (+5%).`,
        ...evalShock({ ibov: -11.0, usdBrl: 5.0, brent: -18.0, vale3: Number((-12 - Math.abs(betaSp500) * 4).toFixed(2)) }),
        transmissionChannels: ['Fluxo de portfólio', 'Commodities cíclicas', 'Prêmio de risco emergente'],
      },
      {
        code: 'H',
        namePt: 'Crise Fiscal Doméstica no Brasil',
        nameEn: 'Brazilian Fiscal Stress',
        shockDescription: 'Abertura de +250 bps na curva longa de juros, USD/BRL +18%, retração severa em IBOV (-16%) e VALE3 (-8%).',
        ...evalShock({ ibov: -16.0, usdBrl: 18.0, brent: 0, vale3: -8.0 }),
        transmissionChannels: ['Risco soberano (CDS)', 'Sustentabilidade DBGG/PIB', 'Desancoragem cambial'],
      },
      {
        code: 'I',
        namePt: 'Estresse Financeiro Global (VIX > 40)',
        nameEn: 'Global Financial Stress',
        shockDescription: 'Aumento súbito de correlação cruzada (~0.85), queda em IBOV (-18%), Brent (-15%), VALE3 (-16%) e busca por dólar (+7%).',
        ...evalShock({ ibov: -18.0, usdBrl: 7.0, brent: -15.0, vale3: -16.0 }),
        transmissionChannels: ['Liquidez em dólar', 'Desalavancagem global', 'Volatilidade implícita'],
      },
      {
        code: 'J',
        namePt: 'Cenário Adverso Combinado (Fiscal + Externo)',
        nameEn: 'Combined Severe Adverse Scenario',
        shockDescription: 'Choque composto hipotético: crise fiscal doméstica (IBOV -24%, VALE3 -22%) + queda de Brent (-25%) + dólar (+12%).',
        ...evalShock({ ibov: -24.0, usdBrl: 12.0, brent: -25.0, vale3: -22.0 }),
        transmissionChannels: ['Contágio sistêmico', 'Estresse cambial e juros', 'Choque nos termos de troca'],
      },
    ];

    const stressScenarios: RiskReport['stressScenarios'] = scenarioSpecs.map((sc) => ({
      ...sc,
      isHypothetical: true,
    }));

    const report: RiskReport = {
      generatedAt: new Date().toISOString(),
      seed,
      simulations,
      confidenceLevels: [0.95, 0.99],
      portfolioAssumptions: seriesMap.map((s) => ({
        indicatorId: s.indicatorId,
        label: s.label,
        weight: s.weight,
        latestValue: s.series[s.series.length - 1]?.value ?? 0,
      })),
      metrics: {
        historicalVar95Pct: Number(histVar95.toFixed(2)),
        historicalVar99Pct: Number(histVar99.toFixed(2)),
        parametricVar95Pct: Number(paramVar95.toFixed(2)),
        cornishFisherVar95Pct: Number(cornishFisherVar95.toFixed(2)),
        monteCarloVar95Pct: Number(mcVar95.toFixed(2)),
        monteCarloVar99Pct: Number(mcVar99.toFixed(2)),
        expectedShortfall95Pct: Number(es95.toFixed(2)),
        expectedShortfall99Pct: Number(es99.toFixed(2)),
        annualizedVolatilityPct: Number((sigma * Math.sqrt(252) * 100).toFixed(2)),
        maxDrawdownPct: Number((maxDd * 100).toFixed(2)),
        skewness: Number(skew.toFixed(3)),
        excessKurtosis: Number(exKurt.toFixed(3)),
      },
      monteCarloHistogram: hist,
      stressScenarios,
      limitations: [
        `Base histórica sobreposta de ${commonDates.length} pregões diários comuns entre os fatores selecionados.`,
        'Cenários A–J propagam choques hipotéticos determinísticos pelos pesos do portfólio e sensibilidades empíricas históricas.',
        'Em crises extremas, correlações históricas tendem a convergir para 1, podendo subestimar perdas em modelos lineares.',
      ],
    };

    this.riskReportCache.set(cacheKey, { obsCount: totalObs, report });
    return report;
  }

  public computeBrazilPulse(): BrazilPulseReport {
    const specs: Array<{
      id: string;
      namePt: string;
      nameEn: string;
      indicatorId: string;
      weight: number;
      higherIsBetter: boolean;
    }> = [
      { id: 'growth', namePt: 'Crescimento Econômico (IBC-Br)', nameEn: 'Economic Growth (IBC-Br)', indicatorId: 'IBC_BR', weight: 0.12, higherIsBetter: true },
      { id: 'inflation', namePt: 'Inflação (IPCA Mensal)', nameEn: 'Inflation (IPCA)', indicatorId: 'IPCA_MENSAL', weight: 0.14, higherIsBetter: false },
      { id: 'monetary', namePt: 'Condições Monetárias (Selic)', nameEn: 'Monetary Conditions (Selic)', indicatorId: 'SELIC_META', weight: 0.10, higherIsBetter: false },
      { id: 'fiscal', namePt: 'Sustentabilidade Fiscal (DBGG/PIB)', nameEn: 'Fiscal Sustainability (Gross Debt/GDP)', indicatorId: 'DIVIDA_BRUTA_PIB', weight: 0.14, higherIsBetter: false },
      { id: 'external', namePt: 'Setor Externo (Balança Comercial)', nameEn: 'External Sector (Trade Balance)', indicatorId: 'BALANCA_COMERCIAL', weight: 0.10, higherIsBetter: true },
      { id: 'labor', namePt: 'Emprego (Desocupação PNAD)', nameEn: 'Labor Market (PNAD Unemployment)', indicatorId: 'DESEMPREGO_PNAD', weight: 0.10, higherIsBetter: false },
      { id: 'credit', namePt: 'Crédito (Inadimplência SFN)', nameEn: 'Credit Conditions (Default Rate)', indicatorId: 'INADIMPLENCIA', weight: 0.08, higherIsBetter: false },
      { id: 'markets', namePt: 'Mercados Financeiros (IBOV)', nameEn: 'Financial Markets (IBOV)', indicatorId: 'IBOV', weight: 0.08, higherIsBetter: true },
      { id: 'commodities', namePt: 'Commodities (Soja / Exportação)', nameEn: 'Commodity Exposure (Soybeans)', indicatorId: 'SOYBEANS', weight: 0.07, higherIsBetter: true },
      { id: 'global', namePt: 'Ambiente Internacional (US 10Y)', nameEn: 'Global Environment (US 10Y Yield)', indicatorId: 'US_10Y', weight: 0.07, higherIsBetter: false },
    ];

    const dimensions: BrazilPulseDimension[] = [];
    let weightedSum = 0;
    let totalActiveWeight = 0;

    for (const sp of specs) {
      const def = INDICATOR_CATALOG.find((d) => d.id === sp.indicatorId);
      const series = timeSeriesStore.getSeries(sp.indicatorId);
      const latest = series[series.length - 1] ?? null;
      const vals = series.map((p) => p.value);
      const status = def ? timeSeriesStore.computeFreshnessStatus(def, latest) : 'MISSING';

      if (!latest || vals.length < 6) {
        dimensions.push({
          id: sp.id,
          namePt: sp.namePt,
          nameEn: sp.nameEn,
          score: 50,
          weight: sp.weight,
          statusLabelPt: 'Dados Insuficientes',
          statusLabelEn: 'Insufficient Data',
          primaryIndicatorId: sp.indicatorId,
          primaryValue: latest?.value ?? null,
          primaryUnit: def?.unit ?? '',
          zScore: null,
          dataStatus: status,
        });
        continue;
      }

      const m = mean(vals);
      const sd = Math.max(1e-6, stdDev(vals));
      const rawZ = (latest.value - m) / sd;
      const signedZ = sp.higherIsBetter ? rawZ : -rawZ;
      const score = Math.max(5, Math.min(95, Number((50 + signedZ * 15).toFixed(1))));

      weightedSum += score * sp.weight;
      totalActiveWeight += sp.weight;

      const labelPt =
        score >= 65 ? 'Favorável' : score >= 52 ? 'Estável' : score >= 40 ? 'Cautela' : score >= 28 ? 'Adverso' : 'Estresse';
      const labelEn =
        score >= 65 ? 'Favorable' : score >= 52 ? 'Stable' : score >= 40 ? 'Caution' : score >= 28 ? 'Adverse' : 'Stress';

      dimensions.push({
        id: sp.id,
        namePt: sp.namePt,
        nameEn: sp.nameEn,
        score,
        weight: sp.weight,
        statusLabelPt: labelPt,
        statusLabelEn: labelEn,
        primaryIndicatorId: sp.indicatorId,
        primaryValue: latest.value,
        primaryUnit: def?.unit ?? '',
        zScore: Number(rawZ.toFixed(2)),
        dataStatus: status,
      });
    }

    const composite = totalActiveWeight >= 0.5 ? Number((weightedSum / totalActiveWeight).toFixed(1)) : null;
    let assessment: BrazilPulseReport['assessment'] = 'INSUFFICIENT_DATA';
    if (composite !== null) {
      if (composite >= 65) assessment = 'FAVORABLE';
      else if (composite >= 52) assessment = 'STABLE';
      else if (composite >= 40) assessment = 'CAUTION';
      else if (composite >= 28) assessment = 'ADVERSE';
      else assessment = 'SEVERE_STRESS';
    }

    return {
      generatedAt: new Date().toISOString(),
      compositeScore: composite,
      assessment,
      dimensions,
      methodology: {
        formula: 'Composite = Σ (w_i * clamp(50 + 15 * s_i * ((x_i - μ_i) / σ_i), 5, 95)) / Σ w_i',
        normalization: 'Z-Score histórico padronizado sobre toda a janela armazenada (50 = mediana/média histórica neutra).',
        missingDataTreatment: 'Indicadores ausentes são excluídos da média ponderada com renormalização proporcional dos pesos ativos.',
        disclaimer: 'Índice analítico proprietário SYGMA AIS para monitoramento técnico; NÃO representa índice oficial do governo brasileiro.',
      },
    };
  }

  public evaluateHistoricalBacktest(
    rawSeries: ObservationPoint[],
    options: {
      indicatorId: string;
      indicatorCode?: string;
      indicatorName?: string;
      unit?: string;
      category?: string;
      frequency?: string;
      strategy?: BacktestStrategy;
      range?: string;
      transactionCostBps?: number;
    }
  ): BacktestReport {
    const strategy: BacktestStrategy = options.strategy || 'TREND_SMA_CROSSOVER';
    const range = options.range || '3Y';
    const costBps = Math.max(0, Math.min(200, Number(options.transactionCostBps ?? 10)));
    const costRate = costBps / 10000;

    const strategyLabels: Record<BacktestStrategy, string> = {
      TREND_SMA_CROSSOVER: 'Cruzamento de Médias Móveis (SMA Curta vs Longa)',
      MEAN_REVERSION_ZSCORE: 'Reversão à Média por Z-Score Rolante (±0,75σ)',
      AR1_WALK_FORWARD: 'AR(1) Econométrico Walk-Forward (Sem Look-Ahead)',
      MOMENTUM_REGIME: 'Momentum Direcional & Quebra de Mediana Rolante',
    };

    let series = [...rawSeries].filter((p) => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
    if (range !== 'MAX' && series.length > 0) {
      const lastTs = Date.parse(series[series.length - 1].date);
      const daysMap: Record<string, number> = {
        '6M': 186,
        '1Y': 366,
        '3Y': 1096,
        '5Y': 1827,
      };
      const days = daysMap[range];
      if (days && !Number.isNaN(lastTs)) {
        const cutoff = lastTs - days * 86400_000;
        const sliced = series.filter((p) => Date.parse(p.date) >= cutoff);
        if (sliced.length >= 24) {
          series = sliced;
        }
      }
    }

    const isPriceCategory = ['FX', 'EQUITIES_BR', 'EQUITIES_GLOBAL', 'COMMODITIES', 'ACTIVITY', 'CREDIT'].includes(
      options.category || 'EQUITIES_BR'
    );
    const allPositive = series.length > 0 && series.every((p) => p.value > 0);
    const evaluationMode: BacktestReport['evaluationMode'] =
      isPriceCategory && allPositive ? 'PRICE_RETURN' : 'RATE_DIRECTIONAL';

    if (series.length < 24) {
      return {
        indicatorId: options.indicatorId,
        indicatorCode: options.indicatorCode || options.indicatorId,
        indicatorName: options.indicatorName || options.indicatorId,
        unit: options.unit || '',
        strategy,
        strategyLabelPt: strategyLabels[strategy],
        range,
        evaluationMode,
        transactionCostBps: costBps,
        observationsTested: 0,
        sampleStart: series[0]?.date ?? 'N/D',
        sampleEnd: series[series.length - 1]?.date ?? 'N/D',
        metrics: {
          totalReturnPct: 0,
          cagrPct: 0,
          benchmarkReturnPct: 0,
          benchmarkCagrPct: 0,
          alphaPct: 0,
          annualizedVolatilityPct: 0,
          sharpeRatio: 0,
          sortinoRatio: 0,
          maxDrawdownPct: 0,
          benchmarkMaxDrawdownPct: 0,
          winRatePct: 0,
          profitFactor: 0,
          tradesCount: 0,
          exposurePct: 0,
          walkForwardMae: 0,
          walkForwardRmse: 0,
          directionalAccuracyPct: 0,
        },
        equityCurve: [],
        annualBreakdown: [],
        recentTrades: [],
        methodologyNote: 'Amostra mínima de 24 observações necessária para iniciar janela causal de backtest.',
        limitations: ['Série histórica insuficiente (< 24 observações) na janela selecionada para execução de backtesting.'],
      };
    }

    const vals = series.map((p) => p.value);
    const dates = series.map((p) => p.date);
    const n = vals.length;

    const isDaily = options.frequency === 'DAILY' || options.frequency === 'INTRADAY' || n > 140;
    const periodsPerYear = isDaily ? 252 : 12;
    const fastWin = isDaily ? Math.min(20, Math.max(5, Math.floor(n * 0.08))) : Math.min(6, Math.max(3, Math.floor(n * 0.12)));
    const slowWin = isDaily ? Math.min(50, Math.max(fastWin + 5, Math.floor(n * 0.2))) : Math.min(12, Math.max(fastWin + 3, Math.floor(n * 0.28)));
    const startIndex = Math.max(12, slowWin);

    let strategyEquity = 100;
    let benchmarkEquity = 100;
    let stratPeak = 100;
    let benchPeak = 100;
    let maxStratDd = 0;
    let maxBenchDd = 0;

    let currentPosition = 0; // 0 = Cash/Defensive, 1 = Exposed/Long
    let activeTradeEntryDate = '';
    let activeTradeEntryVal = 0;
    let activeTradeEquityAtEntry = 100;
    let activeTradePeriods = 0;

    const equityCurve: BacktestEquityPoint[] = [
      {
        date: dates[startIndex],
        price: Number(vals[startIndex].toFixed(4)),
        strategyEquity: 100,
        benchmarkEquity: 100,
        drawdownPct: 0,
        benchmarkDrawdownPct: 0,
        signalPosition: 0,
        periodReturnPct: 0,
      },
    ];

    const recentTrades: BacktestTradeRecord[] = [];
    const stratPeriodRets: number[] = [];
    const benchPeriodRets: number[] = [];
    const forecastErrors: number[] = [];
    let dirCorrect = 0;
    let dirTotal = 0;
    let tradesCount = 0;
    let exposedPeriods = 0;
    let winningPeriods = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    const annualAccum = new Map<
      string,
      {
        stratProd: number;
        benchProd: number;
        peak: number;
        eq: number;
        maxDd: number;
        trades: number;
        observations: number;
      }
    >();

    for (let t = startIndex; t < n - 1; t++) {
      const history = vals.slice(0, t + 1);
      const curr = vals[t];
      const next = vals[t + 1];

      // 1. Causal AR(1)+Drift forecast for error metrics & AR1_WALK_FORWARD signal
      const diffs: number[] = [];
      for (let i = Math.max(1, history.length - 80); i < history.length; i++) {
        diffs.push(history[i] - history[i - 1]);
      }
      const muD = mean(diffs);
      let numAr = 0;
      let denAr = 0;
      for (let i = 1; i < diffs.length; i++) {
        numAr += (diffs[i] - muD) * (diffs[i - 1] - muD);
        denAr += (diffs[i - 1] - muD) ** 2;
      }
      const phi = denAr > 1e-10 ? Math.max(-0.85, Math.min(0.85, numAr / denAr)) : 0;
      const predDelta = muD + phi * ((diffs[diffs.length - 1] ?? 0) - muD);
      const predNext = curr + predDelta;

      const actualDelta = next - curr;
      forecastErrors.push(next - predNext);
      if (Math.sign(predDelta) === Math.sign(actualDelta)) {
        dirCorrect++;
      }
      dirTotal++;

      // 2. Causal strategy signal decision strictly from vals[0..t]
      let targetPosition = currentPosition;
      if (strategy === 'TREND_SMA_CROSSOVER') {
        const smaFast = mean(history.slice(-fastWin));
        const smaSlow = mean(history.slice(-slowWin));
        targetPosition = smaFast > smaSlow ? 1 : 0;
      } else if (strategy === 'MEAN_REVERSION_ZSCORE') {
        const win = history.slice(-fastWin);
        const mWin = mean(win);
        const sdWin = Math.max(1e-6, stdDev(win));
        const z = (curr - mWin) / sdWin;
        if (z < -0.75) targetPosition = 1;
        else if (z > 0.75) targetPosition = 0;
      } else if (strategy === 'AR1_WALK_FORWARD') {
        const denom = Math.max(1e-4, Math.abs(curr));
        const expectedRet = evaluationMode === 'PRICE_RETURN' ? predDelta / denom : predDelta;
        const hurdle = evaluationMode === 'PRICE_RETURN' ? costRate * 0.5 : 0;
        targetPosition = expectedRet > hurdle ? 1 : 0;
      } else if (strategy === 'MOMENTUM_REGIME') {
        const win = history.slice(-fastWin);
        const sortedWin = [...win].sort((a, b) => a - b);
        const med = sortedWin[Math.floor(sortedWin.length / 2)];
        const lookbackBase = history[Math.max(0, history.length - fastWin)];
        targetPosition = curr > lookbackBase && curr >= med ? 1 : 0;
      }

      const switched = targetPosition !== currentPosition;
      if (switched) {
        if (targetPosition === 1) {
          tradesCount++;
          activeTradeEntryDate = dates[t];
          activeTradeEntryVal = curr;
          activeTradeEquityAtEntry = strategyEquity;
          activeTradePeriods = 0;
        } else if (currentPosition === 1 && activeTradeEntryDate) {
          const tradeRet = (strategyEquity / activeTradeEquityAtEntry - 1) * 100;
          recentTrades.push({
            entryDate: activeTradeEntryDate,
            exitDate: dates[t],
            entryValue: Number(activeTradeEntryVal.toFixed(4)),
            exitValue: Number(curr.toFixed(4)),
            netReturnPct: Number(tradeRet.toFixed(2)),
            holdingPeriods: activeTradePeriods,
          });
          activeTradeEntryDate = '';
        }
      }

      currentPosition = targetPosition;
      if (currentPosition === 1) {
        exposedPeriods++;
        activeTradePeriods++;
      }

      // 3. Period return (t -> t+1)
      let benchRet = 0;
      if (evaluationMode === 'PRICE_RETURN') {
        benchRet = curr > 0 ? next / curr - 1 : 0;
      } else {
        // Bounded relative rate-change proxy so additive rate/macro series never divide by zero
        benchRet = Math.max(-0.15, Math.min(0.15, (next - curr) / Math.max(1, Math.abs(curr))));
      }
      const turnoverCost = switched ? costRate : 0;
      const stratRet = Math.max(-0.95, currentPosition * benchRet - turnoverCost);

      stratPeriodRets.push(stratRet);
      benchPeriodRets.push(benchRet);

      if (currentPosition === 1) {
        if (stratRet > 0) winningPeriods++;
      }
      if (stratRet > 0) grossProfit += stratRet;
      else grossLoss += Math.abs(stratRet);

      strategyEquity *= 1 + stratRet;
      benchmarkEquity *= 1 + benchRet;

      if (strategyEquity > stratPeak) stratPeak = strategyEquity;
      if (benchmarkEquity > benchPeak) benchPeak = benchmarkEquity;

      const dd = (strategyEquity - stratPeak) / stratPeak;
      const bdd = (benchmarkEquity - benchPeak) / benchPeak;
      if (dd < maxStratDd) maxStratDd = dd;
      if (bdd < maxBenchDd) maxBenchDd = bdd;

      const yr = dates[t + 1].slice(0, 4);
      const yrEntry = annualAccum.get(yr) ?? {
        stratProd: 1,
        benchProd: 1,
        peak: 1,
        eq: 1,
        maxDd: 0,
        trades: 0,
        observations: 0,
      };
      yrEntry.stratProd *= 1 + stratRet;
      yrEntry.benchProd *= 1 + benchRet;
      yrEntry.eq *= 1 + stratRet;
      if (yrEntry.eq > yrEntry.peak) yrEntry.peak = yrEntry.eq;
      const yrDd = (yrEntry.eq - yrEntry.peak) / yrEntry.peak;
      if (yrDd < yrEntry.maxDd) yrEntry.maxDd = yrDd;
      if (switched && targetPosition === 1) yrEntry.trades++;
      yrEntry.observations++;
      annualAccum.set(yr, yrEntry);

      equityCurve.push({
        date: dates[t + 1],
        price: Number(next.toFixed(4)),
        strategyEquity: Number(strategyEquity.toFixed(2)),
        benchmarkEquity: Number(benchmarkEquity.toFixed(2)),
        drawdownPct: Number((dd * 100).toFixed(2)),
        benchmarkDrawdownPct: Number((bdd * 100).toFixed(2)),
        signalPosition: currentPosition,
        periodReturnPct: Number((stratRet * 100).toFixed(3)),
      });
    }

    // Close any open trade cleanly in summary log as open mark-to-market
    if (currentPosition === 1 && activeTradeEntryDate) {
      const tradeRet = (strategyEquity / activeTradeEquityAtEntry - 1) * 100;
      recentTrades.push({
        entryDate: activeTradeEntryDate,
        exitDate: `${dates[n - 1]} (Aberto)`,
        entryValue: Number(activeTradeEntryVal.toFixed(4)),
        exitValue: Number(vals[n - 1].toFixed(4)),
        netReturnPct: Number(tradeRet.toFixed(2)),
        holdingPeriods: activeTradePeriods,
      });
    }

    const obsTested = stratPeriodRets.length;
    const totalReturnPct = (strategyEquity / 100 - 1) * 100;
    const benchmarkReturnPct = (benchmarkEquity / 100 - 1) * 100;
    const yearsSpan = Math.max(0.25, obsTested / periodsPerYear);
    const cagrPct = (Math.pow(Math.max(1e-4, strategyEquity / 100), 1 / yearsSpan) - 1) * 100;
    const benchmarkCagrPct = (Math.pow(Math.max(1e-4, benchmarkEquity / 100), 1 / yearsSpan) - 1) * 100;

    const meanR = mean(stratPeriodRets);
    const sdR = stdDev(stratPeriodRets);
    const annVolPct = sdR * Math.sqrt(periodsPerYear) * 100;
    const sharpeRatio = sdR > 1e-8 ? (meanR / sdR) * Math.sqrt(periodsPerYear) : 0;

    const negRets = stratPeriodRets.filter((r) => r < 0);
    const downDev =
      negRets.length > 0
        ? Math.sqrt(negRets.reduce((s, r) => s + r * r, 0) / Math.max(1, stratPeriodRets.length))
        : 0;
    const sortinoRatio = downDev > 1e-8 ? (meanR / downDev) * Math.sqrt(periodsPerYear) : sharpeRatio;

    const wfMae = mean(forecastErrors.map((e) => Math.abs(e)));
    const wfRmse = Math.sqrt(mean(forecastErrors.map((e) => e * e)));

    const annualBreakdown: BacktestAnnualRow[] = Array.from(annualAccum.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, d]) => {
        const sPct = (d.stratProd - 1) * 100;
        const bPct = (d.benchProd - 1) * 100;
        return {
          year,
          strategyReturnPct: Number(sPct.toFixed(2)),
          benchmarkReturnPct: Number(bPct.toFixed(2)),
          alphaPct: Number((sPct - bPct).toFixed(2)),
          maxDrawdownPct: Number((d.maxDd * 100).toFixed(2)),
          trades: d.trades,
          observations: d.observations,
        };
      });

    // Downsample equity curve gracefully only if huge (> 450 points) while always preserving start & end
    const maxCurvePts = 420;
    const sampledCurve =
      equityCurve.length <= maxCurvePts
        ? equityCurve
        : equityCurve.filter((_, idx) => idx === 0 || idx === equityCurve.length - 1 || idx % Math.ceil(equityCurve.length / maxCurvePts) === 0);

    return {
      indicatorId: options.indicatorId,
      indicatorCode: options.indicatorCode || options.indicatorId,
      indicatorName: options.indicatorName || options.indicatorId,
      unit: options.unit || '',
      strategy,
      strategyLabelPt: strategyLabels[strategy],
      range,
      evaluationMode,
      transactionCostBps: costBps,
      observationsTested: obsTested,
      sampleStart: dates[startIndex],
      sampleEnd: dates[n - 1],
      metrics: {
        totalReturnPct: Number(totalReturnPct.toFixed(2)),
        cagrPct: Number(cagrPct.toFixed(2)),
        benchmarkReturnPct: Number(benchmarkReturnPct.toFixed(2)),
        benchmarkCagrPct: Number(benchmarkCagrPct.toFixed(2)),
        alphaPct: Number((totalReturnPct - benchmarkReturnPct).toFixed(2)),
        annualizedVolatilityPct: Number(annVolPct.toFixed(2)),
        sharpeRatio: Number(sharpeRatio.toFixed(2)),
        sortinoRatio: Number(sortinoRatio.toFixed(2)),
        maxDrawdownPct: Number((maxStratDd * 100).toFixed(2)),
        benchmarkMaxDrawdownPct: Number((maxBenchDd * 100).toFixed(2)),
        winRatePct: Number(((winningPeriods / Math.max(1, exposedPeriods)) * 100).toFixed(1)),
        profitFactor: Number((grossLoss > 1e-8 ? Math.min(99, grossProfit / grossLoss) : grossProfit > 0 ? 10 : 0).toFixed(2)),
        tradesCount,
        exposurePct: Number(((exposedPeriods / Math.max(1, obsTested)) * 100).toFixed(1)),
        walkForwardMae: Number(wfMae.toFixed(4)),
        walkForwardRmse: Number(wfRmse.toFixed(4)),
        directionalAccuracyPct: Number(((dirCorrect / Math.max(1, dirTotal)) * 100).toFixed(1)),
      },
      equityCurve: sampledCurve,
      annualBreakdown,
      recentTrades: recentTrades.slice(-16).reverse(),
      methodologyNote:
        evaluationMode === 'PRICE_RETURN'
          ? `Simulação estritamente causal (sem look-ahead): o sinal decidido no fechamento de t utilizando apenas observações [0..t] captura o retorno multiplicativo de t → t+1, com desconto de ${costBps} bps por troca de posição.`
          : `Backtest direcional causal para série de taxa/percentual: avalia acurácia direcional out-of-sample (MAE/RMSE/Acerto %) e retorno tático normalizado de regime sem look-ahead.`,
      limitations: [
        'Desempenho histórico simulado não garante resultados futuros e não considera slippage variável de liquidez em estresse extremo.',
        'Custos operacionais modelados em taxa fixa por rotação de posição (' + costBps + ' bps).',
      ],
    };
  }

  public runHistoricalBacktest(
    indicatorId: string,
    strategy: BacktestStrategy = 'TREND_SMA_CROSSOVER',
    range = '3Y',
    transactionCostBps = 10
  ): BacktestReport {
    const def = INDICATOR_CATALOG.find((d) => d.id === indicatorId);
    const series = timeSeriesStore.getSeries(indicatorId);
    return this.evaluateHistoricalBacktest(series, {
      indicatorId,
      indicatorCode: def?.code ?? indicatorId,
      indicatorName: def?.namePt ?? indicatorId,
      unit: def?.unit ?? '',
      category: def?.category ?? 'EQUITIES_BR',
      frequency: def?.frequency ?? 'DAILY',
      strategy,
      range,
      transactionCostBps,
    });
  }

  public computeMacroStressHeatmap(): MacroStressHeatmapReport {
    const riskReport = this.computeRiskReport(20261113, 10000);

    const computeMonthlyVolPct = (indicatorId: string, fallbackPct: number): { volPct: number; obs: number } => {
      const s = timeSeriesStore.getSeries(indicatorId);
      if (s.length < 25) return { volPct: fallbackPct, obs: s.length };
      const logRets: number[] = [];
      for (let i = 1; i < s.length; i++) {
        const prev = s[i - 1].value;
        const curr = s[i].value;
        if (prev > 0 && curr > 0) {
          logRets.push(Math.log(curr / prev));
        }
      }
      if (logRets.length < 20) return { volPct: fallbackPct, obs: s.length };
      const monthlyVol = stdDev(logRets) * Math.sqrt(21) * 100;
      return {
        volPct: Number(Math.max(0.5, monthlyVol).toFixed(2)),
        obs: logRets.length,
      };
    };

    const ibovVol = computeMonthlyVolPct('IBOV', 5.8);
    const fxVol = computeMonthlyVolPct('USD_BRL_PTAX', 3.9);
    const brentVol = computeMonthlyVolPct('BRENT', 8.5);
    const valeVol = computeMonthlyVolPct('VALE3', 7.9);
    const rateVol = computeMonthlyVolPct('US_10Y', 4.2);

    const portfolioMonthlyVol = Number(
      ((riskReport.metrics.annualizedVolatilityPct || 14) / Math.sqrt(12)).toFixed(2)
    );

    const factors: MacroStressFactorMeta[] = [
      {
        id: 'IBOV',
        code: 'IBOV (35%)',
        namePt: 'Bolsa Brasil (IBOV)',
        nameEn: 'Brazil Equities (IBOV)',
        portfolioWeight: 0.35,
        empiricalMonthlyVolPct: ibovVol.volPct,
        observationsUsed: ibovVol.obs,
      },
      {
        id: 'USD_BRL',
        code: 'USD/BRL (25%)',
        namePt: 'Câmbio USD/BRL',
        nameEn: 'FX USD/BRL',
        portfolioWeight: 0.25,
        empiricalMonthlyVolPct: fxVol.volPct,
        observationsUsed: fxVol.obs,
        isMacroCurrencyInverse: true,
      },
      {
        id: 'BRENT',
        code: 'BRENT (20%)',
        namePt: 'Petróleo Brent',
        nameEn: 'Brent Crude',
        portfolioWeight: 0.20,
        empiricalMonthlyVolPct: brentVol.volPct,
        observationsUsed: brentVol.obs,
      },
      {
        id: 'VALE3',
        code: 'VALE3 (20%)',
        namePt: 'Mineração (VALE3)',
        nameEn: 'Metals / VALE3',
        portfolioWeight: 0.20,
        empiricalMonthlyVolPct: valeVol.volPct,
        observationsUsed: valeVol.obs,
      },
      {
        id: 'DI_LONGO',
        code: 'JUROS DI (Proxy)',
        namePt: 'Vértice Juros Longos (Duration)',
        nameEn: 'Long Rates Duration Proxy',
        portfolioWeight: 0,
        empiricalMonthlyVolPct: rateVol.volPct,
        observationsUsed: rateVol.obs,
      },
      {
        id: 'PORTFOLIO_NET',
        code: 'PORTFÓLIO LÍQ.',
        namePt: 'Impacto Portfólio Ponderado',
        nameEn: 'Net Weighted Portfolio Impact',
        portfolioWeight: 1.0,
        empiricalMonthlyVolPct: portfolioMonthlyVol,
        observationsUsed: Math.min(ibovVol.obs, fxVol.obs, brentVol.obs, valeVol.obs),
      },
    ];

    // Exact shock propagation parameters matching Scenarios A-J in computeRiskReport
    const scenarioShockVectors: Record<
      string,
      { ibov: number; usdBrl: number; brent: number; vale3: number; diLongo: number }
    > = {
      A: { ibov: -6.4, usdBrl: -2.5, brent: 0, vale3: -2.0, diLongo: -5.4 },
      B: { ibov: -4.5, usdBrl: 15.0, brent: 2.0, vale3: 5.0, diLongo: -4.2 },
      C: { ibov: -4.2, usdBrl: 1.5, brent: -25.0, vale3: -3.5, diLongo: 0.6 },
      D: { ibov: -4.8, usdBrl: 2.5, brent: -4.0, vale3: -23.7, diLongo: -0.9 },
      E: { ibov: -7.5, usdBrl: 4.0, brent: 2.0, vale3: -4.5, diLongo: -7.8 },
      F: { ibov: -8.0, usdBrl: 4.0, brent: -14.0, vale3: -18.0, diLongo: -1.4 },
      G: { ibov: -11.0, usdBrl: 5.0, brent: -18.0, vale3: -13.7, diLongo: -2.1 },
      H: { ibov: -16.0, usdBrl: 18.0, brent: 0, vale3: -8.0, diLongo: -9.5 },
      I: { ibov: -18.0, usdBrl: 7.0, brent: -15.0, vale3: -16.0, diLongo: -5.2 },
      J: { ibov: -24.0, usdBrl: 12.0, brent: -25.0, vale3: -22.0, diLongo: -11.0 },
    };

    const scenarios: MacroStressScenarioRow[] = [];
    const cells: MacroStressCell[] = [];

    for (const sc of riskReport.stressScenarios) {
      const vec = scenarioShockVectors[sc.code] ?? { ibov: 0, usdBrl: 0, brent: 0, vale3: 0, diLongo: 0 };
      const netImpact = sc.estimatedPortfolioImpactPct;
      const severityLabelPt: MacroStressScenarioRow['severityLabelPt'] =
        netImpact <= -10
          ? 'ESTRESSE EXTREMO'
          : netImpact <= -4
          ? 'ESTRESSE ELEVADO'
          : netImpact < 0
          ? 'MODERADO'
          : 'GANHO LÍQUIDO';

      scenarios.push({
        code: sc.code,
        namePt: sc.namePt,
        nameEn: sc.nameEn,
        shockDescription: sc.shockDescription,
        transmissionChannels: sc.transmissionChannels,
        portfolioImpactPct: netImpact,
        portfolioBrlPer100M: sc.estimatedBrlImpactPer100M,
        severityLabelPt,
      });

      const shockByFactor: Record<string, number> = {
        IBOV: vec.ibov,
        USD_BRL: vec.usdBrl,
        BRENT: vec.brent,
        VALE3: vec.vale3,
        DI_LONGO: vec.diLongo,
        PORTFOLIO_NET: netImpact,
      };

      for (const f of factors) {
        const rawShock = shockByFactor[f.id] ?? 0;
        const pnlContrib =
          f.id === 'PORTFOLIO_NET'
            ? netImpact
            : f.portfolioWeight > 0
            ? Number((f.portfolioWeight * rawShock).toFixed(2))
            : rawShock;
        const brlPer100M = Math.round(((f.portfolioWeight > 0 ? pnlContrib : rawShock) / 100) * 100_000_000);
        const sigmaMultiple = Number((rawShock / Math.max(0.5, f.empiricalMonthlyVolPct)).toFixed(2));

        // On USD_BRL, positive move (+18% depreciation) is macro stress (-valence) even though FX weight adds +BRL PnL
        const stressValence = f.isMacroCurrencyInverse ? -rawShock : rawShock;

        cells.push({
          scenarioCode: sc.code,
          factorId: f.id,
          shockPct: Number(rawShock.toFixed(2)),
          pnlContributionPct: pnlContrib,
          brlImpactPer100M: brlPer100M,
          sigmaMultiple,
          stressValence: Number(stressValence.toFixed(2)),
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      factors,
      scenarios,
      cells,
      methodologyNote:
        'Matriz de sensibilidade macroeconômica cruzando os 10 cenários documentados A–J contra 6 pilares de risco. A severidade em desvios-padrão (σ) é calibrada pela volatilidade mensal empírica (21d) extraída das séries históricas reais armazenadas.',
      limitations: [
        'Cenários hipotéticos determinísticos não constituem previsão de probabilidade de ocorrência.',
        'Vértice de juros longos (DI Proxy) estima marcação a mercado com duration sintética de ~3,5 anos para choques na curva local.',
      ],
    };
  }
}

export const quantEngine = new QuantEconometricsService();
