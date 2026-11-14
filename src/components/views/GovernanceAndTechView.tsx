import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  KeyRound,
  Play,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { sygmaClient, type E2eeSessionTelemetry } from '../../lib/e2eeClient';
import type {
  AuditLogEvent,
  AuditLogsResponse,
  ConsolidatedSwotReport,
  IndicatorSnapshot,
  Language,
  NewsItem,
  ProviderStatus,
  SystemHealthResponse,
  TriggeredAlert,
} from '../../types/sygma';
import { DataStatusText } from '../common/StatusBadge';
import { ApiUsageQuotaWidget } from './ApiUsageQuotaWidget';
import { SentimentAnalysisPanel } from './SentimentAnalysisPanel';

interface GovernanceAndTechViewProps {
  mode: 'QUALITY_FEEDBACK' | 'PROVIDERS' | 'SECURITY_AUDIT' | 'REPORTS' | 'NEWS_CALENDAR';
  health: SystemHealthResponse | null;
  providers: ProviderStatus[];
  news: NewsItem[];
  e2eeTelemetry: E2eeSessionTelemetry;
  onRefreshAll: () => void;
  snapshots?: IndicatorSnapshot[];
  alerts?: TriggeredAlert[];
  watchlist?: string[];
  onExportViewPdf?: () => Promise<void>;
  onOpenSchedules?: () => void;
  darkMode?: boolean;
  language?: Language;
  operatorId?: string;
  onOperatorIdChange?: (val: string) => void;
}

type AuditCategoryFilter = 'ALL' | 'ALERTS' | 'E2EE' | 'SYNC' | 'EXPORTS';
type AuditOutcomeFilter = 'ALL' | 'SUCCESS' | 'DENIED' | 'ERROR';

interface UnifiedAuditRow {
  uid: string;
  seqLabel: string;
  timestamp: string;
  category: Exclude<AuditCategoryFilter, 'ALL'>;
  categoryLabel: string;
  service: string;
  actor: string;
  action: string;
  resource: string;
  outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  hash: string;
  prevHash?: string;
  summary: string;
  details?: Record<string, unknown>;
}

function classifyAuditCategory(ev: AuditLogEvent): Exclude<AuditCategoryFilter, 'ALL'> {
  const act = ev.action.toUpperCase();
  const svc = ev.service.toLowerCase();
  if (act.includes('ALERT') || svc.includes('alerts')) return 'ALERTS';
  if (
    act.includes('E2EE') ||
    act.includes('KMS') ||
    act.includes('REPLAY') ||
    act.includes('CREDENTIAL') ||
    act.includes('AUDIT_INTEGRITY') ||
    svc.includes('crypto')
  ) {
    return 'E2EE';
  }
  if (act.includes('EXPORT') || act.includes('REPORT') || act.includes('BACKUP')) return 'EXPORTS';
  return 'SYNC';
}

export function GovernanceAndTechView({
  mode,
  health,
  providers,
  news,
  e2eeTelemetry,
  onRefreshAll,
  snapshots = [],
  alerts = [],
  watchlist = [],
  onExportViewPdf,
  onOpenSchedules,
  darkMode = true,
  language = 'pt',
  operatorId = '',
  onOperatorIdChange,
}: GovernanceAndTechViewProps) {
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [credentialInput, setCredentialInput] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Institutional Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogsResponse | null>(null);
  const [verifyingChain, setVerifyingChain] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditCategory, setAuditCategory] = useState<AuditCategoryFilter>('ALL');
  const [auditOutcome, setAuditOutcome] = useState<AuditOutcomeFilter>('ALL');
  const [expandedAuditUid, setExpandedAuditUid] = useState<string | null>(null);

  // Data Export Engine & Consolidated SWOT Preview State
  const [exportScope, setExportScope] = useState<
    'SNAPSHOTS' | 'TIMESERIES' | 'MACRO_BCB' | 'MARKETS' | 'RISK_SCENARIOS' | 'FOCUS_PULSE' | 'AUDIT_LOGS'
  >('TIMESERIES');
  const [exportRange, setExportRange] = useState<'1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'MAX'>('1Y');
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [exportSelectionMode, setExportSelectionMode] = useState<'ALL' | 'WATCHLIST' | 'CUSTOM'>('WATCHLIST');
  const [customExportIds, setCustomExportIds] = useState<string[]>(['USD_BRL_PTAX', 'SELIC_META', 'IPCA_MENSAL', 'IBOV']);
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);
  const [swotReport, setSwotReport] = useState<ConsolidatedSwotReport | null>(null);
  const [loadingSwot, setLoadingSwot] = useState(false);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await sygmaClient.fetchJson<AuditLogsResponse>('/api/v1/audit/logs?limit=250');
      setAuditLogs(res);
    } catch {
      // Ignore transient load errors
    }
  }, []);

  useEffect(() => {
    if (mode === 'SECURITY_AUDIT') {
      fetchAuditLogs();
    }
  }, [mode, fetchAuditLogs]);

  const handleVerifyChainNow = async () => {
    setVerifyingChain(true);
    try {
      const res = await sygmaClient.fetchJson<AuditLogsResponse>('/api/v1/audit/verify', {
        method: 'POST',
      });
      setAuditLogs(res);
      setActionMessage(
        res.verification.valid
          ? `Integridade SHA-256 verificada em ${res.verification.totalEvents} eventos (Root: ${res.latestHash.slice(0, 16)}…).`
          : `Violação de integridade detectada na sequência #${res.verification.brokenAtSeq}.`
      );
      onRefreshAll();
    } finally {
      setVerifyingChain(false);
    }
  };

  const handleLoadSwotPreview = async () => {
    if (swotReport) {
      setSwotReport(null);
      return;
    }
    setLoadingSwot(true);
    try {
      const res = await sygmaClient.fetchJson<ConsolidatedSwotReport>('/api/v1/reports/consolidated-swot');
      setSwotReport(res);
    } finally {
      setLoadingSwot(false);
    }
  };

  const handleRunDataExport = async () => {
    const params = new URLSearchParams();
    params.set('scope', exportScope);
    params.set('range', exportRange);
    params.set('format', exportFormat);
    if (exportSelectionMode === 'WATCHLIST' && watchlist.length > 0) {
      params.set('ids', watchlist.join(','));
    } else if (exportSelectionMode === 'CUSTOM' && customExportIds.length > 0) {
      params.set('ids', customExportIds.join(','));
    }

    const url = `/api/v1/export/data?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      setExportStatusMsg('Falha ao gerar pacote de exportação.');
      return;
    }
    const blob = await res.blob();
    const sha256 = res.headers.get('X-Sygma-Sha256') || 'N/D';
    const count = res.headers.get('X-Sygma-Record-Count') || '0';
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] || `sygma_export_${exportScope.toLowerCase()}.${exportFormat}`;

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);

    setExportStatusMsg(`Exportado ${filename} (${count} registros · SHA-256: ${sha256.slice(0, 16)}…).`);
    if (mode === 'SECURITY_AUDIT') fetchAuditLogs();
  };

  const unifiedAuditRows = useMemo<UnifiedAuditRow[]>(() => {
    const chainEvents = auditLogs?.events ?? (health?.auditEvents as AuditLogEvent[] | undefined) ?? [];
    const rows: UnifiedAuditRow[] = chainEvents.map((ev) => {
      const cat = classifyAuditCategory(ev);
      const catLabels: Record<Exclude<AuditCategoryFilter, 'ALL'>, string> = {
        ALERTS: 'Alerta',
        E2EE: 'E2EE / Segurança',
        SYNC: 'Sincronização',
        EXPORTS: 'Exportação / Backup',
      };
      return {
        uid: `chain-${ev.id}`,
        seqLabel: `#${ev.seq}`,
        timestamp: ev.timestamp,
        category: cat,
        categoryLabel: catLabels[cat],
        service: ev.service,
        actor: ev.actor,
        action: ev.action,
        resource: ev.resource,
        outcome: (ev.outcome as 'SUCCESS' | 'DENIED' | 'ERROR') || 'SUCCESS',
        hash: ev.hash,
        prevHash: ev.prevHash,
        summary: ev.metadata ? JSON.stringify(ev.metadata) : `${ev.action} em ${ev.resource}`,
        details: {
          metadata: ev.metadata ?? {},
          prevHash: ev.prevHash,
          hash: ev.hash,
        },
      };
    });

    // Merge Watchlist Triggered Alerts
    for (const al of alerts) {
      rows.push({
        uid: `wl-alert-${al.id}`,
        seqLabel: 'WL-ALERT',
        timestamp: al.triggeredAt,
        category: 'ALERTS',
        categoryLabel: 'Alerta Watchlist',
        service: 'svc-alerts',
        actor: al.acknowledged ? 'ACK_USER' : 'ACTIVE_TRIGGER',
        action: `THRESHOLD_${al.direction}`,
        resource: `${al.code} (${al.indicatorId})`,
        outcome: al.acknowledged ? 'SUCCESS' : 'DENIED',
        hash: al.id,
        summary: `Variação ${al.observedPctChange > 0 ? '+' : ''}${al.observedPctChange}% atingiu limiar ±${al.thresholdPct}% (Ref ${al.referenceDate})`,
        details: { ...al },
      });
    }

    // Merge Active System Data Quality Issues / Provider Alerts
    for (const iss of health?.issues ?? []) {
      rows.push({
        uid: `dq-alert-${iss.id}`,
        seqLabel: iss.severity,
        timestamp: iss.lastOccurrence,
        category: 'ALERTS',
        categoryLabel: 'Alerta Qualidade',
        service: 'svc-data-quality',
        actor: iss.category,
        action: iss.titlePt,
        resource: `${iss.affectedIndicator} · ${iss.affectedSource}`,
        outcome: iss.severity === 'CRITICAL' || iss.severity === 'HIGH' ? 'ERROR' : 'DENIED',
        hash: iss.id,
        summary: iss.descriptionPt,
        details: {
          recommendedAction: iss.recommendedAction,
          status: iss.status,
          statisticalEvidence: iss.statisticalEvidence ?? {},
        },
      });
    }

    rows.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return rows;
  }, [auditLogs, health, alerts]);

  const filteredAuditRows = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return unifiedAuditRows.filter((row) => {
      if (auditCategory !== 'ALL' && row.category !== auditCategory) return false;
      if (auditOutcome !== 'ALL' && row.outcome !== auditOutcome) return false;
      if (!q) return true;
      const haystack = `${row.seqLabel} ${row.service} ${row.actor} ${row.action} ${row.resource} ${row.summary} ${row.hash}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [unifiedAuditRows, auditSearch, auditCategory, auditOutcome]);

  const handleTestProvider = async (id: string) => {
    setBusyProviderId(id);
    setActionMessage(null);
    try {
      const res = await sygmaClient.fetchJson<{ provider: ProviderStatus }>(`/api/v1/providers/${id}/test`, {
        method: 'POST',
      });
      setActionMessage(`Teste ${res.provider.name}: ${res.provider.lastValidationResult}`);
      onRefreshAll();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Erro ao testar provedor');
    } finally {
      setBusyProviderId(null);
    }
  };

  const handleToggleProvider = async (id: string, enabled: boolean) => {
    setBusyProviderId(id);
    try {
      await sygmaClient.fetchJson(`/api/v1/providers/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      onRefreshAll();
    } finally {
      setBusyProviderId(null);
    }
  };

  const handleSealCredential = async (id: string) => {
    const apiKey = credentialInput[id]?.trim();
    if (!apiKey) return;
    setBusyProviderId(id);
    try {
      const res = await sygmaClient.fetchJson<{ provider: ProviderStatus }>(`/api/v1/providers/${id}/credentials`, {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });
      setCredentialInput((prev) => ({ ...prev, [id]: '' }));
      setActionMessage(`Credencial selada com AES-256-GCM para ${res.provider.name}.`);
      onRefreshAll();
    } finally {
      setBusyProviderId(null);
    }
  };

  const handleCreateBackup = async () => {
    const res = await sygmaClient.fetchJson<{ path: string; totalRecords: number }>('/api/v1/backup/create', {
      method: 'POST',
    });
    setActionMessage(`Snapshot criado: ${res.path} (${res.totalRecords} observações preservadas).`);
    onRefreshAll();
    fetchAuditLogs();
  };

  if (mode === 'QUALITY_FEEDBACK') {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5]">
              SYGMA Technical Intelligence & System Feedback
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
              Monitoramento contínuo de qualidade de dados, anomalias estatísticas (Z-Score MAD), revisões e saúde de microsserviços.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshAll}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reavaliar Diagnóstico
          </button>
        </div>

        {health && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 font-mono tabular-nums text-xs">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Estado Global</div>
                <div className={`text-sm font-bold ${health.overallStatus === 'HEALTHY' ? 'text-[#19B779]' : 'text-[#F0B94A]'}`}>
                  {health.overallStatus}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Observações DB</div>
                <div className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
                  {health.metrics.totalObservations.toLocaleString('pt-BR')}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Latência Média API</div>
                <div className="text-sm font-bold text-[#00B4D8]">{health.performance.avgApiLatencyMs} ms</div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Memória Heap / RSS</div>
                <div className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
                  {health.performance.heapUsedMb} / {health.performance.rssMb} MB
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Trilha Auditoria</div>
                <div className="text-sm font-bold text-[#19B779]">{health.subsystems.auditChainIntegrity}</div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Sessões E2EE</div>
                <div className="text-sm font-bold text-[#5CD9F5]">{health.metrics.activeE2eeSessions}</div>
              </div>
            </div>

            <ApiUsageQuotaWidget compact onQuotaMutated={onRefreshAll} />

            <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-x-auto">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] mb-3">
                Registro de Problemas, Anomalias Estatísticas e Revisões ({health.issues.length})
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                    <th className="py-2 text-left">Severidade</th>
                    <th className="py-2 text-left">Categoria</th>
                    <th className="py-2 text-left">Indicador / Fonte</th>
                    <th className="py-2 text-left">Diagnóstico & Correção Recomendada</th>
                    <th className="py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
                  {health.issues.map((issue) => (
                    <tr key={issue.id}>
                      <td
                        className={`py-2 pr-2 font-mono font-bold ${
                          issue.severity === 'CRITICAL' || issue.severity === 'HIGH'
                            ? 'text-[#E45159]'
                            : issue.severity === 'MODERATE'
                            ? 'text-[#F0B94A]'
                            : 'text-[#8FA6B9]'
                        }`}
                      >
                        {issue.severity}
                      </td>
                      <td className="py-2 pr-2 font-mono text-[11px] text-slate-600 dark:text-[#8FA6B9]">
                        {issue.category}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                          {issue.affectedIndicator}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">{issue.affectedSource}</div>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-slate-900 dark:text-[#E6EEF5]">{issue.titlePt}</div>
                        <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">{issue.descriptionPt}</div>
                        <div className="text-[11px] text-[#00B4D8]">Ação: {issue.recommendedAction}</div>
                      </td>
                      <td className="py-2 text-right font-mono">{issue.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  }

  if (mode === 'PROVIDERS') {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5]">
              Administração de Conectores e Provedores de Dados
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
              Conectores públicos oficiais operam nativamente; feeds comerciais exibem status NOT_CONFIGURED até inserção de chave no cofre AES-256-GCM.
            </p>
          </div>
          {actionMessage && (
            <span className="text-xs font-mono text-[#5CD9F5]">{actionMessage}</span>
          )}
        </div>

        <ApiUsageQuotaWidget onQuotaMutated={onRefreshAll} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {providers.map((p) => (
            <div
              key={p.id}
              className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
                    {p.category} · {p.protocol} · Circuito: {p.circuitState}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">{p.name}</h3>
                </div>
                <DataStatusText
                  status={p.connectionState === 'CONNECTED' ? 'PERIODIC' : p.connectionState}
                  compact
                />
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums bg-slate-50 dark:bg-[#061827] p-2.5 rounded border border-slate-200 dark:border-[#1A334B]">
                <div>
                  <span className="text-slate-500 dark:text-[#8FA6B9] block">Latência</span>
                  <span>{p.avgLatencyMs !== null ? `${p.avgLatencyMs} ms` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-[#8FA6B9] block">Registros</span>
                  <span>{p.recordsCollected.toLocaleString('pt-BR')}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-[#8FA6B9] block">Erros / Rate</span>
                  <span>
                    {p.errorCount} / {p.rateLimitUsed}/{p.rateLimitMax}
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-[#8FA6B9] space-y-0.5">
                <div><strong>Atraso / Frequência:</strong> {p.dataDelayDescription}</div>
                <div><strong>Validação:</strong> {p.lastValidationResult}</div>
                {p.limitations && <div className="text-[#F0B94A]">{p.limitations}</div>}
              </div>

              {(p.authStatus === 'MISSING_CREDENTIALS' || p.authStatus === 'LICENSE_REQUIRED') && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="password"
                    value={credentialInput[p.id] || ''}
                    onChange={(e) => setCredentialInput((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder="Inserir API Key / Token comercial..."
                    className="flex-1 px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                  />
                  <button
                    type="button"
                    onClick={() => handleSealCredential(p.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded"
                  >
                    <KeyRound className="w-3 h-3" /> Selar
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-[#1A334B]">
                <button
                  type="button"
                  disabled={busyProviderId === p.id}
                  onClick={() => handleTestProvider(p.id)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] disabled:opacity-50"
                >
                  <Play className="w-3 h-3" /> Testar Conexão
                </button>
                <button
                  type="button"
                  disabled={busyProviderId === p.id}
                  onClick={() => handleToggleProvider(p.id, !p.enabled)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
                >
                  {p.enabled ? 'Desativar' : 'Ativar'}
                </button>
                <a
                  href={p.documentationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-[11px] font-mono text-[#00B4D8] hover:underline"
                >
                  Documentação Oficial
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'SECURITY_AUDIT') {
    const verification = auditLogs?.verification ?? health?.auditVerification;
    const isChainValid = verification?.valid ?? true;

    return (
      <div className="space-y-6">
        {/* Top Security & Backup Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#19B779]" />
                Criptografia Ponta a Ponta (Sessão WebCrypto)
              </h3>
              <span className={`font-mono text-xs font-semibold ${e2eeTelemetry.active ? 'text-[#19B779]' : 'text-[#F0B94A]'}`}>
                {e2eeTelemetry.active ? 'VERIFICADA' : 'INATIVA'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono pt-1">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Suíte Criptográfica</div>
                <div className="text-slate-900 dark:text-[#E6EEF5] truncate">{e2eeTelemetry.cipherSuite}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Fingerprint Servidor</div>
                <div className="text-[#5CD9F5]">{e2eeTelemetry.fingerprint ?? '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">ID de Sessão ECDH</div>
                <div className="truncate text-slate-900 dark:text-[#E6EEF5]">{e2eeTelemetry.keyId ?? '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Tráfego Cifrado</div>
                <div className="text-[#19B779] tabular-nums">
                  {e2eeTelemetry.encryptedPacketsDecrypted} RX · {e2eeTelemetry.encryptedPacketsSent} TX
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
                Backup Imutável & Prova Criptográfica Merkle
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={verifyingChain}
                  onClick={handleVerifyChainNow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded hover:border-[#00B4D8] disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {verifyingChain ? 'Verificando…' : 'Verificar Integridade Agora'}
                </button>
                <button
                  type="button"
                  onClick={handleCreateBackup}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5]"
                >
                  Criar Snapshot
                </button>
              </div>
            </div>
            {actionMessage && <div className="text-xs font-mono text-[#19B779]">{actionMessage}</div>}
            <div className="text-xs space-y-1 text-slate-600 dark:text-[#8FA6B9] font-mono tabular-nums">
              <div className={`flex items-center gap-1.5 ${isChainValid ? 'text-[#19B779]' : 'text-[#E45159]'}`}>
                {isChainValid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                Cadeia SHA-256: {isChainValid ? 'ÍNTEGRA' : `VIOLAÇÃO NA SEQ #${verification?.brokenAtSeq ?? '?'}`} ·{' '}
                {verification?.totalEvents ?? 0} eventos encadeados
              </div>
              {auditLogs?.latestHash && (
                <div className="truncate">Root Hash Atual: {auditLogs.latestHash}</div>
              )}
              {health && (
                <div>
                  Último Backup: {health.backupStatus.lastBackupAt ?? 'Nenhum snapshot manual ainda'} · Backups:{' '}
                  {health.backupStatus.backupFilesCount}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Institutional Audit Logs Searchable & Filterable Console */}
        <div className="p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5]">
                Institutional Audit Logs — Registro Unificado de Integridade
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#8FA6B9] mt-0.5">
                Pesquise e filtre todos os alertas do sistema, alterações de sessão E2EE e eventos de sincronização de dados em trilha auditável.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/api/v1/export/data?scope=AUDIT_LOGS&format=csv"
                download="sygma_audit_logs.csv"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
              >
                <Download className="w-3.5 h-3.5" /> Exportar CSV
              </a>
              <a
                href="/api/v1/export/data?scope=AUDIT_LOGS&format=json"
                download="sygma_audit_logs.json"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
              >
                <Download className="w-3.5 h-3.5" /> Exportar JSON
              </a>
            </div>
          </div>

          {/* Search & Interactive Segmented Filter Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 pt-1">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Buscar por ação, serviço, indicador, hash SHA-256 ou mensagem…"
                aria-label="Pesquisar logs de auditoria"
                className="w-full pl-9 pr-3 py-2 text-xs rounded-md border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] focus:outline-none focus:border-[#00B4D8]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-[#061827] rounded-md border border-slate-200 dark:border-[#1A334B]">
              {(
                [
                  { id: 'ALL', label: 'Todos' },
                  { id: 'ALERTS', label: 'Alertas do Sistema' },
                  { id: 'E2EE', label: 'E2EE & Segurança' },
                  { id: 'SYNC', label: 'Sincronização & Dados' },
                  { id: 'EXPORTS', label: 'Relatórios & Backups' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAuditCategory(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    auditCategory === tab.id
                      ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                      : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#061827] rounded-md border border-slate-200 dark:border-[#1A334B]">
              {(['ALL', 'SUCCESS', 'DENIED', 'ERROR'] as const).map((out) => (
                <button
                  key={out}
                  type="button"
                  onClick={() => setAuditOutcome(out)}
                  className={`px-2.5 py-1.5 text-xs font-mono rounded transition-colors ${
                    auditOutcome === out
                      ? 'bg-white dark:bg-[#102438] text-slate-900 dark:text-[#5CD9F5] font-semibold'
                      : 'text-slate-500 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {out === 'ALL' ? 'Status: Todos' : out}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8FA6B9] font-mono tabular-nums">
            <span>
              Exibindo {filteredAuditRows.length} de {unifiedAuditRows.length} registros · Cadeia:{' '}
              {isChainValid ? 'VÁLIDA' : 'INVÁLIDA'}
            </span>
            <span>Clique em uma linha para inspecionar payload e prova SHA-256</span>
          </div>

          <div className="overflow-x-auto border-t border-slate-200 dark:border-[#1A334B]">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                  <th className="py-2.5 px-2 text-left">Ref</th>
                  <th className="py-2.5 px-2 text-left">Timestamp UTC</th>
                  <th className="py-2.5 px-2 text-left">Categoria / Serviço</th>
                  <th className="py-2.5 px-2 text-left">Evento / Ação</th>
                  <th className="py-2.5 px-2 text-left">Recurso</th>
                  <th className="py-2.5 px-2 text-left">Resultado</th>
                  <th className="py-2.5 px-2 text-right">Digest / ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
                {filteredAuditRows.slice(0, 120).map((row) => {
                  const isExpanded = expandedAuditUid === row.uid;
                  return (
                    <Fragment key={row.uid}>
                      <tr
                        onClick={() => setExpandedAuditUid(isExpanded ? null : row.uid)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-[#061827]/70 transition-colors"
                      >
                        <td className="py-2 px-2 text-slate-500 dark:text-[#8FA6B9] whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {row.seqLabel}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-slate-500 dark:text-[#8FA6B9] whitespace-nowrap">
                          {row.timestamp.slice(0, 19).replace('T', ' ')}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <span className="font-sans font-medium text-slate-900 dark:text-[#E6EEF5]">
                            {row.categoryLabel}
                          </span>
                          <span className="text-slate-400"> · </span>
                          <span className="text-[#5CD9F5]">{row.service}</span>
                        </td>
                        <td className="py-2 px-2 text-slate-900 dark:text-[#E6EEF5] max-w-[240px] truncate font-sans">
                          {row.action}
                        </td>
                        <td className="py-2 px-2 text-slate-600 dark:text-[#8FA6B9] max-w-[180px] truncate">
                          {row.resource}
                        </td>
                        <td
                          className={`py-2 px-2 font-bold whitespace-nowrap ${
                            row.outcome === 'SUCCESS'
                              ? 'text-[#19B779]'
                              : row.outcome === 'ERROR'
                              ? 'text-[#E45159]'
                              : 'text-[#F0B94A]'
                          }`}
                        >
                          {row.outcome}
                        </td>
                        <td className="py-2 px-2 text-right text-[#00B4D8] whitespace-nowrap">
                          {row.hash.slice(0, 14)}…
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50 dark:bg-[#061827]">
                          <td colSpan={7} className="p-3 text-[11px] text-slate-700 dark:text-[#C5D6E5] space-y-1.5">
                            <div className="font-sans text-xs font-medium text-slate-900 dark:text-[#E6EEF5]">
                              Descrição: {row.summary}
                            </div>
                            <div className="flex flex-wrap gap-4 text-slate-500 dark:text-[#8FA6B9]">
                              <span>Ator: {row.actor}</span>
                              {row.prevHash && <span>Hash Anterior: {row.prevHash}</span>}
                              <span>Hash / ID Completo: {row.hash}</span>
                            </div>
                            {row.details && (
                              <pre className="mt-1 p-2 rounded border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#0B1C2D] overflow-x-auto text-[11px]">
                                {JSON.stringify(row.details, null, 2)}
                              </pre>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredAuditRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center font-sans text-xs text-slate-500 dark:text-[#8FA6B9]">
                      Nenhum evento corresponde aos filtros selecionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'REPORTS') {
    const reports = [
      {
        id: 'DAILY_BRIEFING',
        name: 'Daily Economic Briefing (Brasil & Mercados)',
        desc: 'KPIs auditados, expectativas Focus, Pulse e Risco Quantitativo.',
      },
      {
        id: 'INFLATION_MONETARY',
        name: 'Relatório de Inflação e Política Monetária',
        desc: 'IPCA, IGP-M, Selic, CDI e expectativas de mercado.',
      },
      {
        id: 'FISCAL_RISK',
        name: 'Relatório de Risco Fiscal e Dívida Pública',
        desc: 'DBGG/PIB, DLSP/PIB e cenários de choque fiscal.',
      },
      {
        id: 'FX_ANALYSIS',
        name: 'Análise Cambial (PTAX, EUR/BRL, DXY)',
        desc: 'Cotações oficiais, volatilidade e transmissão.',
      },
      {
        id: 'QUANTITATIVE_RISK',
        name: 'Relatório de Risco Quantitativo (Monte Carlo 10k)',
        desc: 'VaR Histórico, Cornish-Fisher, Expected Shortfall e Cenários A–J.',
      },
    ];

    const toggleCustomIndicator = (id: string) => {
      setCustomExportIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const effectiveUserId =
      operatorId.trim() ||
      (e2eeTelemetry.keyId
        ? `Operador E2EE (${e2eeTelemetry.keyId})`
        : 'Operador Institucional SYGMA AIS');
    const userParam = `&user=${encodeURIComponent(effectiveUserId)}`;

    return (
      <div className="space-y-6">
        {/* Operator Identification for Institutional PDF Disclaimers */}
        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-slate-900 dark:text-[#E6EEF5]">
              Identificação do Usuário / Analista (Institutional Disclaimers nos PDFs)
            </div>
            <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">
              Registrada automaticamente com Timestamp UTC, Sessão E2EE e aviso obrigatório de conformidade CVM/ANBIMA em todo PDF exportado.
            </div>
          </div>
          <div className="flex items-center gap-2 min-w-[260px] md:w-80">
            <input
              type="text"
              value={operatorId}
              onChange={(e) => onOperatorIdChange?.(e.target.value)}
              placeholder={
                e2eeTelemetry.keyId
                  ? `Padrão: Operador E2EE (${e2eeTelemetry.keyId.slice(0, 14)}...)`
                  : 'Nome ou matrícula institucional...'
              }
              aria-label="Identificação do Usuário para Disclaimers PDF"
              className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] focus:outline-none focus:border-[#00B4D8]"
            />
          </div>
        </div>

        {/* Flagship Print-Ready Consolidated Report & Brazil SWOT Matrix */}
        <div className="p-5 rounded-lg border border-[#00B4D8]/40 bg-white dark:bg-[#102438] space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <div className="text-xs font-mono text-[#00B4D8]">
                RELATÓRIO MASTER PARA IMPRESSÃO A4 & EXPORTAÇÃO · LINGUAGEM SIMPLES
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">
                Análise Consolidada Brasil — Todos os Cenários (Base/Otimista/Adverso + A–J) & Matriz SWOT
              </h2>
              <p className="text-xs text-slate-600 dark:text-[#8FA6B9] leading-relaxed">
                Documento completo pronto para impressão e distribuição executiva, traduzindo os 39 indicadores monitorados,
                projeções ARIMA/GARCH, 10 cenários de estresse e uma Matriz SWOT completa da economia brasileira em linguagem clara.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={`/api/v1/reports/CONSOLIDATED_BRAZIL_SWOT?format=pdf${userParam}`}
                download="sygma_relatorio_consolidado_brasil_swot.pdf"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5]"
              >
                <Download className="w-4 h-4" /> Baixar PDF Ultra-Detalhado (.pdf)
              </a>
              <a
                href={`/api/v1/reports/CONSOLIDATED_BRAZIL_SWOT?format=html${userParam}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-slate-300 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#E6EEF5] hover:border-[#00B4D8]"
              >
                <Printer className="w-3.5 h-3.5" /> Versão Impressão A4 (HTML)
              </a>
              <button
                type="button"
                onClick={handleLoadSwotPreview}
                disabled={loadingSwot}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded hover:border-[#00B4D8]"
              >
                {loadingSwot
                  ? 'Gerando Prévia…'
                  : swotReport
                  ? 'Ocultar Prévia Interativa'
                  : 'Ler Análise Consolidada & SWOT'}
              </button>
            </div>
          </div>

          {/* Interactive In-App Consolidated Analysis & Brazil SWOT Preview */}
          {swotReport && (
            <div className="pt-4 border-t border-slate-200 dark:border-[#1A334B] space-y-6">
              <div className="space-y-2">
                <div className="text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
                  Digest SHA-256: {swotReport.reproducibilityHash.slice(0, 24)} · Gerado em{' '}
                  {swotReport.generatedAt.slice(0, 19).replace('T', ' ')} UTC
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
                  {swotReport.plainLanguageHeadline}
                </h3>
                <div className="space-y-1.5 text-xs text-slate-700 dark:text-[#C5D6E5] leading-relaxed">
                  {swotReport.plainLanguageSummary.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>

              {/* 4-Quadrant Brazil SWOT Matrix */}
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5] mb-3">
                  Matriz SWOT — Panorama Econômico Brasileiro (Baseado em Dados Auditados)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(
                    [
                      {
                        key: 'strengths',
                        title: 'Forças (Interno · Positivo)',
                        color: 'text-[#19B779]',
                        items: swotReport.swotMatrix.strengths,
                      },
                      {
                        key: 'weaknesses',
                        title: 'Fraquezas (Interno · Vulnerabilidades)',
                        color: 'text-[#E45159]',
                        items: swotReport.swotMatrix.weaknesses,
                      },
                      {
                        key: 'opportunities',
                        title: 'Oportunidades (Externo · Favorável)',
                        color: 'text-[#00B4D8]',
                        items: swotReport.swotMatrix.opportunities,
                      },
                      {
                        key: 'threats',
                        title: 'Ameaças (Externo · Riscos)',
                        color: 'text-[#F0B94A]',
                        items: swotReport.swotMatrix.threats,
                      },
                    ] as const
                  ).map((q) => (
                    <div
                      key={q.key}
                      className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] space-y-2.5"
                    >
                      <h5 className={`text-xs font-bold uppercase tracking-wide ${q.color}`}>{q.title}</h5>
                      <ul className="space-y-2 text-xs">
                        {q.items.map((item) => (
                          <li key={item.title} className="space-y-0.5">
                            <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">{item.title}</div>
                            <div className="text-slate-600 dark:text-[#C5D6E5]">{item.plainLanguage}</div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">
                              Evidência: {item.evidence}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* All 10 Stress Scenarios in Plain Language */}
              <div className="overflow-x-auto">
                <h4 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5] mb-2">
                  Resumo dos 10 Cenários de Estresse (A–J) em Linguagem Simples
                </h4>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                      <th className="py-2 text-left">Cód.</th>
                      <th className="py-2 text-left">Cenário</th>
                      <th className="py-2 text-right">Impacto %</th>
                      <th className="py-2 text-right">Por R$ 100M</th>
                      <th className="py-2 pl-3 text-left">O que significa na prática</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
                    {swotReport.stressScenariosPlain.map((sc) => (
                      <tr key={sc.code}>
                        <td className="py-2 pr-2 font-mono font-bold text-[#5CD9F5]">{sc.code}</td>
                        <td className="py-2 pr-2 font-medium text-slate-900 dark:text-[#E6EEF5]">{sc.namePt}</td>
                        <td
                          className={`py-2 pr-2 text-right font-mono font-bold tabular-nums ${
                            sc.estimatedPortfolioImpactPct >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'
                          }`}
                        >
                          {sc.estimatedPortfolioImpactPct > 0 ? '+' : ''}
                          {sc.estimatedPortfolioImpactPct.toFixed(2)}%
                        </td>
                        <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-700 dark:text-[#C5D6E5]">
                          R$ {(sc.estimatedBrlImpactPer100M / 1_000_000).toFixed(2)}M
                        </td>
                        <td className="py-2 pl-3 text-slate-600 dark:text-[#8FA6B9]">{sc.plainLanguageImpact}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Interactive Data Export Engine */}
        <div className="p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-[#00B4D8]" />
                Data Export Engine — Motor de Exportação Auditada
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
                Extraia séries temporais históricas, painéis macroeconômicos, matrizes de risco ou trilhas SHA-256 em CSV ou JSON com registro automático na auditoria.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenSchedules && (
                <button
                  type="button"
                  onClick={onOpenSchedules}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded hover:border-[#00B4D8]"
                >
                  <CalendarClock className="w-3.5 h-3.5" /> Agendar Envios Automáticos PDF
                </button>
              )}
              {onExportViewPdf && (
                <button
                  type="button"
                  onClick={() => onExportViewPdf()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded hover:border-[#00B4D8]"
                >
                  <Printer className="w-3.5 h-3.5" /> Converter Visualização Atual em PDF
                </button>
              )}
              <button
                type="button"
                onClick={handleRunDataExport}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5]"
              >
                <Download className="w-3.5 h-3.5" /> Executar Exportação ({exportFormat.toUpperCase()})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Conjunto de Dados</span>
              <select
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value as typeof exportScope)}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              >
                <option value="TIMESERIES">Séries Históricas Completas</option>
                <option value="SNAPSHOTS">Snapshot Atual (39 Indicadores)</option>
                <option value="MACRO_BCB">Macroeconomia Oficial (BCB/IBGE)</option>
                <option value="MARKETS">Mercados, Câmbio & Commodities</option>
                <option value="RISK_SCENARIOS">Risco Monte Carlo & Cenários A–J</option>
                <option value="FOCUS_PULSE">Expectativas Focus & Brazil Pulse</option>
                <option value="AUDIT_LOGS">Trilha de Auditoria SHA-256</option>
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Janela Temporal</span>
              <select
                value={exportRange}
                onChange={(e) => setExportRange(e.target.value as typeof exportRange)}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              >
                <option value="1M">Último 1 Mês</option>
                <option value="3M">Últimos 3 Meses</option>
                <option value="6M">Últimos 6 Meses</option>
                <option value="1Y">Último 1 Ano</option>
                <option value="3Y">Últimos 3 Anos</option>
                <option value="5Y">Últimos 5 Anos</option>
                <option value="MAX">Histórico Completo (MAX)</option>
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Escopo de Indicadores</span>
              <select
                value={exportSelectionMode}
                onChange={(e) => setExportSelectionMode(e.target.value as typeof exportSelectionMode)}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              >
                <option value="WATCHLIST">Minha Watchlist ({watchlist.length} ativos)</option>
                <option value="ALL">Todos os Indicadores ({snapshots.length})</option>
                <option value="CUSTOM">Seleção Personalizada ({customExportIds.length})</option>
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Formato de Saída</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'csv' | 'json')}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              >
                <option value="csv">CSV Auditado (Excel / Python)</option>
                <option value="json">JSON Estruturado (API / BI)</option>
              </select>
            </label>
          </div>

          {exportSelectionMode === 'CUSTOM' && snapshots.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-[#1A334B]">
              <div className="text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9] mb-2">
                Selecione os indicadores para inclusão no pacote de exportação:
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                {snapshots.map((s) => {
                  const selected = customExportIds.includes(s.definition.id);
                  return (
                    <button
                      key={s.definition.id}
                      type="button"
                      onClick={() => toggleCustomIndicator(s.definition.id)}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                        selected
                          ? 'bg-[#00B4D8]/15 border-[#00B4D8] text-[#5CD9F5] font-semibold'
                          : 'border-slate-200 dark:border-[#1A334B] text-slate-600 dark:text-[#8FA6B9]'
                      }`}
                    >
                      {s.definition.code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {exportStatusMsg && (
            <div className="text-xs font-mono text-[#19B779]">{exportStatusMsg}</div>
          )}
        </div>

        {/* Specialized Institutional Reports */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reports.map((rep) => (
            <div
              key={rep.id}
              className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-col justify-between gap-3"
            >
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">{rep.name}</h3>
                <p className="text-xs text-slate-500 dark:text-[#8FA6B9] mt-1">{rep.desc}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-[#1A334B]">
                <a
                  href={`/api/v1/reports/${rep.id}?format=pdf${userParam}`}
                  download={`sygma_${rep.id.toLowerCase()}.pdf`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5]"
                >
                  <Download className="w-3.5 h-3.5" /> Baixar PDF (.pdf)
                </a>
                <a
                  href={`/api/v1/reports/${rep.id}?format=html${userParam}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
                >
                  Impressão HTML
                </a>
                <a
                  href={`/api/v1/reports/${rep.id}?format=csv`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
                >
                  CSV Auditado
                </a>
                <a
                  href={`/api/v1/reports/${rep.id}?format=json`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
                >
                  JSON
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // NEWS_CALENDAR
  return (
    <div className="space-y-4">
      <SentimentAnalysisPanel darkMode={darkMode} language={language} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
              Central de Notícias & Comunicados Oficiais (BCB Atom Deduplicado)
            </h2>
            <DataStatusText status="PERIODIC" compact />
          </div>
          <div className="divide-y divide-slate-100 dark:divide-[#1A334B]/60">
            {news.map((item) => (
              <div key={item.id} className="py-3">
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] hover:text-[#00B4D8]"
                >
                  {item.title}
                </a>
                <p className="text-xs text-slate-600 dark:text-[#8FA6B9] mt-1">{item.summary}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">
                  <span>{item.sourceName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.publishedAt.slice(0, 16).replace('T', ' ')}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#5CD9F5]">{item.topic}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-bold ${
                      item.sentiment === 'POSITIVE'
                        ? 'text-[#19B779]'
                        : item.sentiment === 'NEGATIVE'
                        ? 'text-[#E45159]'
                        : item.sentiment === 'MIXED'
                        ? 'text-[#F0B94A]'
                        : 'text-[#8FA6B9]'
                    }`}
                  >
                    SENTIMENTO: {item.sentiment}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
            Calendário Institucional de Divulgações (Brasil & Global)
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
            Agenda recorrente oficial de estatísticas econômicas e decisões de política monetária.
          </p>
          <div className="divide-y divide-slate-100 dark:divide-[#1A334B]/60 text-xs">
            {[
              { cadencia: 'Segundas · 08:25 BRT', inst: 'BCB', ind: 'Boletim Focus — Expectativas de Mercado', imp: 'ALTA' },
              { cadencia: 'Mensal (~dia 10)', inst: 'IBGE', ind: 'IPCA — Inflação Oficial ao Consumidor', imp: 'CRÍTICA' },
              { cadencia: 'Mensal (~dia 15)', inst: 'BCB', ind: 'IBC-Br — Índice de Atividade Econômica', imp: 'ALTA' },
              { cadencia: 'A cada 45 dias', inst: 'COPOM/BCB', ind: 'Decisão Taxa Selic Meta + Comunicado', imp: 'CRÍTICA' },
              { cadencia: 'Mensal (última semana)', inst: 'BCB / STN', ind: 'Estatísticas Fiscais (DBGG/PIB e Resultado Primário)', imp: 'ALTA' },
              { cadencia: 'Trimestral', inst: 'IBGE', ind: 'Contas Nacionais Trimestrais — PIB Real', imp: 'CRÍTICA' },
              { cadencia: '8x ao ano', inst: 'FOMC / Fed', ind: 'Decisão Fed Funds Rate (EUA)', imp: 'CRÍTICA' },
            ].map((ev) => (
              <div key={ev.ind} className="py-2.5 flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">{ev.ind}</div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">
                    {ev.inst} · {ev.cadencia}
                  </div>
                </div>
                <span className="font-mono text-[10px] font-semibold text-[#00B4D8] shrink-0">{ev.imp}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
