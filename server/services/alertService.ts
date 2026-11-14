import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AlertDirection, AlertRule, IndicatorSnapshot, TriggeredAlert } from '../types/domain.ts';
import { cryptoService } from './cryptoService.ts';

const DEFAULT_DATA_DIR = process.env.SYGMA_DATA_DIR
  ? path.resolve(process.env.SYGMA_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

interface PersistedAlertsState {
  rules: AlertRule[];
  alerts: TriggeredAlert[];
}

export class AlertService {
  private readonly dataDir: string;
  private readonly alertsFile: string;
  private state: PersistedAlertsState = {
    rules: [],
    alerts: [],
  };

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.alertsFile = path.join(this.dataDir, 'sygma_alerts.json');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.load();
  }

  private load() {
    if (fs.existsSync(this.alertsFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.alertsFile, 'utf8')) as PersistedAlertsState;
        if (parsed && Array.isArray(parsed.rules) && Array.isArray(parsed.alerts)) {
          this.state = parsed;
        }
      } catch {
        this.state = { rules: [], alerts: [] };
      }
    }
  }

  private save() {
    try {
      const tmp = `${this.alertsFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.alertsFile);
    } catch {
      // Non-fatal in constrained environments
    }
  }

  public getRules(): AlertRule[] {
    return [...this.state.rules];
  }

  public getTriggeredAlerts(limit = 100): TriggeredAlert[] {
    return [...this.state.alerts].slice(-limit).reverse();
  }

  public getUnreadCount(): number {
    return this.state.alerts.filter((a) => !a.acknowledged).length;
  }

  public createRule(input: {
    indicatorId: string;
    thresholdPct: number;
    direction?: AlertDirection;
    cooldownMinutes?: number;
  }): AlertRule {
    const threshold = Math.max(0.01, Math.min(100, Number(input.thresholdPct)));
    const cooldown = Math.max(1, Math.min(1440, Number(input.cooldownMinutes ?? 60)));
    const rule: AlertRule = {
      id: `alr-rule-${crypto.randomBytes(4).toString('hex')}`,
      indicatorId: input.indicatorId,
      thresholdPct: Number(threshold.toFixed(2)),
      direction: input.direction ?? 'BOTH',
      cooldownMinutes: cooldown,
      enabled: true,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
    };
    this.state.rules.push(rule);
    this.save();
    cryptoService.recordAudit('svc-alerts', 'USER', 'ALERT_RULE_CREATED', rule.indicatorId, 'SUCCESS', {
      ruleId: rule.id,
      thresholdPct: rule.thresholdPct,
      direction: rule.direction,
    });
    return rule;
  }

  public updateRule(
    id: string,
    patch: Partial<Pick<AlertRule, 'enabled' | 'thresholdPct' | 'direction' | 'cooldownMinutes'>>
  ): AlertRule {
    const rule = this.state.rules.find((r) => r.id === id);
    if (!rule) throw new Error(`Regra de alerta ${id} não encontrada.`);
    if (typeof patch.enabled === 'boolean') rule.enabled = patch.enabled;
    if (typeof patch.thresholdPct === 'number' && Number.isFinite(patch.thresholdPct)) {
      rule.thresholdPct = Number(Math.max(0.01, Math.min(100, patch.thresholdPct)).toFixed(2));
    }
    if (patch.direction) rule.direction = patch.direction;
    if (typeof patch.cooldownMinutes === 'number' && Number.isFinite(patch.cooldownMinutes)) {
      rule.cooldownMinutes = Math.max(1, Math.min(1440, patch.cooldownMinutes));
    }
    this.save();
    return rule;
  }

  public deleteRule(id: string): void {
    const idx = this.state.rules.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`Regra de alerta ${id} não encontrada.`);
    const removed = this.state.rules[idx];
    this.state.rules.splice(idx, 1);
    this.save();
    cryptoService.recordAudit('svc-alerts', 'USER', 'ALERT_RULE_DELETED', removed.indicatorId, 'SUCCESS', {
      ruleId: id,
    });
  }

  public evaluateSnapshots(snapshots: IndicatorSnapshot[]): TriggeredAlert[] {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const snapMap = new Map<string, IndicatorSnapshot>(snapshots.map((s) => [s.definition.id, s]));
    const newlyTriggered: TriggeredAlert[] = [];

    for (const rule of this.state.rules) {
      if (!rule.enabled) continue;
      const snap = snapMap.get(rule.indicatorId);
      if (!snap || snap.changePct === null || !snap.latest) continue;

      if (rule.lastTriggeredAt) {
        const elapsedMin = (now - Date.parse(rule.lastTriggeredAt)) / 60_000;
        if (!Number.isNaN(elapsedMin) && elapsedMin < rule.cooldownMinutes) {
          continue;
        }
      }

      const pct = snap.changePct;
      let hit = false;
      if (rule.direction === 'BOTH' && Math.abs(pct) >= rule.thresholdPct) hit = true;
      if (rule.direction === 'UP' && pct >= rule.thresholdPct) hit = true;
      if (rule.direction === 'DOWN' && pct <= -rule.thresholdPct) hit = true;

      if (hit) {
        const evt: TriggeredAlert = {
          id: `alr-evt-${crypto.randomBytes(5).toString('hex')}`,
          ruleId: rule.id,
          indicatorId: rule.indicatorId,
          code: snap.definition.code,
          namePt: snap.definition.namePt,
          observedPctChange: pct,
          thresholdPct: rule.thresholdPct,
          direction: rule.direction,
          value: snap.latest.value,
          unit: snap.definition.unit,
          referenceDate: snap.latest.date,
          triggeredAt: nowIso,
          acknowledged: false,
        };
        rule.lastTriggeredAt = nowIso;
        this.state.alerts.push(evt);
        newlyTriggered.push(evt);
        cryptoService.recordAudit('svc-alerts', 'ENGINE', 'ALERT_TRIGGERED', snap.definition.code, 'SUCCESS', {
          observedPctChange: pct,
          thresholdPct: rule.thresholdPct,
        });
      }
    }

    if (this.state.alerts.length > 500) {
      this.state.alerts = this.state.alerts.slice(-500);
    }
    if (newlyTriggered.length > 0) {
      this.save();
    }
    return newlyTriggered;
  }

  public acknowledgeAlert(id: string): TriggeredAlert {
    const alert = this.state.alerts.find((a) => a.id === id);
    if (!alert) throw new Error(`Alerta ${id} não encontrado.`);
    alert.acknowledged = true;
    this.save();
    return alert;
  }

  public acknowledgeAll(): number {
    let count = 0;
    for (const a of this.state.alerts) {
      if (!a.acknowledged) {
        a.acknowledged = true;
        count++;
      }
    }
    if (count > 0) this.save();
    return count;
  }
}

export const alertService = new AlertService();
