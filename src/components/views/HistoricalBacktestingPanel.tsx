import type * as echarts from 'echarts';
import { motion } from 'motion/react';
import { Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type { BacktestReport, BacktestStrategy, Language } from '../../types/sygma';
import { EChartBox } from '../charts/EChartBox';
import { formatNumberPt } from '../common/StatusBadge';

interface HistoricalBacktestingPanelProps {
  indicatorId: string;
  indicatorCode?: string;
  indicatorName?: string;
  language: Language;
  darkMode: boolean;
}

const STRATEGIES: Array<{ id: BacktestStrategy; labelPt: string; labelEn: string }> = [
  { id: 'TREND_SMA_CROSSOVER', labelPt: 'Cruzamento SMA (Tendência)', labelEn: 'SMA Crossover (Trend)' },
  { id: 'MEAN_REVERSION_ZSCORE', labelPt: 'Reversão Z-Score (±0,75σ)', labelEn: 'Z-Score Mean Reversion' },
  { id: 'AR1_WALK_FORWARD', labelPt: 'AR(1) Walk-Forward Causal', labelEn: 'Causal AR(1) Walk-Forward' },
  { id: 'MOMENTUM_REGIME', labelPt: 'Momentum & Mediana Rolante', labelEn: 'Momentum & Rolling Median' },
];

export function HistoricalBacktestingPanel({
  indicatorId,
  indicatorCode,
  indicatorName,
  language,
  darkMode,
}: HistoricalBacktestingPanelProps) {
  const [strategy, setStrategy] = useState<BacktestStrategy>('TREND_SMA_CROSSOVER');
  const [range, setRange] = useState<'1Y' | '3Y' | '5Y' | 'MAX'>('3Y');
  const [costBps, setCostBps] = useState<number>(10);
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [loading, setLoading] = useState(false);

  const runBacktest = (
    targetId = indicatorId,
    targetStrat = strategy,
    targetRange = range,
    targetCost = costBps
  ) => {
    if (!targetId) return;
    setLoading(true);
    sygmaClient
      .fetchJson<BacktestReport>('/api/v1/quant/backtest', {
        method: 'POST',
        body: JSON.stringify({
          indicatorId: targetId,
          strategy: targetStrat,
          range: targetRange,
          transactionCostBps: targetCost,
        }),
      })
      .then((res) => setReport(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    runBacktest(indicatorId, strategy, range, costBps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorId, strategy, range, costBps]);

  const equityOption: echarts.EChartsOption = useMemo(() => {
    const pts = report?.equityCurve ?? [];
    const axisColor = darkMode ? '#8FA6B9' : '#475569';
    const gridColor = darkMode ? '#1A334B' : '#E2E8F0';
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: darkMode ? '#061827' : '#FFFFFF',
        borderColor: darkMode ? '#1E3A54' : '#CBD5E1',
        textStyle: { color: darkMode ? '#E6EEF5' : '#0F172A', fontSize: 11 },
      },
      legend: {
        top: 2,
        textStyle: { color: axisColor, fontSize: 11 },
      },
      grid: { left: 48, right: 18, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: pts.map((p) => p.date),
        axisLabel: { color: axisColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: axisColor, fontSize: 10, formatter: '{value}' },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      },
      series: [
        {
          name: 'Estratégia Causal (Base 100)',
          type: 'line',
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 2.2, color: '#00B4D8' },
          areaStyle: { color: 'rgba(0, 180, 216, 0.08)' },
          data: pts.map((p) => p.strategyEquity),
        },
        {
          name: 'Benchmark Buy & Hold (Base 100)',
          type: 'line',
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 1.6, color: '#F0B94A', type: 'dashed' },
          data: pts.map((p) => p.benchmarkEquity),
        },
      ],
    };
  }, [report, darkMode]);

  const drawdownOption: echarts.EChartsOption = useMemo(() => {
    const pts = report?.equityCurve ?? [];
    const axisColor = darkMode ? '#8FA6B9' : '#475569';
    const gridColor = darkMode ? '#1A334B' : '#E2E8F0';
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: darkMode ? '#061827' : '#FFFFFF',
        borderColor: darkMode ? '#1E3A54' : '#CBD5E1',
        textStyle: { color: darkMode ? '#E6EEF5' : '#0F172A', fontSize: 11 },
      },
      legend: {
        top: 2,
        textStyle: { color: axisColor, fontSize: 11 },
      },
      grid: { left: 48, right: 18, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: pts.map((p) => p.date),
        axisLabel: { color: axisColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: 'value',
        max: 0,
        axisLabel: { color: axisColor, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      },
      series: [
        {
          name: 'Drawdown Estratégia (%)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.8, color: '#E45159' },
          areaStyle: { color: 'rgba(228, 81, 89, 0.16)' },
          data: pts.map((p) => p.drawdownPct),
        },
        {
          name: 'Drawdown Benchmark (%)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.3, color: '#64748B', type: 'dotted' },
          data: pts.map((p) => p.benchmarkDrawdownPct),
        },
      ],
    };
  }, [report, darkMode]);

  const equityCsvRows = useMemo(
    () =>
      (report?.equityCurve ?? []).map((p) => ({
        date: p.date,
        price: p.price,
        strategy_equity: p.strategyEquity,
        benchmark_equity: p.benchmarkEquity,
        drawdown_pct: p.drawdownPct,
        signal_position: p.signalPosition,
      })),
    [report]
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] rounded-lg p-4 space-y-4"
    >
      {/* Header & Strategy Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">
            <span className="font-semibold text-[#19B779]">CAUSAL WALK-FORWARD BACKTESTING</span>
            <span aria-hidden="true">·</span>
            <span>{indicatorCode || indicatorId}</span>
            {report && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {report.sampleStart} → {report.sampleEnd} ({report.observationsTested} períodos)
                </span>
              </>
            )}
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
            {language === 'pt'
              ? `Backtesting Histórico: ${indicatorName || indicatorId}`
              : `Historical Backtesting: ${indicatorName || indicatorId}`}
          </h2>
          <p className="text-xs text-slate-600 dark:text-[#8FA6B9]">
            {report?.methodologyNote ||
              'Avaliação histórica sem look-ahead bias com simulação de custos operacionais e métricas out-of-sample.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Estratégia de Backtesting"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as BacktestStrategy)}
            className="px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
          >
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {language === 'pt' ? s.labelPt : s.labelEn}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] p-0.5">
            {(['1Y', '3Y', '5Y', 'MAX'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2 py-1 text-[11px] font-mono rounded transition-colors ${
                  range === r
                    ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                    : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <select
            aria-label="Custo por giro em bps"
            value={costBps}
            onChange={(e) => setCostBps(Number(e.target.value))}
            className="px-2 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
          >
            <option value={0}>Custo 0 bps</option>
            <option value={5}>Custo 5 bps</option>
            <option value={10}>Custo 10 bps</option>
            <option value={25}>Custo 25 bps</option>
          </select>

          <button
            type="button"
            onClick={() => runBacktest()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded bg-[#00B4D8] text-[#061827] hover:bg-[#5CD9F5] transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{loading ? 'Executando...' : 'Recalcular'}</span>
          </button>
        </div>
      </div>

      {/* Quantitative Metrics Strip */}
      {report && report.observationsTested > 0 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono tabular-nums">
            <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">RETORNO ESTRATÉGIA</div>
              <div
                className={`text-base font-bold mt-0.5 ${
                  report.metrics.totalReturnPct >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'
                }`}
              >
                {report.metrics.totalReturnPct > 0 ? '+' : ''}
                {report.metrics.totalReturnPct.toFixed(2)}%
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                CAGR: {report.metrics.cagrPct.toFixed(2)}% a.a.
              </div>
            </div>

            <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">ALPHA VS BENCHMARK</div>
              <div
                className={`text-base font-bold mt-0.5 ${
                  report.metrics.alphaPct >= 0 ? 'text-[#00B4D8]' : 'text-[#E45159]'
                }`}
              >
                {report.metrics.alphaPct > 0 ? '+' : ''}
                {report.metrics.alphaPct.toFixed(2)} p.p.
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                Bench: {report.metrics.benchmarkReturnPct > 0 ? '+' : ''}
                {report.metrics.benchmarkReturnPct.toFixed(2)}%
              </div>
            </div>

            <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">SHARPE / SORTINO</div>
              <div className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
                {report.metrics.sharpeRatio.toFixed(2)} / {report.metrics.sortinoRatio.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                Vol Anual: {report.metrics.annualizedVolatilityPct.toFixed(1)}%
              </div>
            </div>

            <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">MAX DRAWDOWN</div>
              <div className="text-base font-bold text-[#E45159] mt-0.5">
                {report.metrics.maxDrawdownPct.toFixed(2)}%
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                Bench DD: {report.metrics.benchmarkMaxDrawdownPct.toFixed(2)}%
              </div>
            </div>

            <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">TAXA ACERTO / PF</div>
              <div className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
                {report.metrics.winRatePct.toFixed(1)}% · PF {report.metrics.profitFactor.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                {report.metrics.tradesCount} entradas · Exp. {report.metrics.exposurePct}%
              </div>
            </div>

            <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">WALK-FORWARD AR(1)</div>
              <div className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
                Dir. {report.metrics.directionalAccuracyPct.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                MAE {formatNumberPt(report.metrics.walkForwardMae, 3)} · RMSE {formatNumberPt(report.metrics.walkForwardRmse, 3)}
              </div>
            </div>
          </div>

          {/* Equity Curve & Drawdown Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <EChartBox
              title={`Curva de Capital Base 100 — ${report.indicatorCode}`}
              subtitle={`${report.strategyLabelPt} · Custo ${report.transactionCostBps} bps`}
              option={equityOption}
              height={265}
              darkMode={darkMode}
              csvRows={equityCsvRows}
              csvFilename={`sygma_backtest_equity_${report.indicatorId.toLowerCase()}.csv`}
              intelligenceNote={{
                whatItShows:
                  report.evaluationMode === 'PRICE_RETURN'
                    ? 'Evolução composta de R$ 100 na estratégia causal comparada à exposição passiva (Buy & Hold).'
                    : 'Evolução normalizada de regime direcional em série de taxa/percentual comparada à variação acumulada.',
                sourceAndTime: `${report.sampleStart} até ${report.sampleEnd}`,
              }}
            />

            <EChartBox
              title={`Curva de Rebaixamento (Drawdown %) — ${report.indicatorCode}`}
              subtitle="Perda percentual máxima a partir de cada topo histórico"
              option={drawdownOption}
              height={265}
              darkMode={darkMode}
              intelligenceNote={{
                whatItShows:
                  'Compara a severidade das quedas máximas (drawdowns) da estratégia tática versus o ativo subjacente.',
                sourceAndTime: `Max DD Estratégia ${report.metrics.maxDrawdownPct}% vs Bench ${report.metrics.benchmarkMaxDrawdownPct}%`,
              }}
            />
          </div>

          {/* Year-by-Year Matrix & Recent Trades */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-[#E6EEF5] mb-2">
                Matriz Anual de Performance Histórica (Backtest)
              </h3>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                      <th className="py-1 text-left">Ano</th>
                      <th className="py-1 text-right">Estratégia</th>
                      <th className="py-1 text-right">Benchmark</th>
                      <th className="py-1 text-right">Alpha</th>
                      <th className="py-1 text-right">Max DD</th>
                      <th className="py-1 text-right">Entradas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-[#1A334B]/50">
                    {report.annualBreakdown.map((row) => (
                      <tr key={row.year}>
                        <td className="py-1 font-semibold text-slate-900 dark:text-[#E6EEF5]">{row.year}</td>
                        <td
                          className={`py-1 text-right font-semibold ${
                            row.strategyReturnPct >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'
                          }`}
                        >
                          {row.strategyReturnPct > 0 ? '+' : ''}
                          {row.strategyReturnPct.toFixed(2)}%
                        </td>
                        <td className="py-1 text-right text-slate-700 dark:text-[#C5D6E5]">
                          {row.benchmarkReturnPct > 0 ? '+' : ''}
                          {row.benchmarkReturnPct.toFixed(2)}%
                        </td>
                        <td
                          className={`py-1 text-right font-semibold ${
                            row.alphaPct >= 0 ? 'text-[#00B4D8]' : 'text-[#F0B94A]'
                          }`}
                        >
                          {row.alphaPct > 0 ? '+' : ''}
                          {row.alphaPct.toFixed(2)} p.p.
                        </td>
                        <td className="py-1 text-right text-[#E45159]">{row.maxDrawdownPct.toFixed(2)}%</td>
                        <td className="py-1 text-right text-slate-600 dark:text-[#8FA6B9]">{row.trades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827]">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-[#E6EEF5] mb-2">
                Registro de Transições de Sinal (Últimas {report.recentTrades.length} Operações)
              </h3>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                      <th className="py-1 text-left">Entrada</th>
                      <th className="py-1 text-left">Saída</th>
                      <th className="py-1 text-right">Nível Entr.</th>
                      <th className="py-1 text-right">Nível Saída</th>
                      <th className="py-1 text-right">Ret. Líq.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-[#1A334B]/50">
                    {report.recentTrades.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-slate-500 dark:text-[#8FA6B9]">
                          Nenhuma transição de posição registrada na janela selecionada.
                        </td>
                      </tr>
                    ) : (
                      report.recentTrades.map((tr, i) => (
                        <tr key={`${tr.entryDate}-${i}`}>
                          <td className="py-1 text-slate-800 dark:text-[#E6EEF5]">{tr.entryDate}</td>
                          <td className="py-1 text-slate-600 dark:text-[#8FA6B9]">{tr.exitDate}</td>
                          <td className="py-1 text-right text-slate-700 dark:text-[#C5D6E5]">
                            {formatNumberPt(tr.entryValue, 2)}
                          </td>
                          <td className="py-1 text-right text-slate-700 dark:text-[#C5D6E5]">
                            {formatNumberPt(tr.exitValue, 2)}
                          </td>
                          <td
                            className={`py-1 text-right font-semibold ${
                              tr.netReturnPct >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'
                            }`}
                          >
                            {tr.netReturnPct > 0 ? '+' : ''}
                            {tr.netReturnPct.toFixed(2)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="p-6 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
          {loading
            ? 'Executando simulação causal walk-forward...'
            : report?.limitations?.[0] ??
              'Amostra histórica insuficiente (< 24 observações) para esta série na janela selecionada.'}
        </div>
      )}
    </motion.section>
  );
}
