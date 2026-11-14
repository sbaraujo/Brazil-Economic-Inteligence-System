import { CalendarClock, CheckCheck, Download, Mail, Play, Plus, Server, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type {
  Language,
  ReportSchedule,
  ScheduleCadence,
  ScheduleDeliveryChannel,
  ScheduledDeliveryRecord,
  ScheduleReportType,
  SmtpStatus,
} from '../../types/sygma';

interface ScheduledReportsViewProps {
  schedules: ReportSchedule[];
  deliveries: ScheduledDeliveryRecord[];
  unreadCount: number;
  smtpStatus: SmtpStatus | null;
  onRefresh: () => Promise<void>;
  language: Language;
}

const REPORT_TYPE_OPTIONS: Array<{ id: ScheduleReportType; labelPt: string; labelEn: string }> = [
  {
    id: 'CONSOLIDATED_BRAZIL_SWOT',
    labelPt: 'Análise Consolidada Brasil & Matriz SWOT',
    labelEn: 'Consolidated Brazil Analysis & SWOT Matrix',
  },
  {
    id: 'DAILY_BRIEFING',
    labelPt: 'Daily Economic Briefing (Brasil & Mercados)',
    labelEn: 'Daily Economic Briefing (Brazil & Markets)',
  },
  {
    id: 'INFLATION_MONETARY',
    labelPt: 'Relatório de Inflação e Política Monetária',
    labelEn: 'Inflation & Monetary Policy Report',
  },
  {
    id: 'FISCAL_RISK',
    labelPt: 'Relatório de Risco Fiscal e Dívida Pública',
    labelEn: 'Fiscal Risk & Public Debt Report',
  },
  {
    id: 'FX_ANALYSIS',
    labelPt: 'Análise Cambial (PTAX, EUR/BRL, DXY)',
    labelEn: 'FX Analysis (PTAX, EUR/BRL, DXY)',
  },
  {
    id: 'QUANTITATIVE_RISK',
    labelPt: 'Relatório de Risco Quantitativo (Monte Carlo 10k)',
    labelEn: 'Quantitative Risk Report (Monte Carlo 10k)',
  },
];

const WEEKDAYS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const EASE = [0.16, 1, 0.3, 1] as const;

export function ScheduledReportsView({
  schedules,
  deliveries,
  unreadCount,
  smtpStatus,
  onRefresh,
  language,
}: ScheduledReportsViewProps) {
  // Schedule creation form state
  const [name, setName] = useState('Briefing Executivo Matinal Brasil');
  const [reportType, setReportType] = useState<ScheduleReportType>('CONSOLIDATED_BRAZIL_SWOT');
  const [deliveryChannel, setDeliveryChannel] = useState<ScheduleDeliveryChannel>('SYSTEM');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [cadence, setCadence] = useState<ScheduleCadence>('DAILY');
  const [timeOfDay, setTimeOfDay] = useState('08:30');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // SMTP Vault Panel State
  const [showSmtpPanel, setShowSmtpPanel] = useState(false);
  const [smtpHost, setSmtpHost] = useState(smtpStatus?.host || 'smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState(smtpStatus?.port || 587);
  const [smtpSecure, setSmtpSecure] = useState(smtpStatus?.secure || false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState(smtpStatus?.fromAddress || '');
  const [smtpBusy, setSmtpBusy] = useState(false);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setCreating(true);
    try {
      const res = await sygmaClient.fetchJson<{ schedule: ReportSchedule }>('/api/v1/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          reportType,
          deliveryChannel,
          recipientEmail: recipientEmail.trim(),
          cadence,
          timeOfDay,
          timezone: 'America/Sao_Paulo',
          dayOfWeek: cadence === 'WEEKLY' ? dayOfWeek : undefined,
          dayOfMonth: cadence === 'MONTHLY' ? dayOfMonth : undefined,
          intervalMinutes: cadence === 'INTERVAL_MINUTES' ? intervalMinutes : undefined,
        }),
      });
      setFeedback({
        kind: 'ok',
        text: `Agendamento "${res.schedule.name}" criado. Próxima execução: ${
          res.schedule.nextRunAt ? new Date(res.schedule.nextRunAt).toLocaleString('pt-BR') : '—'
        }.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Erro ao criar agendamento.',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleToggleSchedule = async (sch: ReportSchedule) => {
    setBusyId(sch.id);
    setFeedback(null);
    try {
      await sygmaClient.fetchJson(`/api/v1/schedules/${sch.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !sch.enabled }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (sch: ReportSchedule) => {
    setBusyId(sch.id);
    setFeedback(null);
    try {
      const res = await sygmaClient.fetchJson<{ delivery: ScheduledDeliveryRecord }>(
        `/api/v1/schedules/${sch.id}/run`,
        { method: 'POST' }
      );
      setFeedback({
        kind: res.delivery.status === 'FAILED' ? 'err' : 'ok',
        text: `${res.delivery.pdfFilename}: ${res.delivery.message}`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Falha ao executar envio imediato.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    setBusyId(id);
    try {
      await sygmaClient.fetchJson(`/api/v1/schedules/${id}`, { method: 'DELETE' });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleAckAll = async () => {
    await sygmaClient.fetchJson('/api/v1/schedules/deliveries/ack-all', { method: 'POST' });
    await onRefresh();
  };

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpBusy(true);
    setFeedback(null);
    try {
      await sygmaClient.fetchJson('/api/v1/schedules/smtp', {
        method: 'POST',
        body: JSON.stringify({
          host: smtpHost.trim(),
          port: Number(smtpPort),
          secure: smtpSecure,
          user: smtpUser.trim(),
          pass: smtpPass,
          fromAddress: smtpFrom.trim() || smtpUser.trim(),
        }),
      });
      setSmtpPass('');
      setFeedback({
        kind: 'ok',
        text: 'Credenciais SMTP seladas no cofre AES-256-GCM com sucesso.',
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Erro ao salvar configuração SMTP.',
      });
    } finally {
      setSmtpBusy(false);
    }
  };

  const handleTestSmtp = async () => {
    setSmtpBusy(true);
    setFeedback(null);
    try {
      const res = await sygmaClient.fetchJson<{ ok: boolean; message: string }>('/api/v1/schedules/smtp/test', {
        method: 'POST',
      });
      setFeedback({ kind: res.ok ? 'ok' : 'err', text: res.message });
    } finally {
      setSmtpBusy(false);
    }
  };

  const handleClearSmtp = async () => {
    setSmtpBusy(true);
    try {
      await sygmaClient.fetchJson('/api/v1/schedules/smtp', { method: 'DELETE' });
      setFeedback({ kind: 'ok', text: 'Configuração SMTP do cofre removida.' });
      await onRefresh();
    } finally {
      setSmtpBusy(false);
    }
  };

  const describeCadence = (s: ReportSchedule) => {
    if (s.cadence === 'INTERVAL_MINUTES') return `A cada ${s.intervalMinutes ?? 60} min`;
    if (s.cadence === 'WEEKLY') return `${WEEKDAYS_PT[s.dayOfWeek ?? 1]} · ${s.timeOfDay} BRT`;
    if (s.cadence === 'MONTHLY') return `Dia ${s.dayOfMonth ?? 1} do mês · ${s.timeOfDay} BRT`;
    return `Diário · ${s.timeOfDay} BRT`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="space-y-6"
    >
      {/* Top Status & SMTP Summary */}
      <div className="p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 dark:text-[#8FA6B9] tabular-nums">
            <span>SYGMA SCHEDULER ENGINE</span>
            <span aria-hidden="true">·</span>
            <span>{schedules.filter((s) => s.enabled).length} agendamentos ativos</span>
            <span aria-hidden="true">·</span>
            <span className={smtpStatus?.configured ? 'text-[#19B779]' : 'text-[#F0B94A]'}>
              SMTP: {smtpStatus?.configured ? `ATIVO (${smtpStatus.host}:${smtpStatus.port})` : 'NÃO CONFIGURADO'}
            </span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">
            Agendamento Automático de Relatórios PDF (E-mail & Sistema)
          </h1>
          <p className="text-xs text-slate-600 dark:text-[#8FA6B9]">
            Configure o motor de exportação PDF para gerar e despachar relatórios institucionais automaticamente em horários definidos, com arquivo no sistema e envio opcional via SMTP cifrado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleAckAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
            >
              <CheckCheck className="w-3.5 h-3.5 text-[#19B779]" /> Marcar Lidos ({unreadCount})
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSmtpPanel((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded hover:border-[#00B4D8]"
          >
            <Mail className="w-3.5 h-3.5" />
            {showSmtpPanel ? 'Ocultar Cofre SMTP' : 'Configurar Servidor SMTP'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg border text-xs font-mono ${
            feedback.kind === 'ok'
              ? 'border-[#19B779]/50 bg-[#19B779]/10 text-[#19B779]'
              : 'border-[#E45159]/50 bg-[#E45159]/10 text-[#E45159]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Collapsible SMTP Vault Configuration */}
      {showSmtpPanel && (
        <form
          onSubmit={handleSaveSmtp}
          className="p-5 rounded-lg border border-[#00B4D8]/40 bg-white dark:bg-[#102438] space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
                Transporte SMTP Institucional (Selado com AES-256-GCM no Cofre KMS)
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
                Necessário apenas para disparos com canal E-mail ou Ambos. Entregas via Sistema funcionam nativamente sem SMTP.
              </p>
            </div>
            {smtpStatus?.configured && (
              <span className="text-xs font-mono text-[#19B779]">
                Origem: {smtpStatus.source} · Usuário: {smtpStatus.userMasked}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <label className="space-y-1 block lg:col-span-2">
              <span className="text-slate-500 dark:text-[#8FA6B9]">Host SMTP</span>
              <input
                type="text"
                required
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9]">Porta</span>
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={smtpPort}
                onChange={(e) => setSmtpPort(Number(e.target.value))}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] font-mono"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9]">Usuário SMTP</span>
              <input
                type="text"
                required
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="usuario@empresa.com"
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9]">Senha / App Password</span>
              <input
                type="password"
                required
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9]">E-mail Remetente (From)</span>
              <input
                type="email"
                required
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                placeholder="relatorios@sygma.com"
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-[#C5D6E5]">
              <input
                type="checkbox"
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
                className="accent-[#00B4D8]"
              />
              Usar TLS Implícito (Porta 465)
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {smtpStatus?.configured && (
                <>
                  <button
                    type="button"
                    disabled={smtpBusy}
                    onClick={handleTestSmtp}
                    className="px-3 py-2 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
                  >
                    Testar Conexão SMTP
                  </button>
                  <button
                    type="button"
                    disabled={smtpBusy}
                    onClick={handleClearSmtp}
                    className="px-3 py-2 text-xs font-medium border border-[#E45159]/40 rounded text-[#E45159] hover:bg-[#E45159]/10"
                  >
                    Limpar Cofre
                  </button>
                </>
              )}
              <button
                type="submit"
                disabled={smtpBusy}
                className="px-4 py-2 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] disabled:opacity-50"
              >
                {smtpBusy ? 'Salvando…' : 'Selar SMTP no Cofre AES-256-GCM'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* New Schedule Form */}
      <form
        onSubmit={handleCreateSchedule}
        className="p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-4"
      >
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-[#00B4D8]" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
            Criar Novo Agendamento de Envio PDF
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <label className="space-y-1 block">
            <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Nome do Agendamento</span>
            <input
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Fechamento Diário SWOT & Risco"
              className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
            />
          </label>

          <label className="space-y-1 block">
            <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Relatório PDF (Motor Existente)</span>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ScheduleReportType)}
              className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
            >
              {REPORT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {language === 'pt' ? opt.labelPt : opt.labelEn}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Canal de Entrega</span>
            <select
              value={deliveryChannel}
              onChange={(e) => setDeliveryChannel(e.target.value as ScheduleDeliveryChannel)}
              className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
            >
              <option value="SYSTEM">Via Sistema (Arquivo & Notificação)</option>
              <option value="EMAIL">Por E-mail (Anexo PDF via SMTP)</option>
              <option value="BOTH">Ambos (Sistema + E-mail)</option>
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Frequência / Cadência</span>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as ScheduleCadence)}
              className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
            >
              <option value="DAILY">Diário (Horário Fixo BRT)</option>
              <option value="WEEKLY">Semanal (Dia da Semana + Horário)</option>
              <option value="MONTHLY">Mensal (Dia do Mês + Horário)</option>
              <option value="INTERVAL_MINUTES">Recorrente (A cada N Minutos)</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs items-end">
          {cadence !== 'INTERVAL_MINUTES' ? (
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Horário (America/Sao_Paulo)</span>
              <input
                type="time"
                required
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] font-mono"
              />
            </label>
          ) : (
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Intervalo (5 a 1440 min)</span>
              <input
                type="number"
                required
                min={5}
                max={1440}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] font-mono"
              />
            </label>
          )}

          {cadence === 'WEEKLY' && (
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Dia da Semana</span>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              >
                {WEEKDAYS_PT.map((label, idx) => (
                  <option key={label} value={idx}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {cadence === 'MONTHLY' && (
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">Dia do Mês (1–28)</span>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] font-mono"
              />
            </label>
          )}

          {(deliveryChannel === 'EMAIL' || deliveryChannel === 'BOTH') && (
            <label className="space-y-1 block">
              <span className="text-slate-500 dark:text-[#8FA6B9] font-medium">E-mail de Destino</span>
              <input
                type="email"
                required
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="destinatario@instituicao.com.br"
                className="w-full px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {creating ? 'Agendando…' : 'Criar Agendamento Automático'}
          </button>
        </div>
      </form>

      {/* Active & Paused Schedules Table */}
      <div className="p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-x-auto space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
            Rotinas Agendadas ({schedules.length})
          </h2>
          <span className="text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
            Verificação automática em segundo plano a cada 30s
          </span>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
              <th className="py-2 text-left">Agendamento / Relatório</th>
              <th className="py-2 text-left">Canal / Destino</th>
              <th className="py-2 text-left">Programação</th>
              <th className="py-2 text-left">Próxima Execução</th>
              <th className="py-2 text-right font-mono">Execuções</th>
              <th className="py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
            {schedules.map((sch) => (
              <tr key={sch.id} className="hover:bg-slate-50 dark:hover:bg-[#0A2540]/50">
                <td className="py-2.5 pr-3">
                  <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">{sch.name}</div>
                  <div className="text-[11px] font-mono text-[#00B4D8]">{sch.reportType}</div>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="font-medium text-slate-800 dark:text-[#C5D6E5]">
                    {sch.deliveryChannel === 'SYSTEM'
                      ? 'Via Sistema'
                      : sch.deliveryChannel === 'EMAIL'
                      ? 'E-mail (SMTP)'
                      : 'Sistema + E-mail'}
                  </div>
                  {sch.recipientEmail && (
                    <div className="text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">{sch.recipientEmail}</div>
                  )}
                </td>
                <td className="py-2.5 pr-3 font-mono text-slate-700 dark:text-[#C5D6E5]">
                  {describeCadence(sch)}
                </td>
                <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-600 dark:text-[#8FA6B9]">
                  {sch.enabled && sch.nextRunAt ? new Date(sch.nextRunAt).toLocaleString('pt-BR') : 'PAUSADO'}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-900 dark:text-[#E6EEF5]">
                  {sch.runCount}
                </td>
                <td className="py-2.5 text-right whitespace-nowrap space-x-1.5">
                  <button
                    type="button"
                    disabled={busyId === sch.id}
                    onClick={() => handleRunNow(sch)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] disabled:opacity-50"
                  >
                    <Play className="w-3 h-3" /> Executar Agora
                  </button>
                  <button
                    type="button"
                    disabled={busyId === sch.id}
                    onClick={() => handleToggleSchedule(sch)}
                    className="px-2.5 py-1 text-[11px] font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
                  >
                    {sch.enabled ? 'Pausar' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === sch.id}
                    onClick={() => handleDeleteSchedule(sch.id)}
                    title="Excluir agendamento"
                    className="p-1 text-slate-400 hover:text-[#E45159]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {schedules.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500 dark:text-[#8FA6B9]">
                  Nenhum agendamento configurado ainda. Utilize o formulário acima para programar envios automáticos de PDF.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Delivery Archive & Dispatch History */}
      <div className="p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-x-auto space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5] flex items-center gap-2">
            <Server className="w-4 h-4 text-[#00B4D8]" />
            Histórico de Envios & Relatórios PDF Arquivados ({deliveries.length})
          </h2>
          <span className="text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
            Todos os disparos são registrados na cadeia Merkle SHA-256
          </span>
        </div>

        <table className="w-full text-xs font-mono tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
              <th className="py-2 text-left">Executado em</th>
              <th className="py-2 text-left font-sans">Agendamento / Relatório</th>
              <th className="py-2 text-left">Modo</th>
              <th className="py-2 text-left">Status Entrega</th>
              <th className="py-2 text-left">E-mail</th>
              <th className="py-2 text-right">Tamanho</th>
              <th className="py-2 text-right">SHA-256</th>
              <th className="py-2 text-right font-sans">Arquivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
            {deliveries.map((dlv) => (
              <tr key={dlv.id} className="hover:bg-slate-50 dark:hover:bg-[#0A2540]/50">
                <td className="py-2 pr-2 whitespace-nowrap text-slate-600 dark:text-[#8FA6B9]">
                  {dlv.executedAt.slice(0, 19).replace('T', ' ')}
                </td>
                <td className="py-2 pr-2 font-sans">
                  <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">{dlv.scheduleName}</div>
                  <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">{dlv.message}</div>
                </td>
                <td className="py-2 pr-2 text-slate-700 dark:text-[#C5D6E5]">{dlv.triggerMode}</td>
                <td
                  className={`py-2 pr-2 font-bold ${
                    dlv.status === 'DELIVERED'
                      ? 'text-[#19B779]'
                      : dlv.status === 'PARTIAL'
                      ? 'text-[#F0B94A]'
                      : 'text-[#E45159]'
                  }`}
                >
                  {dlv.status}
                </td>
                <td className="py-2 pr-2 text-slate-600 dark:text-[#8FA6B9]">{dlv.emailStatus}</td>
                <td className="py-2 pr-2 text-right text-slate-700 dark:text-[#C5D6E5]">
                  {(dlv.pdfBytes / 1024).toFixed(1)} KB
                </td>
                <td className="py-2 pr-2 text-right text-[#00B4D8]">{dlv.sha256.slice(0, 14)}…</td>
                <td className="py-2 text-right font-sans">
                  {dlv.systemStatus === 'STORED' ? (
                    <a
                      href={`/api/v1/schedules/deliveries/${dlv.id}/pdf`}
                      download={dlv.pdfFilename}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded hover:border-[#00B4D8]"
                    >
                      <Download className="w-3 h-3" /> PDF
                    </a>
                  ) : (
                    <span className="text-[11px] text-slate-400">E-mail only</span>
                  )}
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center font-sans text-xs text-slate-500 dark:text-[#8FA6B9]">
                  Nenhuma execução registrada até o momento. Clique em &quot;Executar Agora&quot; ou aguarde o horário programado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
