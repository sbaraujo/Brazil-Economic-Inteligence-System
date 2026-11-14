import { AreaSeries, CandlestickSeries, ColorType, createChart, LineSeries } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { ObservationPoint } from '../../types/sygma';

interface TradingChartBoxProps {
  title: string;
  subtitle?: string;
  series: ObservationPoint[];
  height?: number;
  darkMode?: boolean;
  onRangeChange?: (range: string) => void;
  activeRange?: string;
}

export function TradingChartBox({
  title,
  subtitle,
  series,
  height = 300,
  darkMode = true,
  onRangeChange,
  activeRange = '1Y',
}: TradingChartBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartType, setChartType] = useState<'AUTO' | 'CANDLE' | 'LINE'>('AUTO');
  const [showSma, setShowSma] = useState(true);

  const hasOhlc = series.some(
    (p) =>
      p.open !== undefined &&
      p.high !== undefined &&
      p.low !== undefined &&
      p.close !== undefined &&
      (p.high !== p.low || p.open !== p.close)
  );

  const effectiveMode = chartType === 'AUTO' ? (hasOhlc ? 'CANDLE' : 'LINE') : chartType;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: darkMode ? '#102438' : '#FFFFFF' },
        textColor: darkMode ? '#8FA6B9' : '#475569',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: darkMode ? 'rgba(143, 166, 185, 0.08)' : 'rgba(15, 23, 42, 0.06)' },
        horzLines: { color: darkMode ? 'rgba(143, 166, 185, 0.08)' : 'rgba(15, 23, 42, 0.06)' },
      },
      rightPriceScale: {
        borderColor: darkMode ? '#1A334B' : '#E2E8F0',
      },
      timeScale: {
        borderColor: darkMode ? '#1A334B' : '#E2E8F0',
        timeVisible: true,
      },
      crosshair: {
        mode: 1,
      },
    });

    // Deduplicate & sort strictly ascending by YYYY-MM-DD for Lightweight Charts
    const uniqueByDate = new Map<string, ObservationPoint>();
    for (const pt of series) {
      uniqueByDate.set(pt.date.slice(0, 10), pt);
    }
    const clean = Array.from(uniqueByDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    if (effectiveMode === 'CANDLE' && hasOhlc) {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#19B779',
        downColor: '#E45159',
        borderVisible: false,
        wickUpColor: '#19B779',
        wickDownColor: '#E45159',
      });
      candleSeries.setData(
        clean.map((p) => ({
          time: p.date.slice(0, 10),
          open: p.open ?? p.value,
          high: p.high ?? p.value,
          low: p.low ?? p.value,
          close: p.close ?? p.value,
        }))
      );
    } else {
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: '#00B4D8',
        topColor: 'rgba(0, 180, 216, 0.28)',
        bottomColor: 'rgba(0, 180, 216, 0.02)',
        lineWidth: 2,
      });
      areaSeries.setData(
        clean.map((p) => ({
          time: p.date.slice(0, 10),
          value: p.value,
        }))
      );
    }

    if (showSma && clean.length >= 20) {
      const smaData: Array<{ time: string; value: number }> = [];
      for (let i = 19; i < clean.length; i++) {
        let sum = 0;
        for (let j = i - 19; j <= i; j++) sum += clean[j].value;
        smaData.push({ time: clean[i].date.slice(0, 10), value: Number((sum / 20).toFixed(4)) });
      }
      const smaLine = chart.addSeries(LineSeries, {
        color: '#F0B94A',
        lineWidth: 1,
        title: 'SMA 20',
      });
      smaLine.setData(smaData);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [series, height, darkMode, effectiveMode, showSma, hasOhlc]);

  const ranges = ['1M', '3M', '6M', '1Y', '3Y', '5Y', 'MAX'];

  return (
    <div className="flex flex-col border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] p-4 rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] truncate">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-[#8FA6B9] truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onRangeChange && (
            <div className="flex items-center bg-slate-100 dark:bg-[#061827] p-0.5 rounded border border-slate-200 dark:border-[#1A334B]">
              {ranges.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onRangeChange(r)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors whitespace-nowrap ${
                    activeRange === r
                      ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                      : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowSma((s) => !s)}
            className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap ${
              showSma
                ? 'border-[#F0B94A]/60 text-[#F0B94A] bg-[#F0B94A]/10'
                : 'border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]'
            }`}
          >
            SMA20
          </button>
          {hasOhlc && (
            <button
              type="button"
              onClick={() => setChartType((m) => (m === 'CANDLE' ? 'LINE' : 'CANDLE'))}
              className="px-2 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-[#1A334B] text-slate-600 dark:text-[#8FA6B9] hover:text-[#5CD9F5] whitespace-nowrap"
            >
              {effectiveMode === 'CANDLE' ? 'OHLC' : 'AREA'}
            </button>
          )}
        </div>
      </div>

      {series.length === 0 ? (
        <div
          style={{ height: `${height}px` }}
          className="flex items-center justify-center text-xs font-mono text-slate-500 dark:text-[#8FA6B9] border border-dashed border-slate-200 dark:border-[#1A334B] rounded"
        >
          Aguardando sincronização de observações reais...
        </div>
      ) : (
        <div ref={containerRef} className="w-full min-w-0" />
      )}
    </div>
  );
}
