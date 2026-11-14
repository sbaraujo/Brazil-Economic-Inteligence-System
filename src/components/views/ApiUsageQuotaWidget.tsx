import { Activity, Check, Pencil, RefreshCw, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type { ApiQuotaSnapshot, ProviderQuotaItem } from '../../types/sygma';

interface ApiUsageQuotaWidgetProps {
  compact?: boolean;
  onQuotaMutated?: () => void;
}

export function ApiUsageQuotaWidget({ compact = false, onQuotaMutated }: ApiUsageQuotaWidgetProps) {
  const [snapshot, setSnapshot] = useState<ApiQuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quotaDraft, setQuotaDraft] = useState<string>('');
  const [savingQuota, setSavingQuota] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadQuota = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sygmaClient.fetchJson<ApiQuotaSnapshot>('/api/v1/providers/quota');
      setSnapshot(res);
    } catch {
      // Preserve last valid snapshot if transient failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
    const timer = setInterval(() => {
      loadQuota();
    }, 15_000);
    return () => clearInterval(timer);
  }, [loadQuota]);

  const visibleProviders = useMemo<ProviderQuotaItem[]>(() => {
    const list = snapshot?.providers ?? [];
    if (filterMode === 'ALL') return list;
    return list.filter((p) => p.connectionState !== 'NOT_CONFIGURED' || p.requestsThisMonth > 0);
  }, [snapshot, filterMode]);

  const startEditQuota = (item: ProviderQuotaItem) => {
    setEditingId(item.providerId);
    setQuotaDraft(String(item.monthlyQuota));
    setFeedback(null);
  };

  const commitEditQuota = async (providerId: string) => {
    const parsed = Number(quotaDraft);
    if (!Number.isInteger(parsed) || parsed < 100) {
      setFeedback('Informe um inteiro >= 100 para a cota mensal.');
      return;
    }
    setSavingQuota(true);
    try {
      const updated = await sygmaClient.fetchJson<ApiQuotaSnapshot>(
        `/api/v1/providers/${encodeURIComponent(providerId)}/quota`,
        {
          method: 'PATCH',
          body: JSON.stringify({ monthlyQuota: parsed }),
        }
      );
      setSnapshot(updated);
      setEditingId(null);
      setFeedback(`Cota mensal de ${providerId} atualizada para ${parsed.toLocaleString('pt-BR')} req/mês.`);
      onQuotaMutated?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao atualizar cota');
    } finally {
      setSavingQuota(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#00B4D8]">
            <Activity className="w-3.5 h-3.5" />
            <span>API USAGE &amp; QUOTA · TELEMETRIA EM TEMPO REAL</span>
            {snapshot && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-500 dark:text-[#8FA6B9]">Ciclo {snapshot.billingMonth}</span>
              </>
            )}
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
            Consumo de APIs Financeiras &amp; Cotas Mensais Restantes
          </h3>
          <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
            Rastreamento persistente de requisições HTTP efetuadas por fonte externa (BCB SGS, Olinda Focus, Atom, Yahoo Finance, IBGE, DBnomics FMI) e saldo mensal disponível.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] p-0.5">
            <button
              type="button"
              onClick={() => setFilterMode('ACTIVE')}
              className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                filterMode === 'ACTIVE'
                  ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                  : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Fontes Ativas
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                filterMode === 'ALL'
                  ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                  : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Todos ({snapshot?.providers.length ?? 0})
            </button>
          </div>

          <button
            type="button"
            onClick={loadQuota}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-[#1A334B] text-slate-700 dark:text-[#E6EEF5] hover:border-[#00B4D8] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      {snapshot && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
          <div className="p-3 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">CONSUMO NO MÊS ({snapshot.billingMonth})</div>
            <div className="text-lg font-bold text-[#00B4D8] mt-0.5">
              {snapshot.summary.totalRequestsMonth.toLocaleString('pt-BR')}{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-[#8FA6B9]">req</span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
              Hoje ({snapshot.utcDate}): {snapshot.summary.totalRequestsToday.toLocaleString('pt-BR')} req
            </div>
          </div>

          <div className="p-3 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">COTA MENSAL RESTANTE (ATIVOS)</div>
            <div className="text-lg font-bold text-[#19B779] mt-0.5">
              {snapshot.summary.activeRemainingQuotaTotal.toLocaleString('pt-BR')}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
              Uso {snapshot.summary.activeUtilizationPct.toFixed(2)}% de{' '}
              {snapshot.summary.activeMonthlyQuotaTotal.toLocaleString('pt-BR')}
            </div>
          </div>

          <div className="p-3 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">TAXA DE SUCESSO HTTP</div>
            <div
              className={`text-lg font-bold mt-0.5 ${
                snapshot.summary.overallSuccessRatePct >= 95
                  ? 'text-[#19B779]'
                  : snapshot.summary.overallSuccessRatePct >= 80
                  ? 'text-[#F0B94A]'
                  : 'text-[#E45159]'
              }`}
            >
              {snapshot.summary.overallSuccessRatePct.toFixed(1)}%
            </div>
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
              {snapshot.summary.activeConnectorsCount} fontes ativas monitoradas
            </div>
          </div>

          <div className="p-3 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">LATÊNCIA MÉDIA PONDERADA</div>
            <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
              {snapshot.summary.weightedAvgLatencyMs !== null
                ? `${snapshot.summary.weightedAvgLatencyMs} ms`
                : '—'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
              Atualizado {snapshot.updatedAt.slice(11, 19)} UTC
            </div>
          </div>
        </div>
      )}

      {feedback && <div className="text-xs font-mono text-[#00B4D8]">{feedback}</div>}

      {/* Per-Provider Quota Consumption Table */}
      <div className="overflow-x-auto border-t border-slate-200 dark:border-[#1A334B] pt-2">
        <table className="w-full text-xs font-mono tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
              <th className="py-2 text-left font-sans">Fonte Externa / Provedor</th>
              <th className="py-2 text-right">Uso Mês</th>
              <th className="py-2 text-right">Hoje</th>
              <th className="py-2 text-right">Cota Mensal</th>
              <th className="py-2 text-right">Saldo Restante</th>
              <th className="py-2 pl-4 text-left min-w-[140px]">Consumo (%)</th>
              {!compact && <th className="py-2 text-right">Sucesso / Lat.</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
            {visibleProviders.map((item) => {
              const isNotConfigured = item.connectionState === 'NOT_CONFIGURED';
              const barColor = isNotConfigured
                ? 'bg-slate-400 dark:bg-[#1E3A54]'
                : item.usedPct >= 85
                ? 'bg-[#E45159]'
                : item.usedPct >= 65
                ? 'bg-[#F0B94A]'
                : 'bg-[#19B779]';

              return (
                <tr
                  key={item.providerId}
                  className="hover:bg-slate-50 dark:hover:bg-[#061827]/60 transition-colors"
                >
                  <td className="py-2 pr-3 font-sans">
                    <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                      {item.displayName}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 dark:text-[#8FA6B9]">
                      {item.providerId} · {item.tierLabel}
                    </div>
                  </td>
                  <td className="py-2 text-right font-semibold text-slate-900 dark:text-[#E6EEF5]">
                    {item.requestsThisMonth.toLocaleString('pt-BR')}
                  </td>
                  <td className="py-2 text-right text-slate-600 dark:text-[#8FA6B9]">
                    {item.requestsToday.toLocaleString('pt-BR')}
                  </td>
                  <td className="py-2 text-right text-slate-700 dark:text-[#C5D6E5]">
                    {editingId === item.providerId ? (
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={100}
                          value={quotaDraft}
                          onChange={(e) => setQuotaDraft(e.target.value)}
                          className="w-24 px-1.5 py-0.5 text-right text-xs rounded border border-[#00B4D8] bg-white dark:bg-[#061827] text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          disabled={savingQuota}
                          onClick={() => commitEditQuota(item.providerId)}
                          title="Salvar cota"
                          className="p-1 text-[#19B779] hover:opacity-80"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          title="Cancelar"
                          className="p-1 text-slate-400 hover:text-[#E45159]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{item.monthlyQuota.toLocaleString('pt-BR')}</span>
                        <button
                          type="button"
                          onClick={() => startEditQuota(item)}
                          title="Ajustar cota mensal"
                          className="text-slate-400 hover:text-[#00B4D8]"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 text-right font-bold ${
                      isNotConfigured
                        ? 'text-slate-400 dark:text-[#64748B]'
                        : item.remainingPct <= 15
                        ? 'text-[#E45159]'
                        : 'text-[#19B779]'
                    }`}
                  >
                    {isNotConfigured ? 'N/CONFIG' : item.requestsRemaining.toLocaleString('pt-BR')}
                  </td>
                  <td className="py-2 pl-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-[#061827] overflow-hidden border border-slate-200 dark:border-[#1A334B]">
                        <div
                          className={`h-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${Math.max(item.usedPct > 0 ? 3 : 0, item.usedPct)}%` }}
                        />
                      </div>
                      <span className="w-14 text-right text-[11px] text-slate-600 dark:text-[#8FA6B9]">
                        {item.remainingPct.toFixed(1)}% liv.
                      </span>
                    </div>
                  </td>
                  {!compact && (
                    <td className="py-2 text-right text-slate-600 dark:text-[#8FA6B9]">
                      {item.requestsThisMonth > 0
                        ? `${item.successRatePct}% · ${item.avgLatencyMs ?? '—'}ms`
                        : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}
