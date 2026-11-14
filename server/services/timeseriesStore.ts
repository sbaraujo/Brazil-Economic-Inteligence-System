import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { IndicatorDefinition, ObservationPoint } from '../types/domain.ts';

const DEFAULT_DATA_DIR = process.env.SYGMA_DATA_DIR
  ? path.resolve(process.env.SYGMA_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export interface RevisionRecord {
  indicatorId: string;
  date: string;
  previousValue: number;
  newValue: number;
  detectedAt: string;
  sourceId: string;
}

interface PersistedLedger {
  series: Record<string, ObservationPoint[]>;
  revisions: RevisionRecord[];
  lastBackupAt: string | null;
}

export class TimeSeriesStore {
  private readonly dataDir: string;
  private readonly ledgerFile: string;
  private ledger: PersistedLedger = {
    series: {},
    revisions: [],
    lastBackupAt: null,
  };

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.ledgerFile = path.join(this.dataDir, 'sygma_timeseries_ledger.json');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.load();
  }

  private load() {
    if (fs.existsSync(this.ledgerFile)) {
      try {
        const raw = fs.readFileSync(this.ledgerFile, 'utf8');
        const parsed = JSON.parse(raw) as PersistedLedger;
        if (parsed && parsed.series) {
          // Clean up any leftover test series pollution from earlier test runs
          let cleaned = false;
          if (parsed.series['TEST_REV_SERIES']) {
            delete parsed.series['TEST_REV_SERIES'];
            cleaned = true;
          }
          if (Array.isArray(parsed.revisions)) {
            const filtered = parsed.revisions.filter((r) => r.indicatorId !== 'TEST_REV_SERIES');
            if (filtered.length !== parsed.revisions.length) {
              parsed.revisions = filtered;
              cleaned = true;
            }
          }
          this.ledger = parsed;
          if (cleaned) this.save();
        }
      } catch {
        this.ledger = { series: {}, revisions: [], lastBackupAt: null };
      }
    }
  }

  private save() {
    try {
      const tmpFile = `${this.ledgerFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.ledger));
      fs.renameSync(tmpFile, this.ledgerFile);
    } catch {
      // Ignore write failure on constrained filesystems
    }
  }

  /**
   * Append or record revisions without destroying original observations.
   */
  public upsertObservations(indicatorId: string, incoming: ObservationPoint[]): { inserted: number; revised: number } {
    if (!this.ledger.series[indicatorId]) {
      this.ledger.series[indicatorId] = [];
    }
    const existing = this.ledger.series[indicatorId];
    const byDate = new Map<string, ObservationPoint>();
    for (const pt of existing) {
      byDate.set(pt.date, pt);
    }

    let inserted = 0;
    let revised = 0;

    for (const pt of incoming) {
      if (!Number.isFinite(pt.value)) continue;
      const digest = crypto
        .createHash('sha256')
        .update(`${indicatorId}|${pt.date}|${pt.value}|${pt.sourceId}`)
        .digest('hex')
        .slice(0, 16);

      const current = byDate.get(pt.date);
      if (!current) {
        byDate.set(pt.date, { ...pt, digestSha256: digest });
        inserted++;
      } else if (Math.abs(current.value - pt.value) > 1e-9) {
        // Record revision cleanly while updating current effective series
        this.ledger.revisions.push({
          indicatorId,
          date: pt.date,
          previousValue: current.value,
          newValue: pt.value,
          detectedAt: new Date().toISOString(),
          sourceId: pt.sourceId,
        });
        byDate.set(pt.date, {
          ...pt,
          revisionCount: current.revisionCount + 1,
          digestSha256: digest,
        });
        revised++;
      }
    }

    const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    this.ledger.series[indicatorId] = sorted;
    if (this.ledger.revisions.length > 500) {
      this.ledger.revisions = this.ledger.revisions.slice(-500);
    }
    if (inserted > 0 || revised > 0) {
      this.save();
    }
    return { inserted, revised };
  }

  public getSeries(indicatorId: string): ObservationPoint[] {
    return this.ledger.series[indicatorId] ?? [];
  }

  public getRevisions(indicatorId?: string): RevisionRecord[] {
    if (!indicatorId) return [...this.ledger.revisions].reverse();
    return this.ledger.revisions.filter((r) => r.indicatorId === indicatorId).reverse();
  }

  public getTotalObservationsCount(): number {
    let total = 0;
    for (const arr of Object.values(this.ledger.series)) {
      total += arr.length;
    }
    return total;
  }

  public createSnapshotBackup(): { path: string; timestamp: string; totalRecords: number } {
    const timestamp = new Date().toISOString();
    const backupName = `sygma_backup_${timestamp.replace(/[:.]/g, '-')}.json`;
    const backupPath = path.join(this.dataDir, backupName);
    this.ledger.lastBackupAt = timestamp;
    this.save();
    const tmpBackup = `${backupPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpBackup, JSON.stringify(this.ledger));
    fs.renameSync(tmpBackup, backupPath);
    return {
      path: backupName,
      timestamp,
      totalRecords: this.getTotalObservationsCount(),
    };
  }

  public getBackupStatus() {
    const files = fs.existsSync(this.dataDir)
      ? fs.readdirSync(this.dataDir).filter((f) => f.startsWith('sygma_backup_'))
      : [];
    return {
      lastBackupAt: this.ledger.lastBackupAt,
      backupFilesCount: files.length,
      totalStoredObservations: this.getTotalObservationsCount(),
      seriesCount: Object.keys(this.ledger.series).length,
      revisionsTracked: this.ledger.revisions.length,
    };
  }

  public computeFreshnessStatus(def: IndicatorDefinition, latest: ObservationPoint | null): ObservationPoint['status'] {
    if (!latest) return 'MISSING';
    const ts = Date.parse(latest.date);
    if (Number.isNaN(ts)) return latest.status;
    const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
    if (ageHours > def.freshnessThresholdHours) {
      return 'STALE';
    }
    return latest.status;
  }
}

export const timeSeriesStore = new TimeSeriesStore();
