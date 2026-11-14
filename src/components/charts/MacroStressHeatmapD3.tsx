import * as d3 from 'd3';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MacroStressCell,
  MacroStressFactorMeta,
  MacroStressHeatmapReport,
  MacroStressScenarioRow,
} from '../../types/sygma';

export type StressHeatmapDisplayMode = 'SHOCK_PCT' | 'SIGMA' | 'BRL_M';

interface MacroStressHeatmapD3Props {
  report: MacroStressHeatmapReport | null;
  darkMode: boolean;
}

interface HoveredStressCell {
  cell: MacroStressCell;
  scenario: MacroStressScenarioRow;
  factor: MacroStressFactorMeta;
  x: number;
  y: number;
}

function getTextFillForBg(bgColor: string): string {
  const rgb = d3.color(bgColor)?.rgb();
  if (!rgb) return '#F8FAFC';
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum > 0.58 ? '#0B1A2A' : '#F8FAFC';
}

export function MacroStressHeatmapD3({ report, darkMode }: MacroStressHeatmapD3Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const legendRef = useRef<SVGSVGElement | null>(null);

  const [displayMode, setDisplayMode] = useState<StressHeatmapDisplayMode>('SHOCK_PCT');
  const [containerWidth, setContainerWidth] = useState(860);
  const [hovered, setHovered] = useState<HoveredStressCell | null>(null);
  const [selectedScenarioCode, setSelectedScenarioCode] = useState<string>('H');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 160) {
          setContainerWidth(Math.floor(entry.contentRect.width));
        }
      }
    });
    ro.observe(el);
    setContainerWidth(Math.max(360, Math.floor(el.clientWidth || 860)));
    return () => ro.disconnect();
  }, []);

  const selectedScenario = useMemo(
    () => report?.scenarios.find((s) => s.code === selectedScenarioCode) ?? report?.scenarios[0] ?? null,
    [report, selectedScenarioCode]
  );

  // D3 Matrix Render
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !report || report.scenarios.length === 0) return;

    const width = Math.max(700, containerWidth);
    const margin = { top: 52, right: 20, bottom: 18, left: 235 };
    const rowHeight = 36;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = report.scenarios.length * rowHeight;
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
      .domain(report.factors.map((f) => f.id))
      .range([0, innerWidth])
      .padding(0.08);

    const yScale = d3
      .scaleBand<string>()
      .domain(report.scenarios.map((s) => s.code))
      .range([0, innerHeight])
      .padding(0.12);

    const neutralColor = darkMode ? '#1A3046' : '#E2E8F0';
    const interpolator = d3.interpolateRgbBasis(['#B91C2B', '#E45159', neutralColor, '#139A65']);

    const valenceToColor = (valence: number, isPortfolioCol: boolean): string => {
      // Scale smoothly across [-24%, +12%] for individual shocks or [-15%, +8%] for Portfolio Net
      const maxNeg = isPortfolioCol ? -14 : -24;
      const maxPos = isPortfolioCol ? 8 : 12;
      if (valence === 0) return neutralColor;
      if (valence < 0) {
        const ratio = Math.min(1, Math.abs(valence) / Math.abs(maxNeg));
        // Map [0, 1] onto [0.5, 0] of interpolator
        return interpolator(0.5 - ratio * 0.5);
      }
      const ratio = Math.min(1, valence / maxPos);
      return interpolator(0.5 + ratio * 0.5);
    };

    const factorMap = new Map(report.factors.map((f) => [f.id, f]));
    const scenarioMap = new Map(report.scenarios.map((s) => [s.code, s]));

    // Column Headers
    const colHdrs = g
      .selectAll('.stress-col')
      .data(report.factors)
      .enter()
      .append('g')
      .attr('transform', (d) => `translate(${(xScale(d.id) ?? 0) + xScale.bandwidth() / 2}, -8)`);

    colHdrs
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -18)
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', (d) => (d.id === 'PORTFOLIO_NET' ? '#00B4D8' : darkMode ? '#E6EEF5' : '#0F172A'))
      .text((d) => d.code);

    colHdrs
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -4)
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', darkMode ? '#8FA6B9' : '#64748B')
      .text((d) => `Vol 1M: ${d.empiricalMonthlyVolPct.toFixed(1)}%`);

    // Row Labels
    const rowLabels = g
      .selectAll('.stress-row')
      .data(report.scenarios)
      .enter()
      .append('g')
      .attr('transform', (d) => `translate(-10, ${(yScale(d.code) ?? 0) + yScale.bandwidth() / 2})`)
      .style('cursor', 'pointer')
      .on('click', (_ev, d) => setSelectedScenarioCode(d.code));

    rowLabels
      .append('text')
      .attr('text-anchor', 'end')
      .attr('y', 4)
      .attr('font-size', '11px')
      .attr('font-weight', (d) => (d.code === selectedScenarioCode ? '700' : '500'))
      .attr('fill', (d) => (d.code === selectedScenarioCode ? '#00B4D8' : darkMode ? '#E6EEF5' : '#0F172A'))
      .text((d) => `[${d.code}] ${d.namePt.replace(/^Choque [^:]+:\s*/i, '')}`);

    // Cells
    const cellGroups = g
      .selectAll('.stress-cell')
      .data(report.cells, (d: unknown) => {
        const item = d as MacroStressCell;
        return `${item.scenarioCode}:${item.factorId}`;
      })
      .enter()
      .append('g')
      .attr('class', 'stress-cell')
      .attr('transform', (d) => `translate(${xScale(d.factorId) ?? 0}, ${yScale(d.scenarioCode) ?? 0})`)
      .style('cursor', 'pointer');

    cellGroups
      .append('rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', (d) => valenceToColor(d.stressValence, d.factorId === 'PORTFOLIO_NET'))
      .attr('stroke', (d) =>
        d.scenarioCode === selectedScenarioCode
          ? '#00B4D8'
          : d.factorId === 'PORTFOLIO_NET'
          ? 'rgba(0,180,216,0.45)'
          : darkMode
          ? 'rgba(255,255,255,0.06)'
          : 'rgba(15,23,42,0.08)'
      )
      .attr('stroke-width', (d) => (d.scenarioCode === selectedScenarioCode ? 1.5 : 0.8));

    cellGroups
      .append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2 + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', (d) => (d.factorId === 'PORTFOLIO_NET' ? '700' : '600'))
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', (d) => getTextFillForBg(valenceToColor(d.stressValence, d.factorId === 'PORTFOLIO_NET')))
      .text((d) => {
        if (displayMode === 'SIGMA') {
          if (d.sigmaMultiple === 0) return '0,0σ';
          return `${d.sigmaMultiple > 0 ? '+' : ''}${d.sigmaMultiple.toFixed(1)}σ`;
        }
        if (displayMode === 'BRL_M') {
          const m = d.brlImpactPer100M / 1_000_000;
          if (m === 0) return 'R$ 0';
          return `${m > 0 ? '+' : ''}R$ ${m.toFixed(1)}M`;
        }
        if (d.shockPct === 0) return '0,0%';
        return `${d.shockPct > 0 ? '+' : ''}${d.shockPct.toFixed(1)}%`;
      });

    cellGroups
      .on('mouseenter', function (event, d) {
        const scenario = scenarioMap.get(d.scenarioCode);
        const factor = factorMap.get(d.factorId);
        if (!scenario || !factor) return;
        d3.select(this).select('rect').attr('stroke', '#F0B94A').attr('stroke-width', 2);
        const rect = containerRef.current?.getBoundingClientRect();
        setHovered({
          cell: d,
          scenario,
          factor,
          x: rect ? event.clientX - rect.left : 220,
          y: rect ? event.clientY - rect.top : 100,
        });
      })
      .on('mousemove', function (event) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setHovered((prev) =>
          prev ? { ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top } : null
        );
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this)
          .select('rect')
          .attr(
            'stroke',
            d.scenarioCode === selectedScenarioCode
              ? '#00B4D8'
              : d.factorId === 'PORTFOLIO_NET'
              ? 'rgba(0,180,216,0.45)'
              : darkMode
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(15,23,42,0.08)'
          )
          .attr('stroke-width', d.scenarioCode === selectedScenarioCode ? 1.5 : 0.8);
        setHovered(null);
      })
      .on('click', (_ev, d) => setSelectedScenarioCode(d.scenarioCode));
  }, [report, containerWidth, displayMode, darkMode, selectedScenarioCode]);

  // Color Legend
  useEffect(() => {
    const svgEl = legendRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const w = 260;
    const h = 22;
    svg.attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);

    const defs = svg.append('defs');
    const gradId = `sygma-stress-grad-${darkMode ? 'd' : 'l'}`;
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', '0%').attr('x2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#B91C2B');
    grad.append('stop').attr('offset', '50%').attr('stop-color', darkMode ? '#1A3046' : '#E2E8F0');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#139A65');

    svg.append('rect').attr('x', 58).attr('y', 4).attr('width', 144).attr('height', 8).attr('rx', 3).attr('fill', `url(#${gradId})`);
    svg.append('text').attr('x', 54).attr('y', 11).attr('text-anchor', 'end').attr('font-size', '9px').attr('font-family', 'monospace').attr('fill', darkMode ? '#F47A82' : '#B91C1C').text('Estresse');
    svg.append('text').attr('x', 130).attr('y', 20).attr('text-anchor', 'middle').attr('font-size', '9px').attr('font-family', 'monospace').attr('fill', darkMode ? '#8FA6B9' : '#64748B').text('Neutro (0%)');
    svg.append('text').attr('x', 206).attr('y', 11).attr('text-anchor', 'start').attr('font-size', '9px').attr('font-family', 'monospace').attr('fill', darkMode ? '#4CD69F' : '#047857').text('Alívio');
  }, [darkMode]);

  if (!report) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#E45159]">
            <span>MACRO-STRESS HEAT MAP (D3.JS)</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-500 dark:text-[#8FA6B9]">10 CENÁRIOS A–J × 6 PILARES DE RISCO</span>
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
            Mapa de Calor de Estresse Macroeconômico &amp; Transmissão Empírica
          </h3>
          <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
            {report.methodologyNote}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] p-0.5">
            {(
              [
                { id: 'SHOCK_PCT', label: 'Choque (%)' },
                { id: 'SIGMA', label: 'Severidade (σ)' },
                { id: 'BRL_M', label: 'P&L R$ M/100M' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDisplayMode(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                  displayMode === opt.id
                    ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                    : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <svg ref={legendRef} className="shrink-0" />
        </div>
      </div>

      <div ref={containerRef} className="relative w-full overflow-x-auto">
        <svg ref={svgRef} className="min-w-[700px] w-full select-none" />

        {hovered && (
          <div
            style={{
              left: Math.min(Math.max(12, hovered.x + 14), Math.max(160, containerWidth - 265)),
              top: Math.max(8, hovered.y - 24),
            }}
            className="pointer-events-none absolute z-30 w-64 p-2.5 rounded-lg border border-slate-300 dark:border-[#1E3A54] bg-white/95 dark:bg-[#061827]/95 shadow-xl text-[11px] font-mono space-y-1 backdrop-blur-sm"
          >
            <div className="font-bold text-slate-900 dark:text-[#E6EEF5] border-b border-slate-200 dark:border-[#1A334B] pb-1">
              [{hovered.scenario.code}] {hovered.factor.namePt}
            </div>
            <div className="flex justify-between text-slate-600 dark:text-[#8FA6B9]">
              <span>Choque no Fator:</span>
              <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                {hovered.cell.shockPct > 0 ? '+' : ''}
                {hovered.cell.shockPct.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-[#8FA6B9]">
              <span>Severidade Histórica:</span>
              <span className="font-semibold text-[#F0B94A] tabular-nums">
                {hovered.cell.sigmaMultiple > 0 ? '+' : ''}
                {hovered.cell.sigmaMultiple.toFixed(2)}σ (Vol 1M: {hovered.factor.empiricalMonthlyVolPct}%)
              </span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-[#8FA6B9]">
              <span>Contrib. Portfólio:</span>
              <span className="tabular-nums text-slate-900 dark:text-[#E6EEF5]">
                {hovered.cell.pnlContributionPct > 0 ? '+' : ''}
                {hovered.cell.pnlContributionPct.toFixed(2)}% (R${' '}
                {(hovered.cell.brlImpactPer100M / 1_000_000).toFixed(2)}M)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Selected Scenario Transmission Detail Strip */}
      {selectedScenario && (
        <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-1 max-w-3xl">
            <div className="flex items-center gap-2 font-mono">
              <span className="font-bold text-[#00B4D8]">Cenário [{selectedScenario.code}]</span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-semibold ${
                  selectedScenario.severityLabelPt === 'ESTRESSE EXTREMO'
                    ? 'text-[#E45159]'
                    : selectedScenario.severityLabelPt === 'ESTRESSE ELEVADO'
                    ? 'text-[#F0B94A]'
                    : 'text-[#8FA6B9]'
                }`}
              >
                {selectedScenario.severityLabelPt}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-600 dark:text-[#8FA6B9]">
                Canais: {selectedScenario.transmissionChannels.join(' → ')}
              </span>
            </div>
            <div className="text-slate-700 dark:text-[#C5D6E5]">{selectedScenario.shockDescription}</div>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">IMPACTO PORTFÓLIO</div>
            <div
              className={`text-base font-bold ${
                selectedScenario.portfolioImpactPct >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'
              }`}
            >
              {selectedScenario.portfolioImpactPct > 0 ? '+' : ''}
              {selectedScenario.portfolioImpactPct.toFixed(2)}% (R${' '}
              {(selectedScenario.portfolioBrlPer100M / 1_000_000).toFixed(2)}M / 100M)
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}
