import * as echarts from 'echarts';
import { Download, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface EChartBoxProps {
  title: string;
  subtitle?: string;
  option: echarts.EChartsOption;
  height?: number;
  darkMode?: boolean;
  csvRows?: Array<Record<string, string | number>>;
  csvFilename?: string;
  intelligenceNote?: {
    whatItShows: string;
    sourceAndTime: string;
    limitations?: string;
  };
}

export function EChartBox({
  title,
  subtitle,
  option,
  height = 280,
  darkMode = true,
  csvRows,
  csvFilename = 'sygma_chart_export.csv',
  intelligenceNote,
}: EChartBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const instance = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = instance;

    const ro = new ResizeObserver(() => {
      instance.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, [expanded]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(option, { notMerge: true });
  }, [option, expanded]);

  const handleScreenshot = () => {
    if (!chartRef.current) return;
    const url = chartRef.current.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: darkMode ? '#102438' : '#FFFFFF',
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.png`;
    a.click();
  };

  const handleCsvDownload = () => {
    if (!csvRows || csvRows.length === 0) return;
    const keys = Object.keys(csvRows[0]);
    const csv = [
      keys.join(','),
      ...csvRows.map((row) => keys.map((k) => JSON.stringify(row[k] ?? '')).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const wrapperClass = expanded
    ? 'fixed inset-4 z-50 flex flex-col border border-slate-300 dark:border-[#1E3A54] bg-white dark:bg-[#102438] p-4 shadow-2xl rounded-lg'
    : 'flex flex-col border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] p-4 rounded-lg';

  return (
    <div className={wrapperClass}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] truncate">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-[#8FA6B9] truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {csvRows && csvRows.length > 0 && (
            <button
              type="button"
              onClick={handleCsvDownload}
              title="Exportar CSV"
              className="px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-[#5CD9F5] border border-slate-200 dark:border-[#1E3A54] rounded transition-colors whitespace-nowrap"
            >
              CSV
            </button>
          )}
          <button
            type="button"
            onClick={handleScreenshot}
            title="Exportar PNG"
            className="p-1.5 text-slate-500 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-[#5CD9F5] border border-slate-200 dark:border-[#1E3A54] rounded transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Restaurar' : 'Tela cheia'}
            className="p-1.5 text-slate-500 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-[#5CD9F5] border border-slate-200 dark:border-[#1E3A54] rounded transition-colors"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        style={{ height: expanded ? 'calc(100vh - 180px)' : `${height}px` }}
        className="w-full min-w-0"
      />

      {intelligenceNote && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-200 dark:border-[#1A334B] text-[11px] text-slate-600 dark:text-[#8FA6B9] space-y-0.5">
          <div>
            <span className="font-semibold text-slate-800 dark:text-[#C5D6E5]">Leitura analítica: </span>
            {intelligenceNote.whatItShows}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] font-mono">
            <span>{intelligenceNote.sourceAndTime}</span>
            {intelligenceNote.limitations && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-700 dark:text-[#F0B94A]">{intelligenceNote.limitations}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
