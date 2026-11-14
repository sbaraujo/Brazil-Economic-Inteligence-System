import type * as echarts from 'echarts';
import { RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type {
  BrazilPulseReport,
  FocusExpectation,
  IndicatorSnapshot,
  Language,
  NewsItem,
  ObservationPoint,
  RiskReport,
  SentimentAnalysisReport,
  SystemHealthResponse,
} from '../../types/sygma';
import { EChartBox } from '../charts/EChartBox';
import { TradingChartBox } from '../charts/TradingChartBox';
import { DataStatusText, formatNumberPt } from '../common/StatusBadge';

interface ExecutiveOverviewProps {
  snapshots: IndicatorSnapshot[];
  focusExpectations: FocusExpectation[];
  pulse: BrazilPulseReport | null;
  risk: RiskReport | null;
  health: SystemHealthResponse | null;
  news: NewsItem[];
  sentiment?: SentimentAnalysisReport | null;
  language: Language;
  darkMode: boolean;
  onSelectIndicator: (id: string, targetView?: 'MARKETS' | 'MACRO') => void;
  onSyncNow: () => void;
  syncing: boolean;
}

const KPI_IDS = [
  'USD_BRL_PTAX',
  'EUR_BRL_PTAX',
  'SELIC_META',
  'CDI_ANUAL',
  'IPCA_MENSAL',
  'IBOV',
  'BRENT',
  'GOLD',
  'DIVIDA_BRUTA_PIB',
  'DESEMPREGO_PNAD',
];

export function ExecutiveOverviewView({
  snapshots,
  focusExpectations,
  pulse,
  risk,
  health,
  news,
  sentiment,
  language,
  darkMode,
  onSelectIndicator,
  onSyncNow,
  syncing,
}: ExecutiveOverviewProps) {
  const [usdSeries, setUsdSeries] = useState<ObservationPoint[]>([]);
  const [ibovSeries, setIbovSeries] = useState<ObservationPoint[]>([]);
  const [selicSeries, setSelicSeries] = useState<ObservationPoint[]>([]);
  const [ipcaSeries, setIpcaSeries] = useState<ObservationPoint[]>([]);
  const [debtSeries, setDebtSeries] = useState<ObservationPoint[]>([]);
  const [brentSeries, setBrentSeries] = useState<ObservationPoint[]>([]);
  const [ibcSeries, setIbcSeries] = useState<ObservationPoint[]>([]);
  const [sp500Series, setSp500Series] = useState<ObservationPoint[]>([]);

  const [usdRange, setUsdRange] = useState('1Y');
  const [ibovRange, setIbovRange] = useState('1Y');

  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadSeries = async () => {
      try {
        const [u, ib, sel, ipc, dbt, brt, ibc, sp] = await Promise.all([
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>(`/api/v1/indicators/USD_BRL_PTAX/series?range=${usdRange}`),
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>(`/api/v1/indicators/IBOV/series?range=${ibovRange}`),
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>('/api/v1/indicators/SELIC_META/series?range=5Y'),
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>('/api/v1/indicators/IPCA_MENSAL/series?range=5Y'),
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>('/api/v1/indicators/DIVIDA_BRUTA_PIB/series?range=MAX'),
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>('/api/v1/indicators/BRENT/series?range=1Y'),
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>('/api/v1/indicators/IBC_BR/series?range=5Y'),
          sygmaClient.fetchJson<{ series: ObservationPoint[] }>('/api/v1/indicators/SP500/series?range=1Y'),
        ]);
        if (!active) return;
        setUsdSeries(u.series);
        setIbovSeries(ib.series);
        setSelicSeries(sel.series);
        setIpcaSeries(ipc.series);
        setDebtSeries(dbt.series);
        setBrentSeries(brt.series);
        setIbcSeries(ibc.series);
        setSp500Series(sp.series);
      } catch {
        // Backend still finishing sync
      }
    };
    loadSeries();
    return () => {
      active = false;
    };
  }, [snapshots.length, usdRange, ibovRange]);

  const kpis = useMemo(
    () =>
      KPI_IDS.map((id) => snapshots.find((s) => s.definition.id === id)).filter(
        (s): s is IndicatorSnapshot => Boolean(s)
      ),
    [snapshots]
  );

  const selicVsIpcaOption = useMemo<echarts.EChartsOption>(() => {
    const ipcaByMonth = new Map<string, number>();
    for (const p of ipcaSeries) ipcaByMonth.set(p.date.slice(0, 7), p.value);
    const months = Array.from(ipcaByMonth.keys()).sort();

    const ipca12m: Array<{ month: string; val: number }> = [];
    for (let i = 11; i < months.length; i++) {
      let factor = 1;
      for (let j = i - 11; j <= i; j++) {
        factor *= 1 + (ipcaByMonth.get(months[j]) ?? 0) / 100;
      }
      ipca12m.push({ month: months[i], val: Number(((factor - 1) * 100).toFixed(2)) });
    }

    const selicByMonth = new Map<string, number>();
    for (const p of selicSeries) selicByMonth.set(p.date.slice(0, 7), p.value);

    const xLabels = ipca12m.map((d) => d.month);
    const ipcaVals = ipca12m.map((d) => d.val);
    const selicVals = ipca12m.map((d) => selicByMonth.get(d.month) ?? null);

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['Selic Meta (% a.a.)', 'IPCA Acum. 12M (%)'],
        textStyle: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 11 },
        top: 0,
      },
      grid: { left: 42, right: 20, top: 34, bottom: 26 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
        axisLine: { lineStyle: { color: darkMode ? '#1A334B' : '#CBD5E1' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
      },
      series: [
        {
          name: 'Selic Meta (% a.a.)',
          type: 'line',
          step: 'end',
          data: selicVals,
          itemStyle: { color: '#00B4D8' },
          lineStyle: { width: 2 },
        },
        {
          name: 'IPCA Acum. 12M (%)',
          type: 'line',
          smooth: true,
          data: ipcaVals,
          itemStyle: { color: '#F0B94A' },
          areaStyle: { color: 'rgba(240, 185, 74, 0.12)' },
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [ipcaSeries, selicSeries, darkMode]);

  const debtAndIbcOption = useMemo<echarts.EChartsOption>(() => {
    const dates = debtSeries.slice(-60).map((d) => d.date.slice(0, 7));
    const debtVals = debtSeries.slice(-60).map((d) => d.value);
    const ibcMap = new Map(ibcSeries.map((p) => [p.date.slice(0, 7), p.value]));
    const ibcVals = dates.map((m) => ibcMap.get(m) ?? null);

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['Dívida Bruta (% PIB)', 'IBC-Br Dessazonalizado'],
        textStyle: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 11 },
        top: 0,
      },
      grid: { left: 44, right: 44, top: 34, bottom: 26 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: '% PIB',
          nameTextStyle: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
          axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
          splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
        },
        {
          type: 'value',
          name: 'IBC-Br',
          nameTextStyle: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
          axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Dívida Bruta (% PIB)',
          type: 'line',
          data: debtVals,
          itemStyle: { color: '#E45159' },
          areaStyle: { color: 'rgba(228, 81, 89, 0.12)' },
          lineStyle: { width: 2 },
        },
        {
          name: 'IBC-Br Dessazonalizado',
          type: 'line',
          yAxisIndex: 1,
          data: ibcVals,
          itemStyle: { color: '#19B779' },
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [debtSeries, ibcSeries, darkMode]);

  const globalCompareOption = useMemo<echarts.EChartsOption>(() => {
    const normalize = (pts: ObservationPoint[]) => {
      if (pts.length === 0) return new Map<string, number>();
      const base = pts[0].value || 1;
      return new Map(pts.map((p) => [p.date.slice(0, 10), Number(((p.value / base) * 100).toFixed(2))]));
    };
    const mIbov = normalize(ibovSeries);
    const mSp = normalize(sp500Series);
    const mBrent = normalize(brentSeries);
    const dates = Array.from(mIbov.keys()).filter((d) => mSp.has(d) || mBrent.has(d)).slice(-180);

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['IBOV (Base 100)', 'S&P 500 (Base 100)', 'Brent (Base 100)'],
        textStyle: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 11 },
        top: 0,
      },
      grid: { left: 42, right: 16, top: 34, bottom: 26 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
        splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
      },
      series: [
        { name: 'IBOV (Base 100)', type: 'line', showSymbol: false, data: dates.map((d) => mIbov.get(d) ?? null), itemStyle: { color: '#00B4D8' } },
        { name: 'S&P 500 (Base 100)', type: 'line', showSymbol: false, data: dates.map((d) => mSp.get(d) ?? null), itemStyle: { color: '#19B779' } },
        { name: 'Brent (Base 100)', type: 'line', showSymbol: false, data: dates.map((d) => mBrent.get(d) ?? null), itemStyle: { color: '#F0B94A' } },
      ],
    };
  }, [ibovSeries, sp500Series, brentSeries, darkMode]);

  const handleGenerateBriefing = async () => {
    setLoadingBriefing(true);
    setBriefingError(null);
    try {
      const res = await sygmaClient.fetchJson<{ answer: string }>('/api/v1/ai/briefing', {
        method: 'POST',
        body: JSON.stringify({ language }),
      });
      setAiBriefing(res.answer);
    } catch (err) {
      setBriefingError(err instanceof Error ? err.message : 'Erro ao gerar briefing executivo');
    } finally {
      setLoadingBriefing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <section aria-label="Indicadores Principais">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8FA6B9]">
            {language === 'pt'
              ? 'Painel Executivo de Indicadores Auditados'
              : 'Audited Executive Indicators Strip'}
          </h2>
          <button
            type="button"
            onClick={onSyncNow}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[#0A2540] hover:bg-[#103456] text-[#5CD9F5] border border-[#1E3A54] rounded transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing
              ? language === 'pt' ? 'Sincronizando...' : 'Syncing...'
              : language === 'pt' ? 'Sincronizar Fontes Oficiais' : 'Sync Official Feeds'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {kpis.map((snap) => {
            const isPositive = (snap.changePct ?? 0) > 0;
            const isNegative = (snap.changePct ?? 0) < 0;
            const targetView =
              snap.definition.category === 'FX' ||
              snap.definition.category === 'EQUITIES_BR' ||
              snap.definition.category === 'COMMODITIES'
                ? 'MARKETS'
                : 'MACRO';
            return (
              <button
                key={snap.definition.id}
                type="button"
                onClick={() => onSelectIndicator(snap.definition.id, targetView)}
                className="text-left p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] hover:border-[#00B4D8] transition-colors flex flex-col justify-between gap-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-[#8FA6B9] truncate">
                    {snap.definition.code}
                  </span>
                  <DataStatusText status={snap.status} compact />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-[#E6EEF5]">
                    {formatNumberPt(snap.latest?.value, snap.definition.category === 'FX' ? 4 : 2)}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">
                    {snap.definition.unit}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#8FA6B9]">
                  <span>{snap.latest?.date ?? 'Sem data'}</span>
                  {snap.changePct !== null && (
                    <span
                      className={`inline-flex items-center gap-0.5 font-semibold ${
                        isPositive ? 'text-[#19B779]' : isNegative ? 'text-[#E45159]' : 'text-[#8FA6B9]'
                      }`}
                    >
                      {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : null}
                      {snap.changePct > 0 ? '+' : ''}
                      {snap.changePct.toFixed(2)}%
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Financial Charts Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TradingChartBox
          title="USD/BRL — Taxa PTAX Oficial (Banco Central do Brasil)"
          subtitle="Série SGS 1 · Evolução diária com média móvel SMA20"
          series={usdSeries}
          height={270}
          darkMode={darkMode}
          activeRange={usdRange}
          onRangeChange={setUsdRange}
        />
        <TradingChartBox
          title="Ibovespa (IBOV) — Índice B3 (OHLC + SMA20)"
          subtitle="Feed de mercado com atraso (~15 min) · Candles diários"
          series={ibovSeries}
          height={270}
          darkMode={darkMode}
          activeRange={ibovRange}
          onRangeChange={setIbovRange}
        />
      </section>

      {/* Macro Policy & Fiscal Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <EChartBox
          title="Política Monetária: Selic Meta vs IPCA 12M"
          subtitle="Taxa básica vs inflação acumulada em 12 meses"
          option={selicVsIpcaOption}
          height={250}
          darkMode={darkMode}
          intelligenceNote={{
            whatItShows: 'Spread nominal entre a meta Selic (COPOM) e o IPCA acumulado em 12 meses (IBGE/BCB).',
            sourceAndTime: 'Fonte: BCB SGS (432 & 433)',
          }}
        />
        <EChartBox
          title="Dinâmica Fiscal vs Atividade (DBGG/PIB & IBC-Br)"
          subtitle="Dívida Bruta do Governo Geral (% PIB) vs IBC-Br"
          option={debtAndIbcOption}
          height={250}
          darkMode={darkMode}
          intelligenceNote={{
            whatItShows: 'Trajetória conjunta da alavancagem soberana e do ritmo mensal de atividade econômica.',
            sourceAndTime: 'Fonte: BCB SGS (13762 & 24364)',
          }}
        />
        <EChartBox
          title="Comparação Global Normalizada (Base 100)"
          subtitle="IBOV vs S&P 500 vs Petróleo Brent (últimos 180 pregões)"
          option={globalCompareOption}
          height={250}
          darkMode={darkMode}
          intelligenceNote={{
            whatItShows: 'Desempenho relativo do mercado brasileiro contra o S&P 500 e energia global.',
            sourceAndTime: 'Fonte: Market Data Feed (DELAYED)',
          }}
        />
      </section>

      {/* Intelligence Panels Row */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
              Expectativas Oficiais — Boletim Focus (BCB)
            </h3>
            <DataStatusText status="PERIODIC" compact />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
                  <th className="py-1.5 text-left font-medium">Indicador</th>
                  <th className="py-1.5 text-center font-medium">Ano</th>
                  <th className="py-1.5 text-right font-medium">Mediana</th>
                  <th className="py-1.5 text-right font-medium">Desvio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/60 font-mono tabular-nums">
                {focusExpectations.slice(0, 8).map((f) => (
                  <tr key={`${f.indicator}-${f.referenceYear}`}>
                    <td className="py-1.5 font-sans text-slate-800 dark:text-[#E6EEF5]">{f.indicator}</td>
                    <td className="py-1.5 text-center text-slate-500 dark:text-[#8FA6B9]">{f.referenceYear}</td>
                    <td className="py-1.5 text-right font-semibold text-[#00B4D8]">
                      {formatNumberPt(f.median, 2)}
                    </td>
                    <td className="py-1.5 text-right text-slate-500 dark:text-[#8FA6B9]">
                      ±{formatNumberPt(f.stdDev, 2)}
                    </td>
                  </tr>
                ))}
                {focusExpectations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500 dark:text-[#8FA6B9]">
                      Carregando expectativas Olinda BCB...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pulse && (
            <div className="pt-2 border-t border-slate-200 dark:border-[#1A334B] flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-[#8FA6B9]">Brazil Economic Pulse (Composto):</span>
              <span className="font-mono font-semibold text-[#5CD9F5]">
                {pulse.compositeScore ?? '—'} / 100 · {pulse.assessment}
              </span>
            </div>
          )}
        </div>

        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
              Risco Quantitativo & Alertas de Qualidade
            </h3>
            <span className="font-mono text-[11px] text-[#8FA6B9]">
              {health?.overallStatus ?? 'EVALUATING'}
            </span>
          </div>
          {risk && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-slate-50 dark:bg-[#061827] border border-slate-200 dark:border-[#1A334B]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Monte Carlo VaR 95%</div>
                <div className="font-mono font-bold text-[#E45159] tabular-nums">
                  -{risk.metrics.monteCarloVar95Pct}% / dia
                </div>
              </div>
              <div className="p-2 rounded bg-slate-50 dark:bg-[#061827] border border-slate-200 dark:border-[#1A334B]">
                <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">Expected Shortfall 95%</div>
                <div className="font-mono font-bold text-[#F0B94A] tabular-nums">
                  -{risk.metrics.expectedShortfall95Pct}% / dia
                </div>
              </div>
            </div>
          )}
          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {(health?.issues ?? []).slice(0, 5).map((issue) => (
              <div
                key={issue.id}
                className="text-xs py-1.5 border-b border-slate-100 dark:border-[#1A334B]/60 last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800 dark:text-[#E6EEF5] truncate">
                    {issue.titlePt}
                  </span>
                  <span
                    className={`font-mono text-[10px] font-semibold shrink-0 ${
                      issue.severity === 'CRITICAL' || issue.severity === 'HIGH'
                        ? 'text-[#E45159]'
                        : issue.severity === 'MODERATE'
                        ? 'text-[#F0B94A]'
                        : 'text-[#8FA6B9]'
                    }`}
                  >
                    {issue.severity}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-[#8FA6B9] truncate">
                  {issue.descriptionPt}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
              Comunicados Oficiais — Banco Central
            </h3>
            <DataStatusText status="PERIODIC" compact />
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {news.slice(0, 5).map((item) => (
              <a
                key={item.id}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block pb-2 border-b border-slate-100 dark:border-[#1A334B]/60 last:border-0 hover:opacity-85 transition-opacity"
              >
                <div className="text-xs font-medium text-slate-900 dark:text-[#E6EEF5] line-clamp-2">
                  {item.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-[#8FA6B9] font-mono">
                  <span>{item.publishedAt.slice(0, 10)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{item.topic}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold shrink-0 ${
                      item.sentiment === 'POSITIVE'
                        ? 'text-[#19B779]'
                        : item.sentiment === 'NEGATIVE'
                        ? 'text-[#E45159]'
                        : item.sentiment === 'MIXED'
                        ? 'text-[#F0B94A]'
                        : 'text-[#8FA6B9]'
                    }`}
                  >
                    {item.sentiment}
                  </span>
                </div>
              </a>
            ))}
            {news.length === 0 && (
              <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
                Nenhum comunicado BCB carregado ainda.
              </p>
            )}
          </div>
          {sentiment && (
            <div className="pt-2 border-t border-slate-200 dark:border-[#1A334B] flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-600 dark:text-[#8FA6B9]">Sentimento Macro (NLP + Fluxo):</span>
              <span className="font-mono font-semibold text-[#5CD9F5] tabular-nums">
                {sentiment.compositeScore.toFixed(1)}/100 · {sentiment.policyTone.dominantStance} ·{' '}
                {language === 'pt' ? sentiment.regimeLabelPt : sentiment.regimeLabelEn}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Executive AI Briefing Section */}
      <section className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
              Síntese Executiva Auditada (SYGMA AI Economic Analyst)
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
              Geração fundamentada em ferramentas read-only com rastreabilidade de fontes e datas oficiais.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerateBriefing}
            disabled={loadingBriefing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#00B4D8] hover:bg-[#5CD9F5] text-[#061827] rounded transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {loadingBriefing ? 'Analisando séries oficiais...' : 'Gerar Briefing Executivo'}
          </button>
        </div>

        {briefingError && (
          <div className="p-3 rounded border border-[#E45159]/40 bg-[#E45159]/10 text-xs text-[#E45159]">
            {briefingError}
          </div>
        )}

        {aiBriefing ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-[#D9E5F0] border-t border-slate-200 dark:border-[#1A334B] pt-3">
            {aiBriefing}
          </div>
        ) : (
          <div className="text-xs text-slate-500 dark:text-[#8FA6B9] border-t border-slate-200 dark:border-[#1A334B] pt-3">
            Clique em &quot;Gerar Briefing Executivo&quot; para consolidar automaticamente câmbio, juros, inflação, dívida pública, expectativas Focus, risco Monte Carlo e alertas de qualidade em um relatório rastreável.
          </div>
        )}
      </section>
    </div>
  );
}
