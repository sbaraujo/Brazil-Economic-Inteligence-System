import * as d3 from 'd3';
import { RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  EmergingMarketHeatmapCell,
  EmergingMarketIndicatorMeta,
  EmergingMarketsHeatmapReport,
  Language,
} from '../../types/sygma';
import { formatNumberPt } from '../common/StatusBadge';

export type HeatmapMetricMode = 'RAW' | 'ZSCORE' | 'PERCENTILE';

interface EmergingMarketsHeatmapD3Props {
  report: EmergingMarketsHeatmapReport | null;
  loading: boolean;
  refreshing: boolean;
  selectedYear: string;
  onSelectYear: (year: string) => void;
  onRefresh: () => void;
  onSelectLocalIndicator?: (indicatorId: string) => void;
  language: Language;
  darkMode: boolean;
}

interface HoveredCellState {
  cell: EmergingMarketHeatmapCell;
  countryName: string;
  indicator: EmergingMarketIndicatorMeta;
  x: number;
  y: number;
}

function getContrastTextColor(bgColor: string): string {
  const rgb = d3.color(bgColor)?.rgb();
  if (!rgb) return '#E6EEF5';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.58 ? '#0B1A2A' : '#F8FAFC';
}

export function EmergingMarketsHeatmapD3({
  report,
  loading,
  refreshing,
  selectedYear,
  onSelectYear,
  onRefresh,
  onSelectLocalIndicator,
  language,
  darkMode,
}: EmergingMarketsHeatmapD3Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const legendSvgRef = useRef<SVGSVGElement | null>(null);
  const historySvgRef = useRef<SVGSVGElement | null>(null);

  const [metricMode, setMetricMode] = useState<HeatmapMetricMode>('RAW');
  const [containerWidth, setContainerWidth] = useState<number>(820);
  const [hovered, setHovered] = useState<HoveredCellState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 120) {
          setContainerWidth(Math.floor(entry.contentRect.width));
        }
      }
    });
    ro.observe(el);
    setContainerWidth(Math.max(320, Math.floor(el.clientWidth || 820)));
    return () => ro.disconnect();
  }, []);

  const orderedCountries = useMemo(() => {
    if (!report) return [];
    const rankOrder = new Map<string, number>();
    report.countryRankings.forEach((r, i) => rankOrder.set(r.iso3, r.rank ?? 50 + i));
    return [...report.countries].sort((a, b) => {
      if (a.iso3 === 'BRA') return -1; // Anchor Brazil on row 1 for immediate comparative visibility
      if (b.iso3 === 'BRA') return 1;
      return (rankOrder.get(a.iso3) ?? 99) - (rankOrder.get(b.iso3) ?? 99);
    });
  }, [report]);

  const rankByIso3 = useMemo(() => {
    const m = new Map<string, { rank: number | null; score: number | null }>();
    if (!report) return m;
    for (const r of report.countryRankings) {
      m.set(r.iso3, { rank: r.rank, score: r.compositeScore });
    }
    return m;
  }, [report]);

  // Render D3 Heatmap Matrix
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !report || orderedCountries.length === 0) return;

    const width = Math.max(660, containerWidth);
    const margin = { top: 56, right: 20, bottom: 20, left: 158 };
    const rowHeight = 42;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = orderedCountries.length * rowHeight;
    const totalHeight = margin.top + innerHeight + margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg
      .attr('viewBox', `0 0 ${width} ${totalHeight}`)
      .attr('width', '100%')
      .attr('height', totalHeight);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleBand<string>()
      .domain(report.indicators.map((i) => i.id))
      .range([0, innerWidth])
      .padding(0.08);

    const yScale = d3
      .scaleBand<string>()
      .domain(orderedCountries.map((c) => c.iso3))
      .range([0, innerHeight])
      .padding(0.12);

    const neutralColor = darkMode ? '#1A3046' : '#E2E8F0';
    const missingColor = darkMode ? '#0D1E30' : '#F1F5F9';
    const colorInterpolator = d3.interpolateRgbBasis(['#C93B44', neutralColor, '#139A65']);

    const zToColor = (z: number | null): string => {
      if (z === null || !Number.isFinite(z)) return missingColor;
      const clamped = Math.max(-2.2, Math.min(2.2, z));
      const t = (clamped + 2.2) / 4.4; // 0 => -2.2σ, 0.5 => 0σ, 1 => +2.2σ
      return colorInterpolator(t);
    };

    const indicatorMap = new Map(report.indicators.map((i) => [i.id, i]));
    const countryMap = new Map(report.countries.map((c) => [c.iso3, c]));
    const cellLookup = new Map(report.cells.map((c) => [`${c.iso3}:${c.indicatorId}`, c]));

    // Column Headers (top)
    const colHeaders = g
      .selectAll('.col-header')
      .data(report.indicators)
      .enter()
      .append('g')
      .attr('class', 'col-header')
      .attr('transform', (d) => `translate(${(xScale(d.id) ?? 0) + xScale.bandwidth() / 2}, -10)`);

    colHeaders
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -18)
      .attr('fill', darkMode ? '#E6EEF5' : '#0F172A')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => d.code);

    colHeaders
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -4)
      .attr('fill', darkMode ? '#8FA6B9' : '#64748B')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => `${d.higherIsBetter ? '↑' : '↓'} ${d.unit}`);

    // Row highlight background for Brazil (Row 0)
    const braY = yScale('BRA');
    if (braY !== undefined) {
      g.append('rect')
        .attr('x', -margin.left + 4)
        .attr('y', braY - 3)
        .attr('width', margin.left + innerWidth - 4)
        .attr('height', yScale.bandwidth() + 6)
        .attr('rx', 6)
        .attr('fill', darkMode ? 'rgba(0, 180, 216, 0.08)' : 'rgba(0, 180, 216, 0.07)')
        .attr('stroke', '#00B4D8')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', 'none');
    }

    // Row Labels (left Y-axis with rank & score)
    const rowLabels = g
      .selectAll('.row-label')
      .data(orderedCountries)
      .enter()
      .append('g')
      .attr('class', 'row-label')
      .attr('transform', (d) => `translate(-10, ${(yScale(d.iso3) ?? 0) + yScale.bandwidth() / 2})`);

    rowLabels
      .append('text')
      .attr('text-anchor', 'end')
      .attr('y', -3)
      .attr('fill', (d) => (d.isAnchorBrazil ? '#00B4D8' : darkMode ? '#E6EEF5' : '#0F172A'))
      .attr('font-size', '11.5px')
      .attr('font-weight', (d) => (d.isAnchorBrazil ? '700' : '600'))
      .text((d) => {
        const rk = rankByIso3.get(d.iso3)?.rank;
        const name = language === 'pt' ? d.namePt : d.nameEn;
        return `${rk ? `#${rk} ` : ''}${d.iso3} · ${name}`;
      });

    rowLabels
      .append('text')
      .attr('text-anchor', 'end')
      .attr('y', 11)
      .attr('fill', darkMode ? '#8FA6B9' : '#64748B')
      .attr('font-size', '9.5px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => {
        const sc = rankByIso3.get(d.iso3)?.score;
        return sc !== null && sc !== undefined ? `Score ${sc.toFixed(1)}/100` : d.regionPt;
      });

    // Cells
    const cellData: EmergingMarketHeatmapCell[] = [];
    for (const c of orderedCountries) {
      for (const ind of report.indicators) {
        const found = cellLookup.get(`${c.iso3}:${ind.id}`);
        if (found) cellData.push(found);
      }
    }

    const cellGroups = g
      .selectAll('.hm-cell')
      .data(cellData, (d: unknown) => {
        const item = d as EmergingMarketHeatmapCell;
        return `${item.iso3}:${item.indicatorId}`;
      })
      .enter()
      .append('g')
      .attr('class', 'hm-cell')
      .attr('transform', (d) => `translate(${xScale(d.indicatorId) ?? 0}, ${yScale(d.iso3) ?? 0})`)
      .style('cursor', (d) => {
        const meta = indicatorMap.get(d.indicatorId);
        return d.iso3 === 'BRA' && meta?.linkedLocalIndicatorId && onSelectLocalIndicator ? 'pointer' : 'default';
      });

    cellGroups
      .append('rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', (d) => zToColor(d.relativeZScore))
      .attr('stroke', (d) =>
        d.iso3 === 'BRA'
          ? 'rgba(0, 180, 216, 0.55)'
          : darkMode
          ? 'rgba(255,255,255,0.06)'
          : 'rgba(15,23,42,0.08)'
      )
      .attr('stroke-width', (d) => (d.iso3 === 'BRA' ? 1.2 : 0.8))
      .attr('opacity', 0)
      .transition()
      .duration(260)
      .delay((_, idx) => Math.min(idx * 4, 180))
      .attr('opacity', 1);

    cellGroups
      .append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2 + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', (d) => (d.iso3 === 'BRA' ? '700' : '600'))
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', (d) => {
        if (d.value === null) return darkMode ? '#64748B' : '#94A3B8';
        return getContrastTextColor(zToColor(d.relativeZScore));
      })
      .text((d) => {
        if (d.value === null) return 'N/D';
        if (metricMode === 'ZSCORE') {
          if (d.relativeZScore === null) return 'N/D';
          return `${d.relativeZScore > 0 ? '+' : ''}${d.relativeZScore.toFixed(2)}σ`;
        }
        if (metricMode === 'PERCENTILE') {
          if (d.percentileRank === null) return 'N/D';
          return `${Math.round(d.percentileRank)}%`;
        }
        const ind = indicatorMap.get(d.indicatorId);
        const prefix = ind?.category === 'MARKET' && d.value > 0 ? '+' : '';
        return `${prefix}${d.value.toFixed(Math.abs(d.value) >= 100 ? 0 : 1)}%`;
      });

    // Interactions
    cellGroups
      .on('mouseenter', function (event, d) {
        const ind = indicatorMap.get(d.indicatorId);
        const country = countryMap.get(d.iso3);
        if (!ind || !country) return;
        d3.select(this)
          .select('rect')
          .attr('stroke', '#F0B94A')
          .attr('stroke-width', 2);

        const rect = containerRef.current?.getBoundingClientRect();
        const x = rect ? event.clientX - rect.left : 200;
        const y = rect ? event.clientY - rect.top : 100;
        setHovered({
          cell: d,
          countryName: language === 'pt' ? country.namePt : country.nameEn,
          indicator: ind,
          x,
          y,
        });
      })
      .on('mousemove', function (event) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setHovered((prev) =>
          prev
            ? {
                ...prev,
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              }
            : null
        );
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this)
          .select('rect')
          .attr(
            'stroke',
            d.iso3 === 'BRA'
              ? 'rgba(0, 180, 216, 0.55)'
              : darkMode
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(15,23,42,0.08)'
          )
          .attr('stroke-width', d.iso3 === 'BRA' ? 1.2 : 0.8);
        setHovered(null);
      })
      .on('click', (_event, d) => {
        const ind = indicatorMap.get(d.indicatorId);
        if (d.iso3 === 'BRA' && ind?.linkedLocalIndicatorId && onSelectLocalIndicator) {
          onSelectLocalIndicator(ind.linkedLocalIndicatorId);
        }
      });
  }, [report, orderedCountries, rankByIso3, containerWidth, metricMode, darkMode, language, onSelectLocalIndicator]);

  // Render D3 Gradient Color Legend
  useEffect(() => {
    const svgEl = legendSvgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const w = 260;
    const h = 24;
    svg.attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);

    const defs = svg.append('defs');
    const gradId = `sygma-em-grad-${darkMode ? 'd' : 'l'}`;
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', '0%').attr('x2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#C93B44');
    grad.append('stop').attr('offset', '50%').attr('stop-color', darkMode ? '#1A3046' : '#E2E8F0');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#139A65');

    svg
      .append('rect')
      .attr('x', 54)
      .attr('y', 4)
      .attr('width', 152)
      .attr('height', 8)
      .attr('rx', 3)
      .attr('fill', `url(#${gradId})`);

    svg
      .append('text')
      .attr('x', 50)
      .attr('y', 11)
      .attr('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', darkMode ? '#F47A82' : '#B91C1C')
      .text('-2,2σ');

    svg
      .append('text')
      .attr('x', 130)
      .attr('y', 22)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', darkMode ? '#8FA6B9' : '#64748B')
      .text('Média EM (0σ)');

    svg
      .append('text')
      .attr('x', 210)
      .attr('y', 11)
      .attr('text-anchor', 'start')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', darkMode ? '#4CD69F' : '#047857')
      .text('+2,2σ');
  }, [darkMode]);

  // Render D3 Historical Brazil vs EM Score Trajectory Sparkline
  useEffect(() => {
    const svgEl = historySvgRef.current;
    const series = report?.brazilSummary.historicalBrazilScoreSeries ?? [];
    if (!svgEl || series.length === 0) return;

    const w = 440;
    const h = 82;
    const m = { top: 10, right: 16, bottom: 20, left: 30 };
    const iw = w - m.left - m.right;
    const ih = h - m.top - m.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('height', h);

    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    const x = d3
      .scalePoint<string>()
      .domain(series.map((d) => d.year))
      .range([0, iw])
      .padding(0.2);

    const y = d3.scaleLinear().domain([15, 85]).range([ih, 0]).clamp(true);

    // 50 neutral line
    g.append('line')
      .attr('x1', 0)
      .attr('x2', iw)
      .attr('y1', y(50))
      .attr('y2', y(50))
      .attr('stroke', darkMode ? '#1E3A54' : '#CBD5E1')
      .attr('stroke-dasharray', '3,3');

    g.append('text')
      .attr('x', -4)
      .attr('y', y(50) + 3)
      .attr('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', darkMode ? '#8FA6B9' : '#64748B')
      .text('50');

    const lineBra = d3
      .line<{ year: string; brazilScore: number | null }>()
      .defined((d) => d.brazilScore !== null)
      .x((d) => x(d.year) ?? 0)
      .y((d) => y(d.brazilScore ?? 50))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#00B4D8')
      .attr('stroke-width', 2)
      .attr('d', lineBra);

    // Points & X-axis labels
    const pts = g.selectAll('.yr-pt').data(series).enter().append('g').attr('class', 'yr-pt');

    pts
      .filter((d) => d.brazilScore !== null)
      .append('circle')
      .attr('cx', (d) => x(d.year) ?? 0)
      .attr('cy', (d) => y(d.brazilScore ?? 50))
      .attr('r', (d) => (d.year === selectedYear ? 4.5 : 2.8))
      .attr('fill', (d) => (d.year === selectedYear ? '#F0B94A' : '#00B4D8'));

    pts
      .append('text')
      .attr('x', (d) => x(d.year) ?? 0)
      .attr('y', ih + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('font-weight', (d) => (d.year === selectedYear ? '700' : '400'))
      .attr('fill', (d) => (d.year === selectedYear ? '#00B4D8' : darkMode ? '#8FA6B9' : '#64748B'))
      .text((d) => d.year.slice(-2));
  }, [report, selectedYear, darkMode]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] rounded-lg p-4 space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">
            <span className="font-semibold text-[#00B4D8]">D3.JS EMERGING MARKETS MATRIX</span>
            <span aria-hidden="true">·</span>
            <span>FMI WEO + YAHOO FINANCE</span>
            <span aria-hidden="true">·</span>
            <span className={report?.dataStatus === 'DEGRADED' ? 'text-[#F0B94A]' : 'text-[#19B779]'}>
              {report?.dataStatus ?? 'CARREGANDO'}
            </span>
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
            {language === 'pt'
              ? 'Heat-Map Relativo Global: Brasil vs Mercados Emergentes'
              : 'Global Relative Heat-Map: Brazil vs Emerging Markets'}
          </h2>
          <p className="text-xs text-slate-600 dark:text-[#8FA6B9]">
            {language === 'pt'
              ? 'Comparação cross-sectional entre 8 economias emergentes com polaridade ajustada (inflação, desemprego e dívida menores pontuam positivamente).'
              : 'Cross-sectional comparison across 8 emerging markets with polarity-adjusted Z-scores.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Display Mode */}
          <div className="inline-flex rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] p-0.5">
            {(
              [
                { id: 'RAW', label: 'Valores' },
                { id: 'ZSCORE', label: 'Z-Score σ' },
                { id: 'PERCENTILE', label: 'Percentil' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMetricMode(opt.id)}
                className={`px-2 py-1 text-[11px] font-mono rounded transition-colors ${
                  metricMode === opt.id
                    ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                    : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-[#1A334B] text-slate-700 dark:text-[#E6EEF5] hover:border-[#00B4D8] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Sincronizando...' : 'Atualizar FMI/EM'}</span>
          </button>
        </div>
      </div>

      {/* Brazil Executive Summary Strip + Historical Score Trajectory */}
      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
            <div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">POSICIONAMENTO BRASIL</div>
              <div className="text-lg font-bold text-[#00B4D8]">
                {report.brazilSummary.rank !== null
                  ? `#${report.brazilSummary.rank} / ${report.brazilSummary.totalCountries}`
                  : 'N/D'}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                Janela: {selectedYear === 'LATEST' ? 'Atual (12M/WEO)' : `Ano ${selectedYear}`}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">SCORE COMPOSTO EM</div>
              <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">
                {report.brazilSummary.compositeScore !== null
                  ? `${report.brazilSummary.compositeScore.toFixed(1)}/100`
                  : 'N/D'}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">50 = média da cesta EM</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">DESTAQUE POSITIVO</div>
              <div className="text-xs font-semibold text-[#19B779] mt-1">
                {report.brazilSummary.strongestIndicatorPt ?? 'N/D'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">MAIOR PRESSÃO RELATIVA</div>
              <div className="text-xs font-semibold text-[#E45159] mt-1">
                {report.brazilSummary.weakestIndicatorPt ?? 'N/D'}
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-[#1A334B] pt-2 lg:pt-0 lg:pl-3">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-[#8FA6B9]">
              <span>TRAJETÓRIA SCORE BRASIL (2016–{report.availableYears[0] ?? '25'})</span>
              <span className="text-[#00B4D8]">Linha base EM = 50</span>
            </div>
            <svg ref={historySvgRef} className="w-full h-[82px]" />
          </div>
        </div>
      )}

      {/* Historical Backtest Period / Year Scrubber + Color Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9] mr-1">
            Replay Histórico:
          </span>
          <button
            type="button"
            onClick={() => onSelectYear('LATEST')}
            className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors ${
              selectedYear === 'LATEST'
                ? 'bg-[#00B4D8] text-[#061827] border-[#00B4D8] font-semibold'
                : 'border-slate-200 dark:border-[#1A334B] text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Atual (12M)
          </button>
          {(report?.availableYears ?? []).slice(0, 10).map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => onSelectYear(yr)}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors ${
                selectedYear === yr
                  ? 'bg-[#00B4D8] text-[#061827] border-[#00B4D8] font-semibold'
                  : 'border-slate-200 dark:border-[#1A334B] text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {yr}
            </button>
          ))}
        </div>

        <svg ref={legendSvgRef} className="shrink-0" />
      </div>

      {/* D3 Matrix Container */}
      <div ref={containerRef} className="relative w-full overflow-x-auto">
        {loading && !report ? (
          <div className="h-64 flex items-center justify-center text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
            Sincronizando série histórica de mercados emergentes (FMI WEO + Yahoo Finance)...
          </div>
        ) : (
          <svg ref={svgRef} className="min-w-[660px] w-full select-none" />
        )}

        {/* Interactive D3 Hover Tooltip */}
        {hovered && (
          <div
            style={{
              left: Math.min(Math.max(12, hovered.x + 14), Math.max(140, containerWidth - 260)),
              top: Math.max(8, hovered.y - 18),
            }}
            className="pointer-events-none absolute z-30 w-60 p-2.5 rounded-lg border border-slate-300 dark:border-[#1E3A54] bg-white/95 dark:bg-[#061827]/95 shadow-xl text-[11px] font-mono space-y-1 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-[#1A334B] pb-1">
              <span className="font-bold text-slate-900 dark:text-[#E6EEF5]">
                {hovered.countryName} ({hovered.cell.iso3})
              </span>
              <span className="text-[#00B4D8]">Ref. {hovered.cell.referenceYear}</span>
            </div>
            <div className="font-semibold text-slate-800 dark:text-[#C5D6E5]">
              {hovered.indicator.namePt}
            </div>
            <div className="flex justify-between text-slate-600 dark:text-[#8FA6B9]">
              <span>Valor:</span>
              <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                {hovered.cell.value !== null
                  ? `${formatNumberPt(hovered.cell.value, 2)} ${hovered.indicator.unit}`
                  : 'N/D'}
              </span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-[#8FA6B9]">
              <span>Média EM (cesta):</span>
              <span className="tabular-nums">
                {hovered.cell.peerMean !== null
                  ? `${formatNumberPt(hovered.cell.peerMean, 2)} ${hovered.indicator.unit}`
                  : 'N/D'}
              </span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-[#8FA6B9]">
              <span>Z-Score Relativo:</span>
              <span
                className={`font-semibold tabular-nums ${
                  (hovered.cell.relativeZScore ?? 0) > 0
                    ? 'text-[#19B779]'
                    : (hovered.cell.relativeZScore ?? 0) < 0
                    ? 'text-[#E45159]'
                    : 'text-[#8FA6B9]'
                }`}
              >
                {hovered.cell.relativeZScore !== null
                  ? `${hovered.cell.relativeZScore > 0 ? '+' : ''}${hovered.cell.relativeZScore.toFixed(2)}σ`
                  : 'N/D'}
              </span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-[#8FA6B9]">
              <span>Ranking / Percentil:</span>
              <span className="tabular-nums text-slate-900 dark:text-[#E6EEF5]">
                {hovered.cell.rank !== null
                  ? `#${hovered.cell.rank}/${hovered.cell.peerCount} (${hovered.cell.percentileRank}%)`
                  : 'N/D'}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9] pt-1 border-t border-slate-200 dark:border-[#1A334B]">
              Fonte: {hovered.cell.source} · {hovered.indicator.higherIsBetter ? 'Maior = melhor' : 'Menor = melhor'}
            </div>
          </div>
        )}
      </div>

      {/* Sources & Methodology Footer */}
      {report && (
        <div className="pt-2 border-t border-slate-200 dark:border-[#1A334B] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-[#8FA6B9]">
          <span className="font-mono">
            Fontes: {report.sources.join(' · ')}
            {report.lastSyncedAt
              ? ` · Sync: ${new Date(report.lastSyncedAt).toLocaleString('pt-BR')}`
              : ''}
          </span>
          {onSelectLocalIndicator && (
            <span className="text-[#00B4D8]">
              Dica: clique em qualquer célula da linha Brasil para abrir a série doméstica no explorador.
            </span>
          )}
        </div>
      )}
    </motion.section>
  );
}
