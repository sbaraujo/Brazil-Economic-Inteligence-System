import fs from 'fs';
import path from 'path';
import type { ProviderStatus } from '../types/domain.ts';

const DEFAULT_DATA_DIR = process.env.SYGMA_DATA_DIR
  ? path.resolve(process.env.SYGMA_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export interface ProviderQuotaSpec {
  providerId: string;
  displayName: string;
  tierLabel: string;
  defaultMonthlyQuota: number;
}

export const PROVIDER_QUOTA_SPECS: Record<string, ProviderQuotaSpec> = {
  'bcb-sgs': {
    providerId: 'bcb-sgs',
    displayName: 'Banco Central do Brasil (SGS API)',
    tierLabel: 'Público Oficial (Fair-Use)',
    defaultMonthlyQuota: 25000,
  },
  'bcb-focus': {
    providerId: 'bcb-focus',
    displayName: 'BCB Olinda (Boletim Focus)',
    tierLabel: 'Público Oficial (Fair-Use)',
    defaultMonthlyQuota: 10000,
  },
  'bcb-news': {
    providerId: 'bcb-news',
    displayName: 'BCB Feed Atom Oficial',
    tierLabel: 'Público Oficial (Fair-Use)',
    defaultMonthlyQuota: 10000,
  },
  'yahoo-market': {
    providerId: 'yahoo-market',
    displayName: 'Yahoo Finance (Market Data)',
    tierLabel: 'Feed Público (Rate-Limited)',
    defaultMonthlyQuota: 30000,
  },
  'ibge-sidra': {
    providerId: 'ibge-sidra',
    displayName: 'IBGE SIDRA API v3',
    tierLabel: 'Público Oficial (Fair-Use)',
    defaultMonthlyQuota: 12000,
  },
  'dbnomics-imf': {
    providerId: 'dbnomics-imf',
    displayName: 'DBnomics / FMI WEO API',
    tierLabel: 'Open Data API (Fair-Use)',
    defaultMonthlyQuota: 15000,
  },
  'b3-umdf': {
    providerId: 'b3-umdf',
    displayName: 'B3 Market Data (UMDF / FIX)',
    tierLabel: 'Licença Comercial',
    defaultMonthlyQuota: 1000000,
  },
  'anbima-api': {
    providerId: 'anbima-api',
    displayName: 'ANBIMA Developers API',
    tierLabel: 'Licença Comercial / OAuth2',
    defaultMonthlyQuota: 100000,
  },
  'bloomberg-bpipe': {
    providerId: 'bloomberg-bpipe',
    displayName: 'Bloomberg B-PIPE',
    tierLabel: 'Licença Empresarial',
    defaultMonthlyQuota: 2500000,
  },
  'reuters-refinitiv': {
    providerId: 'reuters-refinitiv',
    displayName: 'LSEG Refinitiv Elektron',
    tierLabel: 'Licença Empresarial',
    defaultMonthlyQuota: 1000000,
  },
  'fred-stlouis': {
    providerId: 'fred-stlouis',
    displayName: 'Federal Reserve FRED API',
    tierLabel: 'API Key Gratuita (120 req/min)',
    defaultMonthlyQuota: 50000,
  },
};

export interface PersistedProviderUsage {
  providerId: string;
  monthlyQuota: number;
  requestsThisMonth: number;
  requestsToday: number;
  successThisMonth: number;
  errorsThisMonth: number;
  recordsThisMonth: number;
  totalLatencyMsThisMonth: number;
  lifetimeRequests: number;
  lastRequestAt: string | null;
}

interface PersistedQuotaLedger {
  billingMonth: string; // YYYY-MM
  utcDate: string; // YYYY-MM-DD
  providers: Record<string, PersistedProviderUsage>;
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

export class ApiQuotaService {
  private readonly quotaFile: string;
  private ledger: PersistedQuotaLedger;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.quotaFile = path.join(dataDir, 'sygma_api_quota.json');
    const now = new Date();
    this.ledger = {
      billingMonth: now.toISOString().slice(0, 7),
      utcDate: now.toISOString().slice(0, 10),
      providers: {},
    };
    this.load();
    this.ensureDefaults();
    this.rolloverIfNeeded(now);
  }

  private ensureDefaults() {
    for (const spec of Object.values(PROVIDER_QUOTA_SPECS)) {
      if (!this.ledger.providers[spec.providerId]) {
        this.ledger.providers[spec.providerId] = {
          providerId: spec.providerId,
          monthlyQuota: spec.defaultMonthlyQuota,
          requestsThisMonth: 0,
          requestsToday: 0,
          successThisMonth: 0,
          errorsThisMonth: 0,
          recordsThisMonth: 0,
          totalLatencyMsThisMonth: 0,
          lifetimeRequests: 0,
          lastRequestAt: null,
        };
      }
    }
  }

  private load() {
    if (!fs.existsSync(this.quotaFile)) return;
    try {
      const raw = fs.readFileSync(this.quotaFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedQuotaLedger;
      if (parsed && parsed.providers && parsed.billingMonth) {
        this.ledger = parsed;
      }
    } catch {
      // Fallback to fresh initialized ledger
    }
  }

  private saveImmediate() {
    try {
      const tmp = `${this.quotaFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.ledger));
      fs.renameSync(tmp, this.quotaFile);
    } catch {
      // Ignore write failures
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveImmediate();
    }, 300);
  }

  public rolloverIfNeeded(now = new Date()) {
    const month = now.toISOString().slice(0, 7);
    const day = now.toISOString().slice(0, 10);
    let changed = false;

    if (this.ledger.billingMonth !== month) {
      this.ledger.billingMonth = month;
      this.ledger.utcDate = day;
      for (const entry of Object.values(this.ledger.providers)) {
        entry.requestsThisMonth = 0;
        entry.requestsToday = 0;
        entry.successThisMonth = 0;
        entry.errorsThisMonth = 0;
        entry.recordsThisMonth = 0;
        entry.totalLatencyMsThisMonth = 0;
      }
      changed = true;
    } else if (this.ledger.utcDate !== day) {
      this.ledger.utcDate = day;
      for (const entry of Object.values(this.ledger.providers)) {
        entry.requestsToday = 0;
      }
      changed = true;
    }

    if (changed) this.saveImmediate();
  }

  public recordCall(
    providerId: string,
    opts: { ok: boolean; latencyMs: number; records: number },
    now = new Date()
  ) {
    this.rolloverIfNeeded(now);
    const spec = PROVIDER_QUOTA_SPECS[providerId];
    if (!this.ledger.providers[providerId]) {
      this.ledger.providers[providerId] = {
        providerId,
        monthlyQuota: spec?.defaultMonthlyQuota ?? 10000,
        requestsThisMonth: 0,
        requestsToday: 0,
        successThisMonth: 0,
        errorsThisMonth: 0,
        recordsThisMonth: 0,
        totalLatencyMsThisMonth: 0,
        lifetimeRequests: 0,
        lastRequestAt: null,
      };
    }

    const entry = this.ledger.providers[providerId];
    entry.requestsThisMonth += 1;
    entry.requestsToday += 1;
    entry.lifetimeRequests += 1;
    entry.totalLatencyMsThisMonth += Math.max(0, Math.round(opts.latencyMs));
    entry.lastRequestAt = now.toISOString();

    if (opts.ok) {
      entry.successThisMonth += 1;
      entry.recordsThisMonth += Math.max(0, opts.records);
    } else {
      entry.errorsThisMonth += 1;
    }

    this.scheduleSave();
  }

  public setMonthlyQuota(providerId: string, monthlyQuota: number): void {
    const clean = Math.max(100, Math.min(100_000_000, Math.round(monthlyQuota)));
    this.ensureDefaults();
    if (!this.ledger.providers[providerId]) {
      throw new Error(`Provedor ${providerId} não encontrado no registro de cotas.`);
    }
    this.ledger.providers[providerId].monthlyQuota = clean;
    this.saveImmediate();
  }

  public getQuotaSnapshot(providerStatuses: ProviderStatus[], now = new Date()): ApiQuotaSnapshot {
    this.rolloverIfNeeded(now);
    this.ensureDefaults();

    const statusMap = new Map(providerStatuses.map((p) => [p.id, p]));
    const allIds = Array.from(
      new Set([...Object.keys(PROVIDER_QUOTA_SPECS), ...providerStatuses.map((p) => p.id)])
    );

    const items: ProviderQuotaItem[] = allIds.map((id) => {
      const spec = PROVIDER_QUOTA_SPECS[id];
      const pStatus = statusMap.get(id);
      const usage = this.ledger.providers[id];

      const monthlyQuota = usage?.monthlyQuota ?? spec?.defaultMonthlyQuota ?? 10000;
      const requestsThisMonth = usage?.requestsThisMonth ?? 0;
      const requestsRemaining = Math.max(0, monthlyQuota - requestsThisMonth);
      const usedPct = monthlyQuota > 0 ? Number(Math.min(100, (requestsThisMonth / monthlyQuota) * 100).toFixed(2)) : 0;
      const remainingPct = Number((100 - usedPct).toFixed(2));
      const success = usage?.successThisMonth ?? 0;
      const errors = usage?.errorsThisMonth ?? 0;
      const successRatePct =
        requestsThisMonth > 0 ? Number(((success / requestsThisMonth) * 100).toFixed(1)) : pStatus?.connectionState === 'NOT_CONFIGURED' ? 0 : 100;
      const avgLatencyMs =
        requestsThisMonth > 0 && usage
          ? Math.round(usage.totalLatencyMsThisMonth / requestsThisMonth)
          : pStatus?.avgLatencyMs ?? null;

      return {
        providerId: id,
        displayName: pStatus?.name ?? spec?.displayName ?? id,
        category: pStatus?.category ?? 'INTERNATIONAL',
        tierLabel: spec?.tierLabel ?? 'API Externa',
        connectionState: pStatus?.connectionState ?? (requestsThisMonth > 0 ? 'CONNECTED' : 'CONNECTED'),
        enabled: pStatus?.enabled ?? true,
        monthlyQuota,
        requestsThisMonth,
        requestsRemaining,
        remainingPct,
        usedPct,
        requestsToday: usage?.requestsToday ?? 0,
        successThisMonth: success,
        errorsThisMonth: errors,
        successRatePct,
        recordsThisMonth: usage?.recordsThisMonth ?? 0,
        avgLatencyMs,
        lastRequestAt: usage?.lastRequestAt ?? null,
      };
    });

    // Sort active / recently used first, then NOT_CONFIGURED commercial slots
    items.sort((a, b) => {
      const aActive = a.connectionState !== 'NOT_CONFIGURED';
      const bActive = b.connectionState !== 'NOT_CONFIGURED';
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.requestsThisMonth - a.requestsThisMonth;
    });

    const activeItems = items.filter((i) => i.connectionState !== 'NOT_CONFIGURED');
    const totalRequestsMonth = items.reduce((s, i) => s + i.requestsThisMonth, 0);
    const totalRequestsToday = items.reduce((s, i) => s + i.requestsToday, 0);
    const activeMonthlyQuotaTotal = activeItems.reduce((s, i) => s + i.monthlyQuota, 0);
    const activeRemainingQuotaTotal = activeItems.reduce((s, i) => s + i.requestsRemaining, 0);
    const activeUsed = activeItems.reduce((s, i) => s + i.requestsThisMonth, 0);
    const activeUtilizationPct =
      activeMonthlyQuotaTotal > 0 ? Number(((activeUsed / activeMonthlyQuotaTotal) * 100).toFixed(2)) : 0;

    const totalSuccess = items.reduce((s, i) => s + i.successThisMonth, 0);
    const overallSuccessRatePct =
      totalRequestsMonth > 0 ? Number(((totalSuccess / totalRequestsMonth) * 100).toFixed(1)) : 100;

    const totalLatency = Object.values(this.ledger.providers).reduce(
      (s, u) => s + (u.totalLatencyMsThisMonth || 0),
      0
    );
    const weightedAvgLatencyMs = totalRequestsMonth > 0 ? Math.round(totalLatency / totalRequestsMonth) : null;

    return {
      billingMonth: this.ledger.billingMonth,
      utcDate: this.ledger.utcDate,
      updatedAt: now.toISOString(),
      summary: {
        activeConnectorsCount: activeItems.length,
        configuredProvidersCount: items.length,
        totalRequestsMonth,
        totalRequestsToday,
        activeMonthlyQuotaTotal,
        activeRemainingQuotaTotal,
        activeUtilizationPct,
        overallSuccessRatePct,
        weightedAvgLatencyMs,
      },
      providers: items,
    };
  }
}

export const apiQuotaService = new ApiQuotaService();
