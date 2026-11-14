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

export type ProviderCategory = 'BRAZIL_OFFICIAL' | 'BRAZIL_MARKET' | 'INTERNATIONAL' | 'NEWS_RESEARCH';

export type ConnectionState = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'NOT_CONFIGURED' | 'RATE_LIMITED';

export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'INFORMATIONAL';

export interface ObservationPoint {
  date: string; // ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ
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
  category:
    | 'FX'
    | 'MONETARY'
    | 'INFLATION'
    | 'FISCAL'
    | 'ACTIVITY'
    | 'LABOR'
    | 'CREDIT'
    | 'EXTERNAL'
    | 'EQUITIES_BR'
    | 'EQUITIES_GLOBAL'
    | 'COMMODITIES';
  unit: string;
  currency: string;
  frequency: 'INTRADAY' | 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
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

export interface ProviderStatus {
  id: string;
  name: string;
  category: ProviderCategory;
  protocol: 'REST' | 'WEBSOCKET' | 'ODATA' | 'ATOM_RSS' | 'FIX_LICENSED';
  connectionState: ConnectionState;
  authStatus: 'PUBLIC_NO_AUTH' | 'API_KEY_ACTIVE' | 'MISSING_CREDENTIALS' | 'LICENSE_REQUIRED';
  licenseStatus: 'OPEN_OFFICIAL' | 'PUBLIC_DELAYED' | 'COMMERCIAL_REQUIRED';
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

export interface DataQualityIssue {
  id: string;
  titlePt: string;
  titleEn: string;
  descriptionPt: string;
  descriptionEn: string;
  category: 'FRESHNESS' | 'MISSING_DATA' | 'OUTLIER' | 'STRUCTURAL_BREAK' | 'REGIME_SHIFT' | 'REVISION' | 'CONNECTOR_ERROR';
  affectedSource: string;
  affectedIndicator: string;
  firstOccurrence: string;
  lastOccurrence: string;
  severity: SeverityLevel;
  recommendedAction: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  statisticalEvidence?: Record<string, number | string>;
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
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  relevanceBrazil: 'HIGH' | 'MEDIUM' | 'LOW';
  relatedIndicators: string[];
  dedupHash: string;
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

export interface EncryptedEnvelope {
  version: 'SYGMA-E2EE-1.0';
  alg: 'ECDH-P256-HKDF-SHA256+AES-256-GCM';
  keyId: string;
  iv: string; // base64
  ciphertext: string; // base64
  authTag: string; // base64
  signatureEd25519: string; // base64
  timestamp: string;
  nonce: string;
}

export interface AuditEvent {
  seq: number;
  id: string;
  timestamp: string;
  actor: string;
  service: string;
  action: string;
  resource: string;
  outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  metadata: Record<string, unknown>;
  prevHash: string;
  hash: string;
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

