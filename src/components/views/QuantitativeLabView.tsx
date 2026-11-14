import type * as echarts from 'echarts';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type {
  BrazilPulseReport,
  CrossIndicatorReport,
  ForecastReport,
  IndicatorSnapshot,
  MacroStressHeatmapReport,
  RiskReport,
} from '../../types/sygma';
import { EChartBox } from '../charts/EChartBox';
import { MacroStressHeatmapD3 } from '../charts/MacroStressHeatmapD3';
import { DataStatusText, formatNumberPt } from '../common/StatusBadge';

interface QuantitativeLabViewProps {
  activeTab: 'CORRELATION' | 'FORECAST' | 'RISK' | 'PULSE';
  onTabChange: (tab: 'CORRELATION' | 'FORECAST' | 'RISK' | 'PULSE') => void;
  snapshots: IndicatorSnapshot[];
  pulse: BrazilPulseReport | null;
  risk: RiskReport | null;
  darkMode: boolean;
}

const INSTITUTIONAL_EASE = [0.16, 1, 0.3, 1] as const;

const panelVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: INSTITUTIONAL_EASE },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.14, ease: INSTITUTIONAL_EASE },
  },
};

const gridContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
};

const widgetItemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: INSTITUTIONAL_EASE },
  },
};

export function QuantitativeLabView({
  activeTab,
  onTabChange,
  snapshots,
  pulse,
  risk,
  darkMode,
}: QuantitativeLabViewProps) {
  // Correlation state
  const [xId, setXId] = useState('SELIC_META');
  const [yId, setYId] = useState('IPCA_MENSAL');
  const [freq, setFreq] = useState<'MONTHLY' | 'DAILY'>('MONTHLY');
  const [corrReport, setCorrReport] = useState<CrossIndicatorReport | null>(null);
  const [matrixData, setMatrixData] = useState<{
    indicatorIds: string[];
    matrix: Array<{ x: string; y: string; r: number; n: number }>;
  } | null>(null);

  // Forecast state
  const [forecastId, setForecastId] = useState('USD_BRL_PTAX');
  const [forecastSteps, setForecastSteps] = useState(12);
  const [forecast, setForecast] = useState<ForecastReport | null>(null);

  // Risk state
  const [mcSeed, setMcSeed] = useState(20261113);
  const [mcSims, setMcSims] = useState(10000);
  const [customRisk, setCustomRisk] = useState<RiskReport | null>(risk);
  const [stressHeatmap, setStressHeatmap] = useState<MacroStressHeatmapReport | null>(null);

  useEffect(() => {
    setCustomRisk(risk);
  }, [risk]);

  useEffect(() => {
    if (activeTab !== 'RISK') return;
    sygmaClient
      .fetchJson<MacroStressHeatmapReport>('/api/v1/quant/stress-heatmap')
      .then(setStressHeatmap)
      .catch(() => {});
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'CORRELATION') return;
    sygmaClient
      .fetchJson<CrossIndicatorReport>(`/api/v1/quant/correlation?x=${xId}&y=${yId}&freq=${freq}`)
      .then(setCorrReport)
      .catch(() => {});
    sygmaClient
      .fetchJson<{ indicatorIds: string[]; matrix: Array<{ x: string; y: string; r: number; n: number }> }>(
        `/api/v1/quant/matrix?freq=${freq}`
      )
      .then(setMatrixData)
      .catch(() => {});
  }, [activeTab, xId, yId, freq]);

  useEffect(() => {
    if (activeTab !== 'FORECAST') return;
    sygmaClient
      .fetchJson<ForecastReport>(`/api/v1/quant/forecast/${forecastId}?steps=${forecastSteps}`)
      .then(setForecast)
      .catch(() => {});
  }, [activeTab, forecastId, forecastSteps]);

  const handleRecomputeRisk = () => {
    sygmaClient
      .fetchJson<RiskReport>(`/api/v1/quant/risk?seed=${mcSeed}&simulations=${mcSims}`)
      .then(setCustomRisk)
      .catch(() => {});
    sygmaClient
      .fetchJson<MacroStressHeatmapReport>('/api/v1/quant/stress-heatmap')
      .then(setStressHeatmap)
      .catch(() => {});
  };

  // ECharts Options
  const scatterOption = useMemo<echarts.EChartsOption>(() => {
    if (!corrReport) return {};
    const pts = corrReport.scatterPoints.map((p) => [p.x, p.y]);
    const xs = corrReport.scatterPoints.map((p) => p.x);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 1;
    const regLine = [
      [minX, corrReport.olsIntercept + corrReport.olsSlope * minX],
      [maxX, corrReport.olsIntercept + corrReport.olsSlope * maxX],
    ];
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      grid: { left: 48, right: 20, top: 24, bottom: 32 },
      xAxis: {
        type: 'value',
        name: corrReport.xId,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
        splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
      },
      yAxis: {
        type: 'value',
        name: corrReport.yId,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
        splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
      },
      series: [
        { type: 'scatter', data: pts, symbolSize: 6, itemStyle: { color: '#00B4D8', opacity: 0.75 } },
        { type: 'line', data: regLine, showSymbol: false, lineStyle: { color: '#F0B94A', width: 2 } },
      ],
    };
  }, [corrReport, darkMode]);

  const heatmapOption = useMemo<echarts.EChartsOption>(() => {
    if (!matrixData) return {};
    const ids = matrixData.indicatorIds;
    const data = matrixData.matrix.map((m) => [ids.indexOf(m.x), ids.indexOf(m.y), m.r]);
    return {
      backgroundColor: 'transparent',
      tooltip: { position: 'top' },
      grid: { left: 95, right: 20, top: 15, bottom: 65 },
      xAxis: {
        type: 'category',
        data: ids.map((i) => i.replace('_PTAX', '').replace('_MENSAL', '')),
        axisLabel: { rotate: 35, color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 9 },
      },
      yAxis: {
        type: 'category',
        data: ids.map((i) => i.replace('_PTAX', '').replace('_MENSAL', '')),
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 9 },
      },
      visualMap: {
        min: -1,
        max: 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        textStyle: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 10 },
        inRange: { color: ['#E45159', '#102438', '#19B779'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: true, fontSize: 9, color: '#E6EEF5' },
        },
      ],
    };
  }, [matrixData, darkMode]);

  const forecastOption = useMemo<echarts.EChartsOption>(() => {
    if (!forecast) return {};
    const histDates = forecast.historyTail.map((h) => h.date);
    const futDates = forecast.horizonPoints.map((f) => f.date);
    const allDates = [...histDates, ...futDates];
    const pad = new Array(Math.max(0, histDates.length - 1)).fill(null);
    const lastHist = forecast.historyTail[forecast.historyTail.length - 1]?.value ?? null;

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['Histórico', 'Cenário Central', 'Otimista', 'Adverso', 'Estresse Severo', 'IC 90% Sup.', 'IC 90% Inf.'],
        textStyle: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 10 },
        top: 0,
      },
      grid: { left: 48, right: 20, top: 38, bottom: 26 },
      xAxis: {
        type: 'category',
        data: allDates,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
        splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
      },
      series: [
        {
          name: 'Histórico',
          type: 'line',
          data: [...forecast.historyTail.map((h) => h.value), ...new Array(futDates.length).fill(null)],
          itemStyle: { color: '#E6EEF5' },
        },
        {
          name: 'Cenário Central',
          type: 'line',
          data: [...pad, lastHist, ...forecast.horizonPoints.map((f) => f.central)],
          itemStyle: { color: '#00B4D8' },
          lineStyle: { width: 2, type: 'dashed' },
        },
        {
          name: 'Otimista',
          type: 'line',
          data: [...pad, lastHist, ...forecast.horizonPoints.map((f) => f.optimistic)],
          itemStyle: { color: '#19B779' },
          lineStyle: { width: 1.5, type: 'dotted' },
        },
        {
          name: 'Adverso',
          type: 'line',
          data: [...pad, lastHist, ...forecast.horizonPoints.map((f) => f.adverse)],
          itemStyle: { color: '#F0B94A' },
          lineStyle: { width: 1.5, type: 'dotted' },
        },
        {
          name: 'Estresse Severo',
          type: 'line',
          data: [...pad, lastHist, ...forecast.horizonPoints.map((f) => f.severeStress)],
          itemStyle: { color: '#E45159' },
          lineStyle: { width: 1.5, type: 'dotted' },
        },
        {
          name: 'IC 90% Sup.',
          type: 'line',
          showSymbol: false,
          data: [...pad, lastHist, ...forecast.horizonPoints.map((f) => f.upper90)],
          itemStyle: { color: '#8FA6B9' },
          lineStyle: { width: 1, type: 'dashed', opacity: 0.6 },
        },
        {
          name: 'IC 90% Inf.',
          type: 'line',
          showSymbol: false,
          data: [...pad, lastHist, ...forecast.horizonPoints.map((f) => f.lower90)],
          itemStyle: { color: '#8FA6B9' },
          lineStyle: { width: 1, type: 'dashed', opacity: 0.6 },
        },
      ],
    };
  }, [forecast, darkMode]);

  const mcHistOption = useMemo<echarts.EChartsOption>(() => {
    if (!customRisk) return {};
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      grid: { left: 45, right: 16, top: 24, bottom: 32 },
      xAxis: {
        type: 'category',
        data: customRisk.monteCarloHistogram.map((b) => b.binLabel),
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 9, rotate: 30 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
        splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
      },
      series: [
        {
          name: 'Caminhos Monte Carlo',
          type: 'bar',
          data: customRisk.monteCarloHistogram.map((b) => ({
            value: b.count,
            itemStyle: { color: b.isTail95 ? '#E45159' : '#00B4D8' },
          })),
        },
      ],
    };
  }, [customRisk, darkMode]);

  const pulseRadarOption = useMemo<echarts.EChartsOption>(() => {
    if (!pulse) return {};
    return {
      backgroundColor: 'transparent',
      tooltip: {},
      radar: {
        indicator: pulse.dimensions.map((d) => ({ name: d.namePt.split(' (')[0], max: 100 })),
        axisName: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 10 },
        splitLine: { lineStyle: { color: darkMode ? '#1A334B' : '#CBD5E1' } },
        splitArea: { areaStyle: { color: ['transparent'] } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: pulse.dimensions.map((d) => d.score),
              name: 'Brazil Economic Pulse',
              areaStyle: { color: 'rgba(0, 180, 216, 0.25)' },
              lineStyle: { color: '#00B4D8', width: 2 },
              itemStyle: { color: '#5CD9F5' },
            },
          ],
        },
      ],
    };
  }, [pulse, darkMode]);

  return (
    <div className="space-y-4">
      {/* Segmented Navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-[#061827] border border-slate-200 dark:border-[#1A334B] rounded-lg w-fit">
        {[
          { id: 'CORRELATION', label: 'Correlação & Granger' },
          { id: 'FORECAST', label: 'Previsões Econométricas' },
          { id: 'RISK', label: 'Risco Quantitativo & Stress (A–J)' },
          { id: 'PULSE', label: 'Brazil Economic Pulse (10D)' },
        ].map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id as 'CORRELATION' | 'FORECAST' | 'RISK' | 'PULSE')}
              className={`relative px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                isActive
                  ? 'text-[#061827] font-semibold'
                  : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="quant-lab-active-tab"
                  transition={{ duration: 0.2, ease: INSTITUTIONAL_EASE }}
                  className="absolute inset-0 bg-[#00B4D8] rounded"
                  aria-hidden="true"
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* TAB 1: CORRELATION & GRANGER CAUSALITY */}
        {activeTab === 'CORRELATION' && (
          <motion.div
            key="CORRELATION"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="space-y-4"
          >
            <motion.div
              variants={widgetItemVariants}
              initial="hidden"
              animate="visible"
              className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-wrap items-end gap-3"
            >
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9] mb-1">
                  Variável X (Explicativa)
                </label>
                <select
                  value={xId}
                  onChange={(e) => setXId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                >
                  {snapshots.map((s) => (
                    <option key={s.definition.id} value={s.definition.id}>
                      {s.definition.code} — {s.definition.namePt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9] mb-1">
                  Variável Y (Resposta)
                </label>
                <select
                  value={yId}
                  onChange={(e) => setYId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                >
                  {snapshots.map((s) => (
                    <option key={s.definition.id} value={s.definition.id}>
                      {s.definition.code} — {s.definition.namePt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9] mb-1">
                  Frequência de Alinhamento
                </label>
                <select
                  value={freq}
                  onChange={(e) => setFreq(e.target.value as 'MONTHLY' | 'DAILY')}
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                >
                  <option value="MONTHLY">Mensal (Macro + Mercado)</option>
                  <option value="DAILY">Diária (Séries Diárias)</option>
                </select>
              </div>
            </motion.div>

            {corrReport && (
              <>
                <motion.div
                  key={`corr-kpis-${xId}-${yId}-${freq}`}
                  variants={gridContainerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 font-mono tabular-nums"
                >
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Pearson r</div>
                    <div className="text-lg font-bold text-[#00B4D8]">{corrReport.pearsonR}</div>
                    <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">p = {corrReport.pearsonPValue}</div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Spearman ρ</div>
                    <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">{corrReport.spearmanRho}</div>
                    <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">N = {corrReport.observations}</div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">OLS R² / Beta</div>
                    <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">{corrReport.rSquared}</div>
                    <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">β = {corrReport.olsSlope}</div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Durbin-Watson</div>
                    <div className="text-lg font-bold text-[#F0B94A]">{corrReport.durbinWatson}</div>
                    <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                      {corrReport.sampleStart} → {corrReport.sampleEnd}
                    </div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Granger X → Y</div>
                    <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">
                      F = {corrReport.grangerXtoY.fStat}
                    </div>
                    <div className="text-[10px] text-[#5CD9F5]">
                      {corrReport.grangerXtoY.significantAt5Pct ? 'Significativo (5%)' : 'Não sig. (5%)'}
                    </div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Granger Y → X</div>
                    <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">
                      F = {corrReport.grangerYtoX.fStat}
                    </div>
                    <div className="text-[10px] text-[#5CD9F5]">
                      {corrReport.grangerYtoX.significantAt5Pct ? 'Significativo (5%)' : 'Não sig. (5%)'}
                    </div>
                  </motion.div>
                </motion.div>

                <motion.div
                  variants={gridContainerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid grid-cols-1 lg:grid-cols-2 gap-4"
                >
                  <motion.div variants={widgetItemVariants}>
                    <EChartBox
                      title={`Regressão OLS & Dispersão: ${xId} vs ${yId}`}
                      subtitle={corrReport.interpretation}
                      option={scatterOption}
                      height={300}
                      darkMode={darkMode}
                      intelligenceNote={{
                        whatItShows: corrReport.limitations.join(' '),
                        sourceAndTime: `Amostra alinhada: ${corrReport.sampleStart} a ${corrReport.sampleEnd} (N=${corrReport.observations})`,
                      }}
                    />
                  </motion.div>
                  <motion.div variants={widgetItemVariants}>
                    <EChartBox
                      title="Matriz de Correlação Multivariada (Pearson)"
                      subtitle="Câmbio, Selic, IPCA, IBOV, Brent, Vale, Dívida Pública e IBC-Br"
                      option={heatmapOption}
                      height={300}
                      darkMode={darkMode}
                    />
                  </motion.div>
                </motion.div>
              </>
            )}
          </motion.div>
        )}

        {/* TAB 2: ECONOMETRIC FORECASTS */}
        {activeTab === 'FORECAST' && (
          <motion.div
            key="FORECAST"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="space-y-4"
          >
            <motion.div
              variants={widgetItemVariants}
              initial="hidden"
              animate="visible"
              className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-wrap items-end gap-3"
            >
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9] mb-1">
                  Série Alvo da Projeção
                </label>
                <select
                  value={forecastId}
                  onChange={(e) => setForecastId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                >
                  {snapshots.map((s) => (
                    <option key={s.definition.id} value={s.definition.id}>
                      {s.definition.code} — {s.definition.namePt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9] mb-1">
                  Horizonte (Passos)
                </label>
                <select
                  value={forecastSteps}
                  onChange={(e) => setForecastSteps(Number(e.target.value))}
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                >
                  <option value={6}>6 passos</option>
                  <option value={12}>12 passos</option>
                  <option value={24}>24 passos</option>
                </select>
              </div>
            </motion.div>

            {forecast && (
              <>
                <motion.div
                  key={`forecast-kpis-${forecast.indicatorId}-${forecastSteps}`}
                  variants={gridContainerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono tabular-nums"
                >
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">MAE (Walk-Forward)</div>
                    <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">{forecast.validation.mae}</div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">RMSE</div>
                    <div className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">{forecast.validation.rmse}</div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">MASE</div>
                    <div className="text-lg font-bold text-[#00B4D8]">{forecast.validation.mase}</div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Acurácia Direcional</div>
                    <div className="text-lg font-bold text-[#19B779]">{forecast.validation.directionalAccuracyPct}%</div>
                  </motion.div>
                  <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Cobertura IC 90%</div>
                    <div className="text-lg font-bold text-[#F0B94A]">{forecast.validation.intervalCoverage90Pct}%</div>
                  </motion.div>
                </motion.div>

                <motion.div
                  key={`forecast-chart-${forecast.indicatorId}-${forecastSteps}`}
                  variants={widgetItemVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <EChartBox
                    title={`${forecast.indicatorName} — Fan Chart (${forecast.modelName})`}
                    subtitle={`${forecast.validation.method} · Persistência GARCH(1,1) = ${forecast.garchParams.persistence}`}
                    option={forecastOption}
                    height={330}
                    darkMode={darkMode}
                    csvRows={forecast.horizonPoints}
                    csvFilename={`forecast_${forecast.indicatorId}.csv`}
                    intelligenceNote={{
                      whatItShows: forecast.limitations.join(' '),
                      sourceAndTime: `Modelo ${forecast.modelVersion} · Treinado em ${forecast.trainedAt.slice(0, 19)} (${forecast.observationsUsed} obs.)`,
                    }}
                  />
                </motion.div>
              </>
            )}
          </motion.div>
        )}

        {/* TAB 3: QUANTITATIVE RISK & STRESS TESTING */}
        {activeTab === 'RISK' && customRisk && (
          <motion.div
            key="RISK"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="space-y-4"
          >
            <motion.div
              variants={widgetItemVariants}
              initial="hidden"
              animate="visible"
              className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-wrap items-end justify-between gap-3"
            >
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
                  Motor de Risco Quantitativo (Independente de IA Generativa)
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
                  Portfólio multi-fator Brasil: 35% IBOV · 25% USD/BRL · 20% Brent · 20% VALE3
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500 dark:text-[#8FA6B9]">Seed PRNG</label>
                  <input
                    type="number"
                    value={mcSeed}
                    onChange={(e) => setMcSeed(Number(e.target.value))}
                    className="w-28 px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 dark:text-[#8FA6B9]">Simulações</label>
                  <input
                    type="number"
                    min={1000}
                    max={25000}
                    step={1000}
                    value={mcSims}
                    onChange={(e) => setMcSims(Number(e.target.value))}
                    className="w-24 px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
                  />
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="button"
                  onClick={handleRecomputeRisk}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] transition-colors"
                >
                  Recalcular Monte Carlo
                </motion.button>
              </div>
            </motion.div>

            <motion.div
              key={`risk-kpis-${customRisk.seed}-${customRisk.simulations}`}
              variants={gridContainerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono tabular-nums"
            >
              <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">VaR Histórico 95%</div>
                <div className="text-base font-bold text-[#E45159]">-{customRisk.metrics.historicalVar95Pct}%</div>
              </motion.div>
              <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">VaR Cornish-Fisher 95%</div>
                <div className="text-base font-bold text-[#E45159]">-{customRisk.metrics.cornishFisherVar95Pct}%</div>
              </motion.div>
              <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">Monte Carlo VaR 95%</div>
                <div className="text-base font-bold text-[#E45159]">-{customRisk.metrics.monteCarloVar95Pct}%</div>
              </motion.div>
              <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">Expected Shortfall 95%</div>
                <div className="text-base font-bold text-[#F0B94A]">-{customRisk.metrics.expectedShortfall95Pct}%</div>
              </motion.div>
              <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">Volatilidade Anual</div>
                <div className="text-base font-bold text-slate-900 dark:text-[#E6EEF5]">{customRisk.metrics.annualizedVolatilityPct}%</div>
              </motion.div>
              <motion.div variants={widgetItemVariants} className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">Max Drawdown</div>
                <div className="text-base font-bold text-[#E45159]">{customRisk.metrics.maxDrawdownPct}%</div>
              </motion.div>
            </motion.div>

            <motion.div
              variants={gridContainerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              <motion.div variants={widgetItemVariants}>
                <EChartBox
                  title={`Distribuição de Retornos Monte Carlo (${customRisk.simulations.toLocaleString('pt-BR')} Simulações)`}
                  subtitle={`Seed = ${customRisk.seed} · Assimetria = ${customRisk.metrics.skewness} · Curtose Excesso = ${customRisk.metrics.excessKurtosis}`}
                  option={mcHistOption}
                  height={320}
                  darkMode={darkMode}
                  intelligenceNote={{
                    whatItShows: 'Barras em vermelho indicam a cauda de perda extrema além do VaR 95%.',
                    sourceAndTime: customRisk.limitations[0],
                  }}
                />
              </motion.div>

              <motion.div
                variants={widgetItemVariants}
                className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-y-auto max-h-[410px]"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
                    Simulador de Estresse — Cenários Hipotéticos A–J
                  </h3>
                  <span className="font-mono text-[10px] text-[#F0B94A]">CHOQUES HIPOTÉTICOS</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                      <th className="py-1.5 text-left">Cenário</th>
                      <th className="py-1.5 text-right">Impacto (%)</th>
                      <th className="py-1.5 text-right">Impacto / R$100M</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
                    {customRisk.stressScenarios.map((sc, idx) => (
                      <motion.tr
                        key={sc.code}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.2,
                          delay: Math.min(idx * 0.025, 0.22),
                          ease: INSTITUTIONAL_EASE,
                        }}
                        className="hover:bg-slate-50 dark:hover:bg-[#0A2540]/50 transition-colors"
                      >
                        <td className="py-2 pr-2">
                          <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                            [{sc.code}] {sc.namePt}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">
                            {sc.shockDescription}
                          </div>
                        </td>
                        <td
                          className={`py-2 text-right font-mono tabular-nums font-bold ${
                            sc.estimatedPortfolioImpactPct >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'
                          }`}
                        >
                          {sc.estimatedPortfolioImpactPct > 0 ? '+' : ''}
                          {sc.estimatedPortfolioImpactPct.toFixed(2)}%
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-slate-700 dark:text-[#C5D6E5]">
                          R$ {(sc.estimatedBrlImpactPer100M / 1_000_000).toFixed(2)}M
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </motion.div>
            </motion.div>

            <MacroStressHeatmapD3 report={stressHeatmap} darkMode={darkMode} />
          </motion.div>
        )}

        {/* TAB 4: BRAZIL ECONOMIC PULSE */}
        {activeTab === 'PULSE' && pulse && (
          <motion.div
            key="PULSE"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="space-y-4"
          >
            <motion.div
              variants={widgetItemVariants}
              initial="hidden"
              animate="visible"
              className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-wrap items-center justify-between gap-4"
            >
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5]">
                  Brazil Economic Pulse — Índice Composto Analítico (10 Dimensões)
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#8FA6B9] mt-0.5">
                  {pulse.methodology.disclaimer}
                </p>
              </div>
              <div className="text-right font-mono">
                <div className="text-2xl font-bold text-[#00B4D8] tabular-nums">
                  {pulse.compositeScore ?? '—'} <span className="text-sm text-[#8FA6B9]">/ 100</span>
                </div>
                <div className="text-xs font-semibold text-[#5CD9F5]">Avaliação: {pulse.assessment}</div>
              </div>
            </motion.div>

            <motion.div
              variants={gridContainerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              <motion.div variants={widgetItemVariants}>
                <EChartBox
                  title="Radar Multidimensional da Economia Brasileira"
                  subtitle="50 = Mediana/Média Histórica · Valores > 50 indicam condição relativamente favorável"
                  option={pulseRadarOption}
                  height={340}
                  darkMode={darkMode}
                />
              </motion.div>

              <motion.div
                variants={widgetItemVariants}
                className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-x-auto"
              >
                <h4 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] mb-2">
                  Decomposição Documentada das 10 Dimensões
                </h4>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                      <th className="py-1.5 text-left">Dimensão</th>
                      <th className="py-1.5 text-right">Peso</th>
                      <th className="py-1.5 text-right">Valor</th>
                      <th className="py-1.5 text-right">Z-Score</th>
                      <th className="py-1.5 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50 font-mono tabular-nums">
                    {pulse.dimensions.map((d, idx) => (
                      <motion.tr
                        key={d.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.2,
                          delay: Math.min(idx * 0.025, 0.22),
                          ease: INSTITUTIONAL_EASE,
                        }}
                        className="hover:bg-slate-50 dark:hover:bg-[#0A2540]/50 transition-colors"
                      >
                        <td className="py-1.5 font-sans text-slate-800 dark:text-[#E6EEF5]">
                          {d.namePt}
                          <span className="ml-1.5">
                            <DataStatusText status={d.dataStatus} compact />
                          </span>
                        </td>
                        <td className="py-1.5 text-right text-slate-500 dark:text-[#8FA6B9]">
                          {(d.weight * 100).toFixed(0)}%
                        </td>
                        <td className="py-1.5 text-right text-slate-900 dark:text-[#E6EEF5]">
                          {formatNumberPt(d.primaryValue, 2)} {d.primaryUnit}
                        </td>
                        <td className="py-1.5 text-right text-slate-500 dark:text-[#8FA6B9]">
                          {d.zScore !== null ? d.zScore.toFixed(2) : '—'}
                        </td>
                        <td className="py-1.5 text-right font-bold text-[#00B4D8]">{d.score}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 pt-2 border-t border-slate-200 dark:border-[#1A334B] text-[11px] text-slate-500 dark:text-[#8FA6B9] space-y-1">
                  <div><strong>Fórmula:</strong> <code>{pulse.methodology.formula}</code></div>
                  <div><strong>Normalização:</strong> {pulse.methodology.normalization}</div>
                  <div><strong>Dados Ausentes:</strong> {pulse.methodology.missingDataTreatment}</div>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
