import type { DataStatus } from '../../types/sygma';

interface StatusLabelProps {
  status: DataStatus | string;
  compact?: boolean;
}

const STATUS_STYLES: Record<string, { color: string; text: string }> = {
  LIVE: { color: 'text-[#19B779]', text: 'LIVE' },
  DELAYED: { color: 'text-[#F0B94A]', text: 'DELAYED' },
  PERIODIC: { color: 'text-[#5CD9F5]', text: 'PERIODIC' },
  HISTORICAL: { color: 'text-[#8FA6B9]', text: 'HISTORICAL' },
  ESTIMATED: { color: 'text-[#5CD9F5]', text: 'ESTIMATED' },
  FORECAST: { color: 'text-[#00B4D8]', text: 'FORECAST' },
  STALE: { color: 'text-[#F0B94A]', text: 'STALE' },
  MISSING: { color: 'text-[#E45159]', text: 'MISSING' },
  UNVERIFIED: { color: 'text-[#F0B94A]', text: 'UNVERIFIED' },
  NOT_CONFIGURED: { color: 'text-[#8FA6B9]', text: 'NOT CONFIGURED' },
};

export function DataStatusText({ status, compact = false }: StatusLabelProps) {
  const cfg = STATUS_STYLES[status] ?? { color: 'text-[#8FA6B9]', text: status };
  return (
    <span className={`font-mono text-[11px] font-semibold tracking-tight whitespace-nowrap ${cfg.color}`}>
      {compact ? cfg.text : `[${cfg.text}]`}
    </span>
  );
}

export function formatNumberPt(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
