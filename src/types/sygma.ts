export type DataStatus =
  | 'LIVE'
  | 'DELAYED'
  | 'PERIODIC'
  | 'HISTORICAL'
  | 'ESTIMATED'
  | 'FORECAST'
  | 'STALE'
  | 'MISSING'
  | 'UNVERIFIED'
  | 'NOT_CONFIGURED';

export type Language = 'pt' | 'en';

export interface ObservationPoint {
  date: string;
  value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  referencePeriod: string;
  publishedAt: string;
  ingestedAt: string;
  revisionCount: number;
  status: DataStatus;
  sourceId: string;
  sourceName: string;
  digestSha256: string;
}

export interface IndicatorDefinition {
  id: string;
  code: string;
  namePt: string;
  nameEn: string;
  category: string;
  unit: string;
  currency: string;
  frequency: string;
  freshnessThresholdHours: number;
  providerId: string;
  externalSeriesId: string;
  methodologyNote: string;
  isOfficial: boolean;
}

export interface IndicatorSnapshot {
  definition: IndicatorDefinition;
  latest: ObservationPoint | null;
  previous: ObservationPoint | null;
  changeAbs: number | null;
  changePct: number | null;
  observationsCount: number;
  status: DataStatus;
  lastError?: string;
}

export interface FocusExpectation {
  indicator: string;
  referenceYear: string;
  date: string;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  respondents: number;
}

export interface ProviderStatus {
  id: string;
  name: string;
  category: string;
  protocol: string;
  connectionState: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'NOT_CONFIGURED' | 'RATE_LIMITED';
  authStatus: string;
  licenseStatus: string;
  enabled: boolean;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  avgLatencyMs: number | null;
  dataDelayDescription: string;
  recordsCollected: number;
  errorCount: number;
  rateLimitUsed: number;
  rateLimitMax: number;
  lastValidationResult: string;
  documentationUrl: string;
  limitations?: string;
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

export interface BrazilPulseReport {
  generatedAt: string;
  compositeScore: number | null;
  assessment: 'FAVORABLE' | 'STABLE' | 'CAUTION' | 'ADVERSE' | 'SEVERE_STRESS' | 'INSUFFICIENT_DATA';
  dimensions: Array<{
    id: string;
    namePt: string;
    nameEn: string;
    score: number;
    weight: number;
    statusLabelPt: string;
    statusLabelEn: string;
    primaryIndicatorId: string;
    primaryValue: number | null;
    primaryUnit: string;
    zScore: number | null;
    dataStatus: string;
  }>;
  methodology: {
    formula: string;
    normalization: string;
    missingDataTreatment: string;
    disclaimer: string;
  };
}

export interface DataQualityIssue {
  id: string;
  titlePt: string;
  titleEn: string;
  descriptionPt: string;
  descriptionEn: string;
  category: string;
  affectedSource: string;
  affectedIndicator: string;
  firstOccurrence: string;
  lastOccurrence: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'INFORMATIONAL';
  recommendedAction: string;
  status: string;
  statisticalEvidence?: Record<string, number | string>;
}

export interface SystemHealthResponse {
  evaluatedAt: string;
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  subsystems: Record<string, string>;
  metrics: Record<string, number>;
  issues: DataQualityIssue[];
  performance: {
    uptimeSeconds: number;
    avgApiLatencyMs: number;
    heapUsedMb: number;
    rssMb: number;
    lastGlobalSyncAt: string | null;
  };
  auditVerification: { valid: boolean; totalEvents: number; brokenAtSeq?: number };
  auditEvents: Array<{
    seq: number;
    id: string;
    timestamp: string;
    actor: string;
    service: string;
    action: string;
    resource: string;
    outcome: string;
    metadata?: Record<string, unknown>;
    hash: string;
    prevHash: string;
  }>;
  backupStatus: {
    lastBackupAt: string | null;
    backupFilesCount: number;
    totalStoredObservations: number;
    seriesCount: number;
    revisionsTracked: number;
  };
}

export interface AuditLogEvent {
  seq: number;
  id: string;
  timestamp: string;
  actor: string;
  service: string;
  action: string;
  resource: string;
  outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  metadata?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AuditLogsResponse {
  verifiedAt?: string;
  verification: { valid: boolean; totalEvents: number; brokenAtSeq?: number };
  latestHash: string;
  events: AuditLogEvent[];
}

export interface SwotItem {
  title: string;
  evidence: string;
  plainLanguage: string;
}

export interface ConsolidatedSwotReport {
  generatedAt: string;
  reproducibilityHash: string;
  plainLanguageHeadline: string;
  plainLanguageSummary: string[];
  macroForecastScenarios: Array<{
    indicatorId: string;
    name: string;
    unit: string;
    currentValue: number | null;
    horizonDate: string;
    baseCentral: number;
    optimistic: number;
    adverse: number;
    severeStress: number;
    confidence90Band: string;
    mae: number;
    mase: number;
    plainInterpretation: string;
  }>;
  stressScenariosPlain: Array<{
    code: string;
    namePt: string;
    estimatedPortfolioImpactPct: number;
    estimatedBrlImpactPer100M: number;
    shockDescription: string;
    plainLanguageImpact: string;
    transmissionChannels: string[];
  }>;
  swotMatrix: {
    strengths: SwotItem[];
    weaknesses: SwotItem[];
    opportunities: SwotItem[];
    threats: SwotItem[];
  };
}

export interface NewsItem {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string;
  link: string;
  summary: string;
  topic: string;
  entities: string[];
  sentiment: string;
  relevanceBrazil: string;
  relatedIndicators: string[];
  dedupHash: string;
}

export type AlertDirection = 'BOTH' | 'UP' | 'DOWN';

export interface AlertRule {
  id: string;
  indicatorId: string;
  thresholdPct: number;
  direction: AlertDirection;
  cooldownMinutes: number;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface TriggeredAlert {
  id: string;
  ruleId: string;
  indicatorId: string;
  code: string;
  namePt: string;
  observedPctChange: number;
  thresholdPct: number;
  direction: AlertDirection;
  value: number;
  unit: string;
  referenceDate: string;
  triggeredAt: string;
  acknowledged: boolean;
}

export type ScheduleReportType =
  | 'CONSOLIDATED_BRAZIL_SWOT'
  | 'DAILY_BRIEFING'
  | 'INFLATION_MONETARY'
  | 'FISCAL_RISK'
  | 'FX_ANALYSIS'
  | 'QUANTITATIVE_RISK';

export type ScheduleDeliveryChannel = 'SYSTEM' | 'EMAIL' | 'BOTH';
export type ScheduleCadence = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'INTERVAL_MINUTES';

export interface ReportSchedule {
  id: string;
  name: string;
  reportType: ScheduleReportType;
  deliveryChannel: ScheduleDeliveryChannel;
  recipientEmail: string;
  cadence: ScheduleCadence;
  timeOfDay: string;
  timezone: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  intervalMinutes?: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
}

export interface ScheduledDeliveryRecord {
  id: string;
  scheduleId: string;
  scheduleName: string;
  reportType: ScheduleReportType;
  deliveryChannel: ScheduleDeliveryChannel;
  recipientEmail: string;
  executedAt: string;
  triggerMode: 'SCHEDULED' | 'MANUAL';
  status: 'DELIVERED' | 'PARTIAL' | 'FAILED';
  emailStatus: 'SENT' | 'NOT_APPLICABLE' | 'NOT_CONFIGURED' | 'FAILED';
  systemStatus: 'STORED' | 'NOT_APPLICABLE';
  pdfFilename: string;
  pdfBytes: number;
  sha256: string;
  message: string;
  acknowledged: boolean;
}

export interface SmtpStatus {
  configured: boolean;
  source: 'VAULT' | 'ENV' | 'NONE';
  host: string | null;
  port: number | null;
  secure: boolean;
  userMasked: string | null;
  fromAddress: string | null;
}

export interface SchedulesStateResponse {
  schedules: ReportSchedule[];
  deliveries: ScheduledDeliveryRecord[];
  unreadDeliveriesCount: number;
  smtpStatus: SmtpStatus;
}

export interface EmergingMarketCountryMeta {
  iso3: string;
  namePt: string;
  nameEn: string;
  regionPt: string;
  etfSymbol: string;
  fxSymbol: string;
  isAnchorBrazil: boolean;
}

export interface EmergingMarketIndicatorMeta {
  id: string;
  code: string;
  namePt: string;
  nameEn: string;
  unit: string;
  higherIsBetter: boolean;
  sourceName: string;
  category: 'MACRO' | 'MARKET';
  linkedLocalIndicatorId?: string;
}

export interface EmergingMarketHeatmapCell {
  iso3: string;
  indicatorId: string;
  value: number | null;
  referenceYear: string;
  peerMean: number | null;
  peerStdDev: number | null;
  rawZScore: number | null;
  relativeZScore: number | null;
  percentileRank: number | null;
  rank: number | null;
  peerCount: number;
  source: string;
}

export interface EmergingMarketCountryRank {
  iso3: string;
  namePt: string;
  nameEn: string;
  isAnchorBrazil: boolean;
  compositeScore: number | null;
  avgRelativeZScore: number | null;
  rank: number | null;
  indicatorsCovered: number;
}

export interface EmergingMarketsHeatmapReport {
  generatedAt: string;
  lastSyncedAt: string | null;
  selectedYear: string;
  availableYears: string[];
  dataStatus: 'LIVE' | 'CACHED' | 'DEGRADED';
  countries: EmergingMarketCountryMeta[];
  indicators: EmergingMarketIndicatorMeta[];
  cells: EmergingMarketHeatmapCell[];
  countryRankings: EmergingMarketCountryRank[];
  brazilSummary: {
    rank: number | null;
    totalCountries: number;
    compositeScore: number | null;
    strongestIndicatorPt: string | null;
    weakestIndicatorPt: string | null;
    historicalBrazilScoreSeries: Array<{
      year: string;
      brazilScore: number | null;
      brazilRank: number | null;
      emMedianScore: number | null;
    }>;
  };
  sources: string[];
  limitations: string[];
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
  signalPosition: number;
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

export interface ProviderQuotaItem {
  providerId: string;
  displayName: string;
  category: string;
  tierLabel: string;
  connectionState: string;
  enabled: boolean;
  monthlyQuota: number;
  requestsThisMonth: number;
  requestsRemaining: number;
  remainingPct: number;
  usedPct: number;
  requestsToday: number;
  successThisMonth: number;
  errorsThisMonth: number;
  successRatePct: number;
  recordsThisMonth: number;
  avgLatencyMs: number | null;
  lastRequestAt: string | null;
}

export interface ApiQuotaSnapshot {
  billingMonth: string;
  utcDate: string;
  updatedAt: string;
  summary: {
    activeConnectorsCount: number;
    configuredProvidersCount: number;
    totalRequestsMonth: number;
    totalRequestsToday: number;
    activeMonthlyQuotaTotal: number;
    activeRemainingQuotaTotal: number;
    activeUtilizationPct: number;
    overallSuccessRatePct: number;
    weightedAvgLatencyMs: number | null;
  };
  providers: ProviderQuotaItem[];
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

export type SentimentPolarity = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
export type MonetaryStance = 'HAWKISH' | 'DOVISH' | 'NEUTRAL';
export type SentimentRegime =
  | 'RISK_ON_BULLISH'
  | 'CONSTRUCTIVE'
  | 'NEUTRAL'
  | 'CAUTIOUS'
  | 'RISK_OFF_BEARISH';

export interface TextSentimentScore {
  scoreNormalized: number;
  netScore: number;
  polarity: SentimentPolarity;
  monetaryStance: MonetaryStance;
  hawkishScore: number;
  dovishScore: number;
  confidence: number;
  positiveHits: string[];
  negativeHits: string[];
  hawkishHits: string[];
  dovishHits: string[];
}

export interface ScoredNewsItem extends NewsItem {
  analysis: TextSentimentScore;
}

export interface SentimentPillar {
  id: string;
  namePt: string;
  nameEn: string;
  weight: number;
  score: number;
  signalLabelPt: string;
  signalLabelEn: string;
  evidence: string;
}

export interface SentimentHistoryPoint {
  date: string;
  marketSentimentIndex: number;
  equitiesComponent: number;
  fxComponent: number;
  globalRatesComponent: number;
}

export interface SentimentAnalysisReport {
  generatedAt: string;
  compositeScore: number;
  regime: SentimentRegime;
  regimeLabelPt: string;
  regimeLabelEn: string;
  policyTone: {
    hawkishCount: number;
    dovishCount: number;
    neutralCount: number;
    dominantStance: MonetaryStance;
    netMonetaryTilt: number;
  };
  newsDistribution: {
    totalArticles: number;
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
    avgNewsScore: number;
  };
  pillars: SentimentPillar[];
  scoredNews: ScoredNewsItem[];
  historicalMarketSentiment: SentimentHistoryPoint[];
  methodologyNote: string;
  limitations: string[];
}

