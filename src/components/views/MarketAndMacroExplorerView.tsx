import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type {
  EmergingMarketsHeatmapReport,
  IndicatorSnapshot,
  Language,
  ObservationPoint,
  TechnicalAnalysisReport,
} from '../../types/sygma';
import { EmergingMarketsHeatmapD3 } from '../charts/EmergingMarketsHeatmapD3';
import { TradingChartBox } from '../charts/TradingChartBox';
import { DataStatusText, formatNumberPt } from '../common/StatusBadge';
import { HistoricalBacktestingPanel } from './HistoricalBacktestingPanel';

interface MarketAndMacroExplorerProps {
  mode: 'MARKETS' | 'MACRO' | 'INTERNATIONAL' | 'INDICATORS_DB';
  snapshots: IndicatorSnapshot[];
  selectedIndicatorId: string;
  onSelectIndicator: (id: string) => void;
  categoryFilter?: string;
  language: Language;
  darkMode: boolean;
  watchlist: string[];
  onToggleWatchlist: (id: string) => void;
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

export function MarketAndMacroExplorerView({
  mode,
  snapshots,
  selectedIndicatorId,
  onSelectIndicator,
  categoryFilter,
  language,
  darkMode,
  watchlist,
  onToggleWatchlist,
}: MarketAndMacroExplorerProps) {
  const [series, setSeries] = useState<ObservationPoint[]>([]);
  const [tech, setTech] = useState<TechnicalAnalysisReport | null>(null);
  const [revisions, setRevisions] = useState<Array<{ date: string; previousValue: number; newValue: number; detectedAt: string }>>([]);
  const [range, setRange] = useState('1Y');
  const [catFilter, setCatFilter] = useState<string>(categoryFilter || 'ALL');
  const [search, setSearch] = useState('');
  const [subView, setSubView] = useState<'ALL' | 'EXPLORER' | 'HEATMAP_EM' | 'BACKTEST'>('ALL');
  const [emYear, setEmYear] = useState<string>('LATEST');
  const [emReport, setEmReport] = useState<EmergingMarketsHeatmapReport | null>(null);
  const [emLoading, setEmLoading] = useState(false);
  const [emRefreshing, setEmRefreshing] = useState(false);

  useEffect(() => {
    setCatFilter(categoryFilter || 'ALL');
  }, [categoryFilter]);

  useEffect(() => {
    let active = true;
    setEmLoading(true);
    sygmaClient
      .fetchJson<EmergingMarketsHeatmapReport>(
        `/api/v1/quant/emerging-markets?year=${encodeURIComponent(emYear)}`
      )
      .then((res) => {
        if (active) setEmReport(res);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setEmLoading(false);
      });
    return () => {
      active = false;
    };
  }, [emYear]);

  const handleRefreshEm = () => {
    setEmRefreshing(true);
    sygmaClient
      .fetchJson<EmergingMarketsHeatmapReport>('/api/v1/quant/emerging-markets/refresh', {
        method: 'POST',
        body: JSON.stringify({ year: emYear }),
      })
      .then((res) => setEmReport(res))
      .catch(() => {})
      .finally(() => setEmRefreshing(false));
  };

  const filteredSnapshots = useMemo(() => {
    let base = snapshots;
    if (mode === 'MARKETS') {
      base = base.filter((s) =>
        ['FX', 'EQUITIES_BR', 'EQUITIES_GLOBAL', 'COMMODITIES'].includes(s.definition.category)
      );
    } else if (mode === 'MACRO') {
      base = base.filter((s) =>
        ['MONETARY', 'INFLATION', 'ACTIVITY', 'FISCAL', 'LABOR', 'CREDIT', 'EXTERNAL'].includes(s.definition.category)
      );
    } else if (mode === 'INTERNATIONAL') {
      base = base.filter((s) =>
        ['EQUITIES_GLOBAL', 'COMMODITIES', 'FX'].includes(s.definition.category)
      );
    }
    if (catFilter !== 'ALL') {
      base = base.filter((s) => s.definition.category === catFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter(
        (s) =>
          s.definition.namePt.toLowerCase().includes(q) ||
          s.definition.code.toLowerCase().includes(q) ||
          s.definition.id.toLowerCase().includes(q)
      );
    }
    return base;
  }, [snapshots, mode, catFilter, search]);

  const activeSnap = useMemo(
    () => snapshots.find((s) => s.definition.id === selectedIndicatorId) || filteredSnapshots[0] || snapshots[0],
    [snapshots, selectedIndicatorId, filteredSnapshots]
  );

  useEffect(() => {
    if (!activeSnap) return;
    let active = true;
    sygmaClient
      .fetchJson<{
        series: ObservationPoint[];
        technicalAnalysis: TechnicalAnalysisReport;
        revisions: Array<{ date: string; previousValue: number; newValue: number; detectedAt: string }>;
      }>(`/api/v1/indicators/${activeSnap.definition.id}/series?range=${range}`)
      .then((res) => {
        if (!active) return;
        setSeries(res.series);
        setTech(res.technicalAnalysis);
        setRevisions(res.revisions || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeSnap?.definition.id, range]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of snapshots) set.add(s.definition.category);
    return ['ALL', ...Array.from(set)];
  }, [snapshots]);

  return (
    <div className="space-y-4">
      {/* Sub-module Segmented Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap gap-1 p-1 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
          {(
            [
              { id: 'ALL', label: 'Painel Integrado' },
              { id: 'EXPLORER', label: 'Explorador de Séries' },
              { id: 'HEATMAP_EM', label: 'Heat-Map Emergentes (D3)' },
              { id: 'BACKTEST', label: 'Backtesting Histórico' },
            ] as const
          ).map((tab) => {
            const active = subView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubView(tab.id)}
                className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  active
                    ? 'text-[#061827] font-semibold'
                    : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={`explorer-subtab-${mode}`}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-md bg-[#00B4D8]"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {activeSnap && (
          <div className="text-xs font-mono text-slate-500 dark:text-[#8FA6B9] tabular-nums">
            Ativo selecionado: <span className="font-semibold text-[#00B4D8]">{activeSnap.definition.code}</span>
          </div>
        )}
      </div>

      {(subView === 'ALL' || subView === 'EXPLORER') && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Left Column: Filterable Instrument / Indicator Registry */}
      <motion.div
        key={`registry-panel-${mode}`}
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        className="xl:col-span-5 border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] rounded-lg p-3 flex flex-col max-h-[780px]"
      >
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
              {mode === 'INDICATORS_DB'
                ? 'Base Histórica & Catálogo de Séries'
                : mode === 'MACRO'
                ? 'Indicadores Macroeconômicos Brasil'
                : mode === 'INTERNATIONAL'
                ? 'Mercados Globais & Transmissão Brasil'
                : 'Mercados Financeiros, Câmbio e Commodities'}
            </h2>
            <span className="font-mono text-[11px] text-slate-500 dark:text-[#8FA6B9] tabular-nums">
              {filteredSnapshots.length} séries
            </span>
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={language === 'pt' ? 'Filtrar código ou indicador...' : 'Filter code or indicator...'}
            className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] focus:outline-none focus:border-[#00B4D8]"
          />

          <div className="flex flex-wrap gap-1">
            {categories.map((c) => (
              <motion.button
                key={c}
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => setCatFilter(c)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                  catFilter === c
                    ? 'bg-[#00B4D8] text-[#061827] border-[#00B4D8] font-semibold'
                    : 'border-slate-200 dark:border-[#1A334B] text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {c}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-white dark:bg-[#102438] border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
              <tr>
                <th className="py-1.5 text-left font-medium">Série</th>
                <th className="py-1.5 text-right font-medium">Valor</th>
                <th className="py-1.5 text-right font-medium">Var %</th>
                <th className="py-1.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
              {filteredSnapshots.map((s, idx) => {
                const selected = activeSnap?.definition.id === s.definition.id;
                const isWatch = watchlist.includes(s.definition.id);
                return (
                  <motion.tr
                    key={s.definition.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.18,
                      delay: Math.min(idx * 0.016, 0.22),
                      ease: INSTITUTIONAL_EASE,
                    }}
                    onClick={() => onSelectIndicator(s.definition.id)}
                    className={`cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[#00B4D8]/12 dark:bg-[#00B4D8]/15'
                        : 'hover:bg-slate-50 dark:hover:bg-[#0A2540]/60'
                    }`}
                  >
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWatchlist(s.definition.id);
                          }}
                          title="Favorito"
                          className={`text-xs ${isWatch ? 'text-[#F0B94A]' : 'text-slate-400 hover:text-[#F0B94A]'}`}
                        >
                          {isWatch ? '★' : '☆'}
                        </button>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-[#E6EEF5] truncate max-w-[165px]">
                            {s.definition.code}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9] truncate max-w-[165px]">
                            {language === 'pt' ? s.definition.namePt : s.definition.nameEn}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-900 dark:text-[#E6EEF5]">
                      {formatNumberPt(s.latest?.value, s.definition.category === 'FX' ? 4 : 2)}
                      <span className="block text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                        {s.latest?.date ?? '—'}
                      </span>
                    </td>
                    <td
                      className={`py-2 text-right font-mono tabular-nums font-semibold ${
                        (s.changePct ?? 0) > 0
                          ? 'text-[#19B779]'
                          : (s.changePct ?? 0) < 0
                          ? 'text-[#E45159]'
                          : 'text-[#8FA6B9]'
                      }`}
                    >
                      {s.changePct !== null ? `${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <DataStatusText status={s.status} compact />
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Right Column: Interactive TradingView Chart + Technical Feedback + Revisions */}
      <div className="xl:col-span-7 space-y-4">
        <AnimatePresence mode="wait">
          {activeSnap && (
            <motion.div
              key={activeSnap.definition.id}
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="space-y-4"
            >
              <motion.div
                variants={widgetItemVariants}
                className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
                      <span>{activeSnap.definition.code}</span>
                      <span aria-hidden="true">·</span>
                      <span>{activeSnap.definition.frequency}</span>
                      <span aria-hidden="true">·</span>
                      <DataStatusText status={activeSnap.status} />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
                      {language === 'pt' ? activeSnap.definition.namePt : activeSnap.definition.nameEn}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-[#8FA6B9] mt-1">
                      {activeSnap.definition.methodologyNote}
                    </p>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-2xl font-bold text-slate-900 dark:text-[#E6EEF5]">
                      {formatNumberPt(activeSnap.latest?.value, activeSnap.definition.category === 'FX' ? 4 : 2)}{' '}
                      <span className="text-xs font-normal text-slate-500 dark:text-[#8FA6B9]">
                        {activeSnap.definition.unit}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">
                      Ref: {activeSnap.latest?.date ?? 'N/D'} · {activeSnap.observationsCount} obs.
                    </div>
                  </div>
                </div>
              </motion.div>

              <motion.div variants={widgetItemVariants}>
                <TradingChartBox
                  title={`${activeSnap.definition.code} — Série Histórica Auditada`}
                  subtitle={`Fonte: ${activeSnap.latest?.sourceName ?? activeSnap.definition.providerId}`}
                  series={series}
                  height={320}
                  darkMode={darkMode}
                  activeRange={range}
                  onRangeChange={setRange}
                />
              </motion.div>

              {/* Technical Feedback Panel */}
              {tech && (
                <motion.div
                  variants={widgetItemVariants}
                  className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
                      Feedback Técnico Analítico (Calculado no Backend)
                    </h3>
                    <span className="text-[11px] font-mono text-[#F0B94A]">
                      Regime: {tech.trendRegime} · Vol: {tech.volatilityRegime}
                    </span>
                  </div>

                  <motion.div
                    variants={gridContainerVariants}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums"
                  >
                    <motion.div variants={widgetItemVariants} className="p-2 rounded bg-slate-50 dark:bg-[#061827] border border-slate-200 dark:border-[#1A334B]">
                      <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">SMA 20 / SMA 50</div>
                      <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                        {formatNumberPt(tech.sma20, 2)} / {formatNumberPt(tech.sma50, 2)}
                      </div>
                    </motion.div>
                    <motion.div variants={widgetItemVariants} className="p-2 rounded bg-slate-50 dark:bg-[#061827] border border-slate-200 dark:border-[#1A334B]">
                      <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">RSI (14) & MACD</div>
                      <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                        {formatNumberPt(tech.rsi14, 1)} · {formatNumberPt(tech.macd, 3)}
                      </div>
                    </motion.div>
                    <motion.div variants={widgetItemVariants} className="p-2 rounded bg-slate-50 dark:bg-[#061827] border border-slate-200 dark:border-[#1A334B]">
                      <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">Volatilidade Anual.</div>
                      <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                        {tech.annualizedVolatilityPct !== null ? `${tech.annualizedVolatilityPct}%` : '—'}
                      </div>
                    </motion.div>
                    <motion.div variants={widgetItemVariants} className="p-2 rounded bg-slate-50 dark:bg-[#061827] border border-slate-200 dark:border-[#1A334B]">
                      <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">Max Drawdown</div>
                      <div className="font-semibold text-[#E45159]">
                        {tech.maxDrawdownPct !== null ? `${tech.maxDrawdownPct}%` : '—'}
                      </div>
                    </motion.div>
                  </motion.div>

                  <p className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">{tech.disclaimer}</p>
                </motion.div>
              )}

              {/* Historical Observations & Revision Trail */}
              <motion.div
                variants={widgetItemVariants}
                className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]"
              >
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5] mb-2">
                  Últimas Observações Armazenadas ({revisions.length} revisões rastreadas)
                </h3>
                <div className="overflow-x-auto max-h-52 overflow-y-auto">
                  <table className="w-full text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                        <th className="py-1 text-left">Data Ref.</th>
                        <th className="py-1 text-right">Valor</th>
                        <th className="py-1 text-right">Status</th>
                        <th className="py-1 text-right">Digest SHA-256</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
                      {series
                        .slice(-15)
                        .reverse()
                        .map((pt, idx) => (
                          <motion.tr
                            key={`${activeSnap.definition.id}-${pt.date}`}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.18,
                              delay: Math.min(idx * 0.02, 0.2),
                              ease: INSTITUTIONAL_EASE,
                            }}
                            className="hover:bg-slate-50 dark:hover:bg-[#0A2540]/50 transition-colors"
                          >
                            <td className="py-1 text-slate-800 dark:text-[#E6EEF5]">{pt.date}</td>
                            <td className="py-1 text-right font-semibold text-slate-900 dark:text-[#E6EEF5]">
                              {formatNumberPt(pt.value, 4)}
                            </td>
                            <td className="py-1 text-right">
                              <DataStatusText status={pt.status} compact />
                            </td>
                            <td className="py-1 text-right text-slate-500 dark:text-[#8FA6B9]">
                              {pt.digestSha256 || '—'}
                            </td>
                          </motion.tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
      )}

      {(subView === 'ALL' || subView === 'HEATMAP_EM') && (
        <EmergingMarketsHeatmapD3
          report={emReport}
          loading={emLoading}
          refreshing={emRefreshing}
          selectedYear={emYear}
          onSelectYear={setEmYear}
          onRefresh={handleRefreshEm}
          onSelectLocalIndicator={(indId) => onSelectIndicator(indId)}
          language={language}
          darkMode={darkMode}
        />
      )}

      {(subView === 'ALL' || subView === 'BACKTEST') && activeSnap && (
        <HistoricalBacktestingPanel
          indicatorId={activeSnap.definition.id}
          indicatorCode={activeSnap.definition.code}
          indicatorName={language === 'pt' ? activeSnap.definition.namePt : activeSnap.definition.nameEn}
          language={language}
          darkMode={darkMode}
        />
      )}
    </div>
  );
}
