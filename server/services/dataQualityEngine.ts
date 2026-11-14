import type { DataQualityIssue, SeverityLevel } from '../types/domain.ts';
import { INDICATOR_CATALOG } from './connectors/indicatorCatalog.ts';
import { connectorEngine } from './connectors/connectorEngine.ts';
import { cryptoService } from './cryptoService.ts';
import { timeSeriesStore } from './timeseriesStore.ts';

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export interface SystemHealthSnapshot {
  evaluatedAt: string;
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  subsystems: {
    apiGateway: 'OPERATIONAL';
    e2eeCryptoKms: 'OPERATIONAL';
    timeSeriesDatabase: 'OPERATIONAL';
    dataIngestion: 'OPERATIONAL' | 'PARTIAL_DEGRADATION';
    aiService: 'OPERATIONAL' | 'KEY_MISSING';
    auditChainIntegrity: 'VERIFIED' | 'TAMPER_DETECTED';
  };
  metrics: {
    activeProviders: number;
    notConfiguredProviders: number;
    totalObservations: number;
    openIssuesCritical: number;
    openIssuesHigh: number;
    openIssuesModerate: number;
    revisionsTracked: number;
    activeE2eeSessions: number;
  };
  issues: DataQualityIssue[];
}

export class DataQualityEngine {
  public evaluateAll(): SystemHealthSnapshot {
    const issues: DataQualityIssue[] = [];
    const now = new Date().toISOString();
    const providers = connectorEngine.getProviders();

    // 1. Evaluate Provider Connectivity & Licensing Gaps
    for (const p of providers) {
      if (p.connectionState === 'NOT_CONFIGURED') {
        issues.push({
          id: `dq-prov-${p.id}`,
          titlePt: `Conector não configurado: ${p.name}`,
          titleEn: `Connector not configured: ${p.name}`,
          descriptionPt: p.lastError || 'Feed institucional aguarda credenciais licenciadas no cofre criptografado.',
          descriptionEn: p.lastError || 'Institutional feed awaiting licensed credentials in encrypted vault.',
          category: 'CONNECTOR_ERROR',
          affectedSource: p.name,
          affectedIndicator: 'Múltiplos',
          firstOccurrence: now,
          lastOccurrence: now,
          severity: 'LOW',
          recommendedAction: 'Inserir credenciais comerciais em Administração de Provedores caso possua licença.',
          status: 'OPEN',
        });
      } else if (p.connectionState === 'DEGRADED') {
        issues.push({
          id: `dq-deg-${p.id}`,
          titlePt: `Degradação de conector: ${p.name}`,
          titleEn: `Connector degraded: ${p.name}`,
          descriptionPt: p.lastError || 'Falhas recorrentes de resposta HTTP no provedor externo.',
          descriptionEn: p.lastError || 'Recurring HTTP response failures from external provider.',
          category: 'CONNECTOR_ERROR',
          affectedSource: p.name,
          affectedIndicator: 'Múltiplos',
          firstOccurrence: p.lastFailureAt ?? now,
          lastOccurrence: p.lastFailureAt ?? now,
          severity: 'HIGH',
          recommendedAction: 'Verificar latência de rede, limites de taxa ou fallback oficial BCB SGS.',
          status: 'OPEN',
        });
      }
    }

    // 2. Evaluate Series Freshness, Missing Data, Outliers (MAD), and Volatility Regime Shifts
    for (const def of INDICATOR_CATALOG) {
      const series = timeSeriesStore.getSeries(def.id);
      const latest = series[series.length - 1] ?? null;

      if (!latest) {
        issues.push({
          id: `dq-miss-${def.id}`,
          titlePt: `Série sem observações: ${def.namePt}`,
          titleEn: `Missing series observations: ${def.nameEn}`,
          descriptionPt: `Nenhuma observação válida coletada para ${def.code} (${def.externalSeriesId}).`,
          descriptionEn: `No valid observations collected for ${def.code}.`,
          category: 'MISSING_DATA',
          affectedSource: def.providerId,
          affectedIndicator: def.code,
          firstOccurrence: now,
          lastOccurrence: now,
          severity: 'HIGH',
          recommendedAction: 'Executar sincronização manual ou verificar código externo da série.',
          status: 'OPEN',
        });
        continue;
      }

      const freshness = timeSeriesStore.computeFreshnessStatus(def, latest);
      if (freshness === 'STALE') {
        issues.push({
          id: `dq-stale-${def.id}`,
          titlePt: `Dado desatualizado (STALE): ${def.code}`,
          titleEn: `Stale observation: ${def.code}`,
          descriptionPt: `Última observação de ${def.namePt} em ${latest.date} excede o limite de atualização de ${def.freshnessThresholdHours}h.`,
          descriptionEn: `Latest observation in ${latest.date} exceeds ${def.freshnessThresholdHours}h threshold.`,
          category: 'FRESHNESS',
          affectedSource: def.providerId,
          affectedIndicator: def.code,
          firstOccurrence: latest.date,
          lastOccurrence: now,
          severity: 'MODERATE',
          recommendedAction: 'Validar calendário oficial de divulgação ou re-sincronizar provedor.',
          status: 'OPEN',
          statisticalEvidence: { lastDate: latest.date, thresholdHours: def.freshnessThresholdHours },
        });
      }

      // Statistical Anomaly Detection (Modified Z-Score on first differences)
      if (series.length >= 25) {
        const diffs: number[] = [];
        for (let i = 1; i < series.length; i++) {
          diffs.push(series[i].value - series[i - 1].value);
        }
        const recentDiffs = diffs.slice(-60);
        const med = median(recentDiffs);
        const absDevs = recentDiffs.map((d) => Math.abs(d - med));
        const mad = Math.max(1e-9, median(absDevs));
        const lastDiff = diffs[diffs.length - 1];
        const modZ = (0.6745 * (lastDiff - med)) / mad;

        if (Math.abs(modZ) > 4.2) {
          issues.push({
            id: `dq-out-${def.id}-${latest.date}`,
            titlePt: `Movimento atípico detectado (Outlier estatístico): ${def.code}`,
            titleEn: `Statistical outlier detected: ${def.code}`,
            descriptionPt: `Variação recente em ${latest.date} (${lastDiff.toFixed(4)}) apresentou Z-Score Modificado = ${modZ.toFixed(2)} vs MAD histórico.`,
            descriptionEn: `Recent change presented Modified Z-Score = ${modZ.toFixed(2)}.`,
            category: 'OUTLIER',
            affectedSource: def.providerId,
            affectedIndicator: def.code,
            firstOccurrence: latest.date,
            lastOccurrence: latest.date,
            severity: 'MODERATE',
            recommendedAction: 'Distinguir choque econômico confirmado (ex.: decisão COPOM/IPCA) de possível erro de unidade na fonte.',
            status: 'OPEN',
            statisticalEvidence: { modifiedZScore: Number(modZ.toFixed(2)), latestValue: latest.value },
          });
        }
      }
    }

    // 3. Track Provider Historical Revisions
    const revisions = timeSeriesStore.getRevisions();
    for (const rev of revisions.slice(0, 8)) {
      issues.push({
        id: `dq-rev-${rev.indicatorId}-${rev.date}`,
        titlePt: `Revisão histórica de provedor: ${rev.indicatorId}`,
        titleEn: `Provider historical revision: ${rev.indicatorId}`,
        descriptionPt: `Observação de ${rev.date} revisada de ${rev.previousValue} para ${rev.newValue}. Histórico original preservado em trilha.`,
        descriptionEn: `Observation on ${rev.date} revised from ${rev.previousValue} to ${rev.newValue}.`,
        category: 'REVISION',
        affectedSource: rev.sourceId,
        affectedIndicator: rev.indicatorId,
        firstOccurrence: rev.detectedAt,
        lastOccurrence: rev.detectedAt,
        severity: 'INFORMATIONAL',
        recommendedAction: 'Revisão registrada automaticamente sem sobrescrita destrutiva.',
        status: 'RESOLVED',
      });
    }

    const auditVerification = cryptoService.verifyAuditChain();
    const openCritical = issues.filter((i) => i.status === 'OPEN' && i.severity === 'CRITICAL').length;
    const openHigh = issues.filter((i) => i.status === 'OPEN' && i.severity === 'HIGH').length;
    const openMod = issues.filter((i) => i.status === 'OPEN' && i.severity === 'MODERATE').length;
    const activeProviders = providers.filter((p) => p.connectionState === 'CONNECTED').length;
    const degradedProviders = providers.filter((p) => p.connectionState === 'DEGRADED').length;

    const severityRank: Record<SeverityLevel, number> = {
      CRITICAL: 0,
      HIGH: 1,
      MODERATE: 2,
      LOW: 3,
      INFORMATIONAL: 4,
    };
    issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

    return {
      evaluatedAt: now,
      overallStatus: !auditVerification.valid || openCritical > 0 ? 'CRITICAL' : openHigh > 0 || degradedProviders > 0 ? 'DEGRADED' : 'HEALTHY',
      subsystems: {
        apiGateway: 'OPERATIONAL',
        e2eeCryptoKms: 'OPERATIONAL',
        timeSeriesDatabase: 'OPERATIONAL',
        dataIngestion: degradedProviders > 0 ? 'PARTIAL_DEGRADATION' : 'OPERATIONAL',
        aiService: process.env.GEMINI_API_KEY ? 'OPERATIONAL' : 'KEY_MISSING',
        auditChainIntegrity: auditVerification.valid ? 'VERIFIED' : 'TAMPER_DETECTED',
      },
      metrics: {
        activeProviders,
        notConfiguredProviders: providers.filter((p) => p.connectionState === 'NOT_CONFIGURED').length,
        totalObservations: timeSeriesStore.getTotalObservationsCount(),
        openIssuesCritical: openCritical,
        openIssuesHigh: openHigh,
        openIssuesModerate: openMod,
        revisionsTracked: revisions.length,
        activeE2eeSessions: cryptoService.getActiveSessionsCount(),
      },
      issues,
    };
  }
}

export const dataQualityEngine = new DataQualityEngine();
