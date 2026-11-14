import crypto from 'crypto';
import fs from 'fs';
import nodemailer from 'nodemailer';
import path from 'path';
import { cryptoService } from './cryptoService.ts';
import { reportService, type ReportType } from './reportService.ts';

export type ScheduleDeliveryChannel = 'SYSTEM' | 'EMAIL' | 'BOTH';
export type ScheduleCadence = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'INTERVAL_MINUTES';

export interface ReportSchedule {
  id: string;
  name: string;
  reportType: ReportType;
  deliveryChannel: ScheduleDeliveryChannel;
  recipientEmail: string;
  cadence: ScheduleCadence;
  timeOfDay: string; // HH:MM (24h)
  timezone: string;
  dayOfWeek?: number; // 0 (Dom) .. 6 (Sáb)
  dayOfMonth?: number; // 1 .. 28
  intervalMinutes?: number; // 5 .. 1440
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
  reportType: ReportType;
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

export interface SmtpConfigPayload {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
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

interface PersistedSchedulerState {
  schedules: ReportSchedule[];
  deliveries: ScheduledDeliveryRecord[];
}

const DEFAULT_DATA_DIR = process.env.SYGMA_DATA_DIR
  ? path.resolve(process.env.SYGMA_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

const SMTP_VAULT_KEY = 'smtp_transport_v1';

function maskIdentity(value: string): string {
  if (!value) return '••••';
  const atIdx = value.indexOf('@');
  if (atIdx > 2) {
    return `${value.slice(0, 2)}••••${value.slice(atIdx)}`;
  }
  return value.length > 4 ? `${value.slice(0, 2)}••••${value.slice(-2)}` : '••••';
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay.trim());
  if (!match) return { hour: 8, minute: 30 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function getTimeZoneParts(utcMs: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function zonedWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const zoned = getTimeZoneParts(guessUtc, timeZone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, 0, 0);
  const offsetMs = zonedAsUtc - guessUtc;
  return guessUtc - offsetMs;
}

export function computeNextRunIso(schedule: Pick<
  ReportSchedule,
  'cadence' | 'timeOfDay' | 'timezone' | 'dayOfWeek' | 'dayOfMonth' | 'intervalMinutes'
>, fromMs = Date.now()): string {
  const tz = schedule.timezone || 'America/Sao_Paulo';
  if (schedule.cadence === 'INTERVAL_MINUTES') {
    const mins = Math.max(5, Math.min(1440, Number(schedule.intervalMinutes ?? 60)));
    return new Date(fromMs + mins * 60_000).toISOString();
  }

  const { hour, minute } = parseTimeOfDay(schedule.timeOfDay || '08:30');
  const nowParts = getTimeZoneParts(fromMs, tz);

  // Search forward day by day up to 45 days in target timezone
  for (let offsetDays = 0; offsetDays <= 45; offsetDays++) {
    const refUtc = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + offsetDays, 12, 0, 0);
    const dParts = getTimeZoneParts(refUtc, tz);

    if (schedule.cadence === 'WEEKLY') {
      const targetDow = Math.max(0, Math.min(6, Number(schedule.dayOfWeek ?? 1)));
      if (dParts.weekday !== targetDow) continue;
    }

    if (schedule.cadence === 'MONTHLY') {
      const targetDom = Math.max(1, Math.min(28, Number(schedule.dayOfMonth ?? 1)));
      if (dParts.day !== targetDom) continue;
    }

    const candidateMs = zonedWallTimeToUtcMs(dParts.year, dParts.month, dParts.day, hour, minute, tz);
    if (candidateMs > fromMs + 5_000) {
      return new Date(candidateMs).toISOString();
    }
  }

  return new Date(fromMs + 24 * 60 * 60 * 1000).toISOString();
}

export class ReportSchedulerService {
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly reportsDir: string;
  private state: PersistedSchedulerState = { schedules: [], deliveries: [] };
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.stateFile = path.join(this.dataDir, 'sygma_schedules.json');
    this.reportsDir = path.join(this.dataDir, 'scheduled_reports');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
    this.load();
  }

  private load() {
    if (fs.existsSync(this.stateFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as PersistedSchedulerState;
        if (parsed && Array.isArray(parsed.schedules) && Array.isArray(parsed.deliveries)) {
          this.state = parsed;
        }
      } catch {
        this.state = { schedules: [], deliveries: [] };
      }
    }
  }

  private save() {
    try {
      const tmp = `${this.stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.stateFile);
    } catch {
      // Non-fatal in constrained filesystems
    }
  }

  public start(pollIntervalMs = 30_000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processDueSchedules().catch((err) => {
        console.error('[SYGMA-SCHEDULER] Background dispatch error:', err);
      });
    }, pollIntervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getSchedules(): ReportSchedule[] {
    return [...this.state.schedules];
  }

  public getDeliveries(limit = 100): ScheduledDeliveryRecord[] {
    return [...this.state.deliveries].slice(-limit).reverse();
  }

  public getUnreadDeliveriesCount(): number {
    return this.state.deliveries.filter((d) => d.systemStatus === 'STORED' && !d.acknowledged).length;
  }

  public acknowledgeAllDeliveries(): number {
    let count = 0;
    for (const d of this.state.deliveries) {
      if (!d.acknowledged) {
        d.acknowledged = true;
        count++;
      }
    }
    if (count > 0) this.save();
    return count;
  }

  public getSmtpStatus(): SmtpStatus {
    const resolved = this.resolveSmtpConfig();
    if (!resolved) {
      return {
        configured: false,
        source: 'NONE',
        host: null,
        port: null,
        secure: false,
        userMasked: null,
        fromAddress: null,
      };
    }
    return {
      configured: true,
      source: resolved.source,
      host: resolved.config.host,
      port: resolved.config.port,
      secure: resolved.config.secure,
      userMasked: maskIdentity(resolved.config.user),
      fromAddress: resolved.config.fromAddress,
    };
  }

  public saveSmtpConfig(config: SmtpConfigPayload): SmtpStatus {
    cryptoService.sealCredential(SMTP_VAULT_KEY, JSON.stringify(config));
    cryptoService.recordAudit('svc-scheduler', 'ADMIN', 'SMTP_CONFIG_UPDATED', config.host, 'SUCCESS', {
      port: config.port,
      secure: config.secure,
      fromAddress: config.fromAddress,
    });
    return this.getSmtpStatus();
  }

  public clearSmtpConfig(): SmtpStatus {
    cryptoService.sealCredential(SMTP_VAULT_KEY, JSON.stringify({ cleared: true }));
    cryptoService.recordAudit('svc-scheduler', 'ADMIN', 'SMTP_CONFIG_CLEARED', SMTP_VAULT_KEY, 'SUCCESS');
    return this.getSmtpStatus();
  }

  private resolveSmtpConfig(): { source: 'VAULT' | 'ENV'; config: SmtpConfigPayload } | null {
    const sealed = cryptoService.unsealCredential(SMTP_VAULT_KEY);
    if (sealed) {
      try {
        const parsed = JSON.parse(sealed) as Partial<SmtpConfigPayload> & { cleared?: boolean };
        if (!parsed.cleared && parsed.host && parsed.user && parsed.pass) {
          return {
            source: 'VAULT',
            config: {
              host: parsed.host,
              port: Number(parsed.port || 587),
              secure: Boolean(parsed.secure),
              user: parsed.user,
              pass: parsed.pass,
              fromAddress: parsed.fromAddress || parsed.user,
            },
          };
        }
      } catch {
        // Ignore malformed vault payload
      }
    }

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      return {
        source: 'ENV',
        config: {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
          fromAddress: process.env.SMTP_FROM || process.env.SMTP_USER,
        },
      };
    }

    return null;
  }

  public async testSmtpConnection(): Promise<{ ok: boolean; message: string }> {
    const resolved = this.resolveSmtpConfig();
    if (!resolved) {
      return { ok: false, message: 'Nenhum servidor SMTP configurado no cofre AES-256-GCM ou variáveis de ambiente.' };
    }
    try {
      const transporter = nodemailer.createTransport({
        host: resolved.config.host,
        port: resolved.config.port,
        secure: resolved.config.secure,
        auth: {
          user: resolved.config.user,
          pass: resolved.config.pass,
        },
      });
      await transporter.verify();
      cryptoService.recordAudit('svc-scheduler', 'ADMIN', 'SMTP_CONNECTION_VERIFIED', resolved.config.host, 'SUCCESS');
      return { ok: true, message: `Conexão SMTP validada com sucesso (${resolved.config.host}:${resolved.config.port}).` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha na verificação SMTP';
      cryptoService.recordAudit('svc-scheduler', 'ADMIN', 'SMTP_CONNECTION_FAILED', resolved.config.host, 'ERROR', {
        error: msg,
      });
      return { ok: false, message: msg };
    }
  }

  public createSchedule(input: {
    name: string;
    reportType: ReportType;
    deliveryChannel: ScheduleDeliveryChannel;
    recipientEmail?: string;
    cadence: ScheduleCadence;
    timeOfDay?: string;
    timezone?: string;
    dayOfWeek?: number;
    dayOfMonth?: number;
    intervalMinutes?: number;
  }): ReportSchedule {
    const timeOfDay = input.timeOfDay || '08:30';
    const timezone = input.timezone || 'America/Sao_Paulo';
    const nextRunAt = computeNextRunIso({
      cadence: input.cadence,
      timeOfDay,
      timezone,
      dayOfWeek: input.dayOfWeek,
      dayOfMonth: input.dayOfMonth,
      intervalMinutes: input.intervalMinutes,
    });

    const schedule: ReportSchedule = {
      id: `sch-${crypto.randomBytes(4).toString('hex')}`,
      name: input.name.trim(),
      reportType: input.reportType,
      deliveryChannel: input.deliveryChannel,
      recipientEmail: (input.recipientEmail || '').trim(),
      cadence: input.cadence,
      timeOfDay,
      timezone,
      dayOfWeek: input.cadence === 'WEEKLY' ? Number(input.dayOfWeek ?? 1) : undefined,
      dayOfMonth: input.cadence === 'MONTHLY' ? Number(input.dayOfMonth ?? 1) : undefined,
      intervalMinutes: input.cadence === 'INTERVAL_MINUTES' ? Number(input.intervalMinutes ?? 60) : undefined,
      enabled: true,
      lastRunAt: null,
      nextRunAt,
      runCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.state.schedules.push(schedule);
    this.save();
    cryptoService.recordAudit('svc-scheduler', 'USER', 'SCHEDULE_CREATED', schedule.id, 'SUCCESS', {
      name: schedule.name,
      reportType: schedule.reportType,
      deliveryChannel: schedule.deliveryChannel,
      cadence: schedule.cadence,
      nextRunAt: schedule.nextRunAt,
    });
    return schedule;
  }

  public updateSchedule(
    id: string,
    patch: Partial<
      Pick<
        ReportSchedule,
        | 'name'
        | 'enabled'
        | 'deliveryChannel'
        | 'recipientEmail'
        | 'cadence'
        | 'timeOfDay'
        | 'dayOfWeek'
        | 'dayOfMonth'
        | 'intervalMinutes'
      >
    >
  ): ReportSchedule {
    const schedule = this.state.schedules.find((s) => s.id === id);
    if (!schedule) throw new Error(`Agendamento ${id} não encontrado.`);

    if (typeof patch.name === 'string' && patch.name.trim()) schedule.name = patch.name.trim();
    if (typeof patch.enabled === 'boolean') schedule.enabled = patch.enabled;
    if (patch.deliveryChannel) schedule.deliveryChannel = patch.deliveryChannel;
    if (typeof patch.recipientEmail === 'string') schedule.recipientEmail = patch.recipientEmail.trim();
    if (patch.cadence) schedule.cadence = patch.cadence;
    if (typeof patch.timeOfDay === 'string') schedule.timeOfDay = patch.timeOfDay;
    if (typeof patch.dayOfWeek === 'number') schedule.dayOfWeek = patch.dayOfWeek;
    if (typeof patch.dayOfMonth === 'number') schedule.dayOfMonth = patch.dayOfMonth;
    if (typeof patch.intervalMinutes === 'number') schedule.intervalMinutes = patch.intervalMinutes;

    schedule.nextRunAt = schedule.enabled ? computeNextRunIso(schedule) : null;
    this.save();
    cryptoService.recordAudit('svc-scheduler', 'USER', 'SCHEDULE_UPDATED', schedule.id, 'SUCCESS', {
      enabled: schedule.enabled,
      nextRunAt: schedule.nextRunAt,
    });
    return schedule;
  }

  public deleteSchedule(id: string): void {
    const idx = this.state.schedules.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Agendamento ${id} não encontrado.`);
    const [removed] = this.state.schedules.splice(idx, 1);
    this.save();
    cryptoService.recordAudit('svc-scheduler', 'USER', 'SCHEDULE_DELETED', id, 'SUCCESS', {
      name: removed.name,
    });
  }

  public async triggerScheduleNow(id: string): Promise<ScheduledDeliveryRecord> {
    const schedule = this.state.schedules.find((s) => s.id === id);
    if (!schedule) throw new Error(`Agendamento ${id} não encontrado.`);
    return this.executeSchedule(schedule, 'MANUAL', Date.now());
  }

  public async processDueSchedules(nowMs = Date.now()): Promise<ScheduledDeliveryRecord[]> {
    if (this.processing) return [];
    this.processing = true;
    const executed: ScheduledDeliveryRecord[] = [];
    try {
      for (const schedule of this.state.schedules) {
        if (!schedule.enabled || !schedule.nextRunAt) continue;
        const dueMs = Date.parse(schedule.nextRunAt);
        if (!Number.isNaN(dueMs) && nowMs >= dueMs) {
          const rec = await this.executeSchedule(schedule, 'SCHEDULED', nowMs);
          executed.push(rec);
        }
      }
    } finally {
      this.processing = false;
    }
    return executed;
  }

  private async executeSchedule(
    schedule: ReportSchedule,
    triggerMode: 'SCHEDULED' | 'MANUAL',
    nowMs: number
  ): Promise<ScheduledDeliveryRecord> {
    const nowIso = new Date(nowMs).toISOString();
    const deliveryId = `dlv-${crypto.randomBytes(5).toString('hex')}`;
    const safeSlug = schedule.reportType.toLowerCase();
    const stamp = nowIso.slice(0, 16).replace(/[:T]/g, '-');
    const pdfFilename = `sygma_${safeSlug}_${stamp}.pdf`;

    const pdfBuffer = await reportService.renderPdf(schedule.reportType, {
      userIdentification: schedule.recipientEmail
        ? `Agendamento (${triggerMode}) -> ${schedule.recipientEmail}`
        : `SYGMA Scheduler Daemon (${triggerMode}: ${schedule.name})`,
    });
    const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    const storeInSystem = schedule.deliveryChannel === 'SYSTEM' || schedule.deliveryChannel === 'BOTH';
    const sendEmail = schedule.deliveryChannel === 'EMAIL' || schedule.deliveryChannel === 'BOTH';

    let systemStatus: ScheduledDeliveryRecord['systemStatus'] = 'NOT_APPLICABLE';
    if (storeInSystem) {
      const targetPath = path.join(this.reportsDir, `${deliveryId}.pdf`);
      fs.writeFileSync(targetPath, pdfBuffer);
      systemStatus = 'STORED';
    }

    let emailStatus: ScheduledDeliveryRecord['emailStatus'] = 'NOT_APPLICABLE';
    let emailDetail = '';

    if (sendEmail) {
      const smtp = this.resolveSmtpConfig();
      if (!smtp) {
        emailStatus = 'NOT_CONFIGURED';
        emailDetail = 'SMTP não configurado no cofre KMS ou variáveis de ambiente.';
      } else if (!schedule.recipientEmail) {
        emailStatus = 'FAILED';
        emailDetail = 'E-mail de destino não informado no agendamento.';
      } else {
        try {
          const transporter = nodemailer.createTransport({
            host: smtp.config.host,
            port: smtp.config.port,
            secure: smtp.config.secure,
            auth: {
              user: smtp.config.user,
              pass: smtp.config.pass,
            },
          });

          await transporter.sendMail({
            from: `SYGMA AIS Institutional Reports <${smtp.config.fromAddress}>`,
            to: schedule.recipientEmail,
            subject: `[SYGMA AIS] Relatório PDF Agendado: ${schedule.name} (${schedule.reportType})`,
            text: [
              'SYGMA BRAZIL ECONOMIC INTELLIGENCE AI — Envio Automático Institucional',
              `Agendamento: ${schedule.name}`,
              `Relatório: ${schedule.reportType}`,
              `Gerado em: ${nowIso}`,
              `Arquivo anexo: ${pdfFilename} (${pdfBuffer.length} bytes)`,
              `Digest SHA-256: ${sha256}`,
            ].join('\n'),
            attachments: [
              {
                filename: pdfFilename,
                content: pdfBuffer,
                contentType: 'application/pdf',
              },
            ],
          });
          emailStatus = 'SENT';
          emailDetail = `Enviado por e-mail para ${schedule.recipientEmail}.`;
        } catch (err) {
          emailStatus = 'FAILED';
          emailDetail = err instanceof Error ? err.message : 'Erro desconhecido ao enviar e-mail SMTP.';
        }
      }
    }

    let status: ScheduledDeliveryRecord['status'] = 'DELIVERED';
    if (schedule.deliveryChannel === 'EMAIL' && emailStatus !== 'SENT') {
      status = 'FAILED';
    } else if (schedule.deliveryChannel === 'BOTH' && emailStatus !== 'SENT') {
      status = 'PARTIAL';
    }

    const messageParts: string[] = [];
    if (systemStatus === 'STORED') {
      messageParts.push(`PDF institucional arquivado no sistema (${pdfBuffer.length.toLocaleString('pt-BR')} bytes).`);
    }
    if (emailDetail) {
      messageParts.push(emailDetail);
    }

    const record: ScheduledDeliveryRecord = {
      id: deliveryId,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      reportType: schedule.reportType,
      deliveryChannel: schedule.deliveryChannel,
      recipientEmail: schedule.recipientEmail,
      executedAt: nowIso,
      triggerMode,
      status,
      emailStatus,
      systemStatus,
      pdfFilename,
      pdfBytes: pdfBuffer.length,
      sha256,
      message: messageParts.join(' '),
      acknowledged: systemStatus !== 'STORED',
    };

    schedule.lastRunAt = nowIso;
    schedule.runCount += 1;
    if (schedule.enabled) {
      schedule.nextRunAt = computeNextRunIso(schedule, nowMs);
    }

    this.state.deliveries.push(record);
    if (this.state.deliveries.length > 200) {
      const removed = this.state.deliveries.splice(0, this.state.deliveries.length - 200);
      for (const old of removed) {
        const oldPath = path.join(this.reportsDir, `${old.id}.pdf`);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch {
            // Ignore cleanup failure
          }
        }
      }
    }
    this.save();

    cryptoService.recordAudit(
      'svc-scheduler',
      triggerMode === 'MANUAL' ? 'USER' : 'SCHEDULER_DAEMON',
      'SCHEDULED_REPORT_DISPATCHED',
      `${schedule.reportType}:${deliveryId}`,
      status === 'FAILED' ? 'ERROR' : 'SUCCESS',
      {
        scheduleId: schedule.id,
        channel: schedule.deliveryChannel,
        emailStatus,
        systemStatus,
        sha256: sha256.slice(0, 16),
      }
    );

    return record;
  }

  public getDeliveryPdfBuffer(deliveryId: string): { record: ScheduledDeliveryRecord; buffer: Buffer } | null {
    const record = this.state.deliveries.find((d) => d.id === deliveryId);
    if (!record) return null;
    const pdfPath = path.join(this.reportsDir, `${deliveryId}.pdf`);
    if (!fs.existsSync(pdfPath)) return null;
    return {
      record,
      buffer: fs.readFileSync(pdfPath),
    };
  }
}

export const schedulerService = new ReportSchedulerService();
