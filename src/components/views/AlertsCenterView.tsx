import { Bell, BellRing, Check, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type { AlertDirection, AlertRule, IndicatorSnapshot, Language, TriggeredAlert } from '../../types/sygma';
import { formatNumberPt } from '../common/StatusBadge';

interface AlertsCenterViewProps {
  snapshots: IndicatorSnapshot[];
  watchlist: string[];
  rules: AlertRule[];
  alerts: TriggeredAlert[];
  pushEnabled: boolean;
  pushPermission: string;
  onRequestPushPermission: () => void;
  onTogglePushEnabled: (v: boolean) => void;
  onRefreshAlerts: () => void;
  language: Language;
}

export function AlertsCenterView({
  snapshots,
  watchlist,
  rules,
  alerts,
  pushEnabled,
  pushPermission,
  onRequestPushPermission,
  onTogglePushEnabled,
  onRefreshAlerts,
  language,
}: AlertsCenterViewProps) {
  const watchlistSnapshots = snapshots.filter((s) => watchlist.includes(s.definition.id));
  const candidateSnapshots = watchlistSnapshots.length > 0 ? watchlistSnapshots : snapshots;

  const [indicatorId, setIndicatorId] = useState<string>(
    watchlist[0] || snapshots[0]?.definition.id || 'USD_BRL_PTAX'
  );
  const [thresholdPct, setThresholdPct] = useState<string>('1.0');
  const [direction, setDirection] = useState<AlertDirection>('BOTH');
  const [cooldownMinutes, setCooldownMinutes] = useState<string>('60');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const numThreshold = Number(thresholdPct.replace(',', '.'));
    if (!Number.isFinite(numThreshold) || numThreshold <= 0) {
      setFeedback('Informe um limiar percentual positivo (ex.: 1.0 ou 0.25).');
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await sygmaClient.fetchJson<{ rule: AlertRule; triggered: TriggeredAlert[] }>(
        '/api/v1/alerts/rules',
        {
          method: 'POST',
          body: JSON.stringify({
            indicatorId,
            thresholdPct: numThreshold,
            direction,
            cooldownMinutes: Math.max(1, Number(cooldownMinutes) || 60),
          }),
        }
      );
      if (res.triggered.length > 0) {
        setFeedback(
          `Regra criada e disparada imediatamente: ${res.triggered[0].code} variou ${res.triggered[0].observedPctChange}%.`
        );
      } else {
        setFeedback(`Regra ativa criada para ${indicatorId} (±${numThreshold}%).`);
      }
      onRefreshAlerts();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao criar regra de alerta');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    setBusy(true);
    try {
      await sygmaClient.fetchJson(`/api/v1/alerts/rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      onRefreshAlerts();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    setBusy(true);
    try {
      await sygmaClient.fetchJson(`/api/v1/alerts/rules/${id}`, { method: 'DELETE' });
      onRefreshAlerts();
    } finally {
      setBusy(false);
    }
  };

  const handleEvaluateNow = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await sygmaClient.fetchJson<{ triggered: TriggeredAlert[] }>('/api/v1/alerts/evaluate', {
        method: 'POST',
      });
      setFeedback(
        res.triggered.length > 0
          ? `${res.triggered.length} alerta(s) disparado(s) na avaliação atual.`
          : 'Avaliação concluída: nenhum novo limiar ultrapassado (ou em período de cooldown).'
      );
      onRefreshAlerts();
    } finally {
      setBusy(false);
    }
  };

  const handleAck = async (id: string) => {
    await sygmaClient.fetchJson(`/api/v1/alerts/${id}/ack`, { method: 'POST' });
    onRefreshAlerts();
  };

  const handleAckAll = async () => {
    await sygmaClient.fetchJson('/api/v1/alerts/ack-all', { method: 'POST' });
    onRefreshAlerts();
  };

  return (
    <div className="space-y-4">
      {/* Header & Push Notifications Control */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] flex items-center gap-2">
            <BellRing className="w-4 h-4 text-[#00B4D8]" />
            {language === 'pt'
              ? 'Sistema de Alertas Configuráveis (Watchlist & Variação Percentual)'
              : 'Configurable Watchlist Threshold Alerts'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#8FA6B9] mt-0.5">
            Monitora automaticamente indicadores da Watchlist a cada sincronização e dispara alertas in-app e notificações push do navegador quando o limiar percentual é atingido.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRequestPushPermission}
            className="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
          >
            Push Browser: {pushPermission === 'granted' ? 'Autorizado' : pushPermission === 'denied' ? 'Bloqueado' : 'Autorizar'}
          </button>
          <button
            type="button"
            onClick={() => onTogglePushEnabled(!pushEnabled)}
            className={`px-3 py-1.5 text-xs font-mono rounded border ${
              pushEnabled
                ? 'border-[#19B779]/50 text-[#19B779] bg-[#19B779]/10'
                : 'border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]'
            }`}
          >
            Notificações: {pushEnabled ? 'ATIVAS' : 'PAUSADAS'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleEvaluateNow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> Avaliar Agora
          </button>
        </div>
      </div>

      {/* Create Rule Form */}
      <form
        onSubmit={handleCreateRule}
        className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
            Nova Regra de Limiar Percentual (Watchlist: {watchlist.length} favoritos)
          </h3>
          {feedback && <span className="text-xs font-mono text-[#5CD9F5]">{feedback}</span>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-[11px] text-slate-500 dark:text-[#8FA6B9] mb-1">
              Indicador da Watchlist / Catálogo
            </label>
            <select
              value={indicatorId}
              onChange={(e) => setIndicatorId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
            >
              {watchlistSnapshots.length > 0 && (
                <optgroup label="★ Minha Watchlist">
                  {watchlistSnapshots.map((s) => (
                    <option key={s.definition.id} value={s.definition.id}>
                      ★ {s.definition.code} — {s.definition.namePt} (atual: {s.changePct !== null ? `${s.changePct}%` : '—'})
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Todos os Indicadores">
                {candidateSnapshots.length !== snapshots.length &&
                  snapshots
                    .filter((s) => !watchlist.includes(s.definition.id))
                    .map((s) => (
                      <option key={s.definition.id} value={s.definition.id}>
                        {s.definition.code} — {s.definition.namePt}
                      </option>
                    ))}
                {watchlistSnapshots.length === 0 &&
                  snapshots.map((s) => (
                    <option key={s.definition.id} value={s.definition.id}>
                      {s.definition.code} — {s.definition.namePt}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 dark:text-[#8FA6B9] mb-1">
              Limiar Variação (%)
            </label>
            <input
              type="number"
              step="0.05"
              min="0.01"
              max="100"
              value={thresholdPct}
              onChange={(e) => setThresholdPct(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 dark:text-[#8FA6B9] mb-1">
              Direção
            </label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as AlertDirection)}
              className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
            >
              <option value="BOTH">Alta ou Queda (|Δ%| ≥ limiar)</option>
              <option value="UP">Somente Alta (Δ% ≥ +limiar)</option>
              <option value="DOWN">Somente Queda (Δ% ≤ -limiar)</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[11px] text-slate-500 dark:text-[#8FA6B9] mb-1">
                Cooldown (min)
              </label>
              <input
                type="number"
                min="1"
                max="1440"
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar
            </button>
          </div>
        </div>
      </form>

      {/* Configured Rules & Triggered History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-x-auto">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] mb-3">
            Regras Configuradas ({rules.length})
          </h3>
          {rules.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-[#8FA6B9] py-6 text-center">
              Nenhuma regra de alerta configurada. Selecione um indicador da Watchlist acima para começar.
            </p>
          ) : (
            <table className="w-full text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                  <th className="py-1.5 text-left">Indicador</th>
                  <th className="py-1.5 text-right">Limiar</th>
                  <th className="py-1.5 text-center">Direção</th>
                  <th className="py-1.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
                {rules.map((r) => {
                  const snap = snapshots.find((s) => s.definition.id === r.indicatorId);
                  return (
                    <tr key={r.id}>
                      <td className="py-2 font-sans">
                        <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                          {snap?.definition.code ?? r.indicatorId}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                          Cooldown {r.cooldownMinutes}m · {r.enabled ? 'Ativa' : 'Pausada'}
                        </div>
                      </td>
                      <td className="py-2 text-right font-bold text-[#5CD9F5]">±{r.thresholdPct}%</td>
                      <td className="py-2 text-center text-[11px]">{r.direction}</td>
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleRule(r)}
                            className="px-2 py-0.5 text-[10px] border border-slate-200 dark:border-[#1A334B] rounded hover:border-[#00B4D8]"
                          >
                            {r.enabled ? 'Pausar' : 'Ativar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRule(r.id)}
                            aria-label="Excluir regra"
                            className="p-1 text-[#E45159] hover:bg-[#E45159]/10 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-[#F0B94A]" /> Histórico de Alertas Disparados ({alerts.length})
            </h3>
            {alerts.some((a) => !a.acknowledged) && (
              <button
                type="button"
                onClick={handleAckAll}
                className="text-[11px] font-mono text-[#00B4D8] hover:underline"
              >
                Marcar todos como lidos
              </button>
            )}
          </div>
          {alerts.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-[#8FA6B9] py-6 text-center">
              Nenhum disparo registrado ainda.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {alerts.map((al) => (
                <div
                  key={al.id}
                  className={`p-2.5 rounded border text-xs flex items-start justify-between gap-2 ${
                    al.acknowledged
                      ? 'border-slate-200 dark:border-[#1A334B] bg-slate-50/50 dark:bg-[#061827]/50 opacity-75'
                      : 'border-[#F0B94A]/50 bg-[#F0B94A]/10'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                      {al.code} — {al.namePt}
                    </div>
                    <div className="font-mono text-[11px] mt-0.5 tabular-nums">
                      Variação:{' '}
                      <span className={al.observedPctChange >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'}>
                        {al.observedPctChange > 0 ? '+' : ''}
                        {al.observedPctChange.toFixed(2)}%
                      </span>{' '}
                      (limiar ±{al.thresholdPct}%) · Valor: {formatNumberPt(al.value, 4)} {al.unit}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 dark:text-[#8FA6B9] mt-0.5">
                      Ref: {al.referenceDate} · Disparado em {al.triggeredAt.slice(0, 19).replace('T', ' ')} UTC
                    </div>
                  </div>
                  {!al.acknowledged && (
                    <button
                      type="button"
                      onClick={() => handleAck(al.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] shrink-0"
                    >
                      <Check className="w-3 h-3" /> Ciente
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
