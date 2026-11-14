import type { EChartsOption } from 'echarts';
import { Download, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type {
  BrazilPulseReport,
  ConsolidatedSwotReport,
  IndicatorSnapshot,
  Language,
  RiskReport,
  SwotItem,
} from '../../types/sygma';
import { EChartBox } from '../charts/EChartBox';

export type SwotQuadrantKey = 'strengths' | 'weaknesses' | 'opportunities' | 'threats';

export interface CustomSwotNote extends SwotItem {
  id: string;
  quadrant: SwotQuadrantKey;
  createdAt: string;
}

export const SWOT_CUSTOM_STORAGE_KEY = 'sygma_swot_custom_notes';

interface SwotDashboardViewProps {
  snapshots: IndicatorSnapshot[];
  pulse: BrazilPulseReport | null;
  risk: RiskReport | null;
  watchlist: string[];
  language: Language;
  darkMode: boolean;
  onSelectIndicator: (id: string) => void;
  onExportSwotPdf: (
    mergedSwot: {
      strengths: SwotItem[];
      weaknesses: SwotItem[];
      opportunities: SwotItem[];
      threats: SwotItem[];
    },
    filteredSnapshots: IndicatorSnapshot[],
    searchTerm: string
  ) => Promise<void>;
}

export function SwotDashboardView({
  snapshots,
  pulse,
  risk,
  watchlist,
  language,
  darkMode,
  onSelectIndicator,
  onExportSwotPdf,
}: SwotDashboardViewProps) {
  const [swotData, setSwotData] = useState<ConsolidatedSwotReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [quadrantFilter, setQuadrantFilter] = useState<'ALL' | SwotQuadrantKey>('ALL');

  const [customNotes, setCustomNotes] = useState<CustomSwotNote[]>(() => {
    try {
      const saved = localStorage.getItem(SWOT_CUSTOM_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CustomSwotNote[]) : [];
    } catch {
      return [];
    }
  });

  // Form state for adding custom SWOT entry
  const [newQuadrant, setNewQuadrant] = useState<SwotQuadrantKey>('opportunities');
  const [newTitle, setNewTitle] = useState('');
  const [newEvidence, setNewEvidence] = useState('');
  const [newPlainText, setNewPlainText] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(SWOT_CUSTOM_STORAGE_KEY, JSON.stringify(customNotes));
    } catch {
      // Ignore storage error
    }
  }, [customNotes]);

  const loadSwotData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sygmaClient.fetchJson<ConsolidatedSwotReport>('/api/v1/reports/consolidated-swot');
      setSwotData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSwotData();
  }, [loadSwotData]);

  const mergedMatrix = useMemo(() => {
    const base = swotData?.swotMatrix ?? {
      strengths: [],
      weaknesses: [],
      opportunities: [],
      threats: [],
    };
    const appendFor = (q: SwotQuadrantKey, items: SwotItem[]): Array<SwotItem & { customId?: string }> => [
      ...items,
      ...customNotes
        .filter((n) => n.quadrant === q)
        .map((n) => ({
          title: n.title,
          evidence: n.evidence,
          plainLanguage: n.plainLanguage,
          customId: n.id,
        })),
    ];

    return {
      strengths: appendFor('strengths', base.strengths),
      weaknesses: appendFor('weaknesses', base.weaknesses),
      opportunities: appendFor('opportunities', base.opportunities),
      threats: appendFor('threats', base.threats),
    };
  }, [swotData, customNotes]);

  const filteredSnapshots = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const keyIds = new Set([
      'USD_BRL_PTAX',
      'SELIC_META',
      'IPCA_MENSAL',
      'IBOV',
      'DIVIDA_BRUTA_PIB',
      'DESEMPREGO_PNAD',
      'RESERVAS_INT',
      'BALANCA_COMERCIAL',
      'INADIMPLENCIA',
      'IBC_BR',
      'US_10Y',
      ...watchlist,
    ]);
    return snapshots.filter((s) => {
      if (!q) return keyIds.has(s.definition.id);
      return (
        s.definition.code.toLowerCase().includes(q) ||
        s.definition.namePt.toLowerCase().includes(q) ||
        s.definition.nameEn.toLowerCase().includes(q)
      );
    });
  }, [snapshots, watchlist, searchTerm]);

  const handleAddCustomNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newPlainText.trim()) return;
    const item: CustomSwotNote = {
      id: `swot-custom-${Date.now()}`,
      quadrant: newQuadrant,
      title: newTitle.trim(),
      evidence: newEvidence.trim() || 'Nota Analítica Institucional',
      plainLanguage: newPlainText.trim(),
      createdAt: new Date().toISOString(),
    };
    setCustomNotes((prev) => [...prev, item]);
    setNewTitle('');
    setNewEvidence('');
    setNewPlainText('');
  };

  const handleDeleteCustomNote = (id: string) => {
    setCustomNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const handleTriggerPdf = async () => {
    setExporting(true);
    try {
      const stripCustom = (arr: Array<SwotItem & { customId?: string }>): SwotItem[] =>
        arr.map(({ title, evidence, plainLanguage }) => ({ title, evidence, plainLanguage }));
      await onExportSwotPdf(
        {
          strengths: stripCustom(mergedMatrix.strengths),
          weaknesses: stripCustom(mergedMatrix.weaknesses),
          opportunities: stripCustom(mergedMatrix.opportunities),
          threats: stripCustom(mergedMatrix.threats),
        },
        filteredSnapshots,
        searchTerm
      );
    } finally {
      setExporting(false);
    }
  };

  // ECharts diverging bar chart of Brazil Pulse 10 Dimensions (50 = neutral pivot)
  const pulseDivergingOption = useMemo<EChartsOption>(() => {
    const dims = pulse?.dimensions ?? [];
    const sorted = [...dims].sort((a, b) => a.score - b.score);
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      grid: { left: 165, right: 24, top: 16, bottom: 24 },
      xAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: darkMode ? '#1A334B' : '#E2E8F0' } },
        axisLabel: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 10 },
      },
      yAxis: {
        type: 'category',
        data: sorted.map((d) => (language === 'pt' ? d.namePt : d.nameEn)),
        axisLabel: { color: darkMode ? '#E6EEF5' : '#0F172A', fontSize: 11 },
      },
      series: [
        {
          name: 'Score (0-100)',
          type: 'bar',
          data: sorted.map((d) => ({
            value: d.score,
            itemStyle: {
              color: d.score >= 55 ? '#19B779' : d.score >= 45 ? '#00B4D8' : '#E45159',
              borderRadius: [0, 3, 3, 0],
            },
          })),
          markLine: {
            symbol: 'none',
            lineStyle: { color: '#F0B94A', type: 'dashed' },
            data: [{ xAxis: 50 }],
          },
        },
      ],
    };
  }, [pulse, darkMode, language]);

  // ECharts Stress Scenarios Impact Chart
  const stressChartOption = useMemo<EChartsOption>(() => {
    const scenarios = swotData?.stressScenariosPlain ?? [];
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 120, right: 24, top: 16, bottom: 24 },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: darkMode ? '#1A334B' : '#E2E8F0' } },
        axisLabel: {
          color: darkMode ? '#8FA6B9' : '#475569',
          fontSize: 10,
          formatter: '{value}%',
        },
      },
      yAxis: {
        type: 'category',
        data: scenarios.map((s) => `${s.code} · ${s.namePt.split(':')[0]}`),
        axisLabel: { color: darkMode ? '#E6EEF5' : '#0F172A', fontSize: 10 },
      },
      series: [
        {
          name: 'Impacto Carteira %',
          type: 'bar',
          data: scenarios.map((s) => ({
            value: s.estimatedPortfolioImpactPct,
            itemStyle: {
              color: s.estimatedPortfolioImpactPct >= 0 ? '#19B779' : '#E45159',
            },
          })),
        },
      ],
    };
  }, [swotData, darkMode]);

  const filterItem = (item: SwotItem) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      item.plainLanguage.toLowerCase().includes(q) ||
      item.evidence.toLowerCase().includes(q)
    );
  };

  const quadrantConfigs: Array<{
    key: SwotQuadrantKey;
    title: string;
    subtitle: string;
    accentText: string;
    surfaceBg: string;
  }> = [
    {
      key: 'strengths',
      title: 'Forças (Strengths)',
      subtitle: 'Fatores internos positivos que sustentam o Brasil',
      accentText: 'text-[#19B779]',
      surfaceBg: 'bg-emerald-50/40 dark:bg-[#081F2C]',
    },
    {
      key: 'weaknesses',
      title: 'Fraquezas (Weaknesses)',
      subtitle: 'Vulnerabilidades estruturais e pressões domésticas',
      accentText: 'text-[#E45159]',
      surfaceBg: 'bg-rose-50/40 dark:bg-[#16192B]',
    },
    {
      key: 'opportunities',
      title: 'Oportunidades (Opportunities)',
      subtitle: 'Vetores externos e catalisadores favoráveis',
      accentText: 'text-[#00B4D8]',
      surfaceBg: 'bg-sky-50/40 dark:bg-[#082032]',
    },
    {
      key: 'threats',
      title: 'Ameaças (Threats)',
      subtitle: 'Riscos globais, fiscais e cenários de estresse',
      accentText: 'text-[#F0B94A]',
      surfaceBg: 'bg-amber-50/40 dark:bg-[#191F2C]',
    },
  ];

  const visibleQuadrants = quadrantConfigs.filter((q) => quadrantFilter === 'ALL' || quadrantFilter === q.key);

  return (
    <div className="space-y-6">
      {/* Header Action Bar */}
      <div className="p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-mono text-[#00B4D8]">
            SYGMA AIS · INTELIGÊNCIA ESTRATÉGICA DO BRASIL
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-[#E6EEF5]">
            Dashboard SWOT Brasil — Forças, Fraquezas, Oportunidades e Ameaças
          </h1>
          <p className="text-xs text-slate-600 dark:text-[#8FA6B9] leading-relaxed">
            {swotData?.plainLanguageHeadline ??
              'Matriz estratégica alimentada em tempo real pelos indicadores oficiais do BCB, mercados B3/globais, modelo ARIMA/GARCH e testes de estresse.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={loadSwotData}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-slate-200 dark:border-[#1A334B] rounded text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar Matriz
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={handleTriggerPdf}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Gerando PDF…' : 'Exportar SWOT & Snapshots (PDF)'}
          </button>
        </div>
      </div>

      {/* Live Macro Balance Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono tabular-nums text-xs">
        {[
          {
            label: 'Brazil Pulse',
            val: pulse?.compositeScore !== null && pulse?.compositeScore !== undefined ? `${pulse.compositeScore}/100` : 'N/D',
            tone: (pulse?.compositeScore ?? 50) >= 52 ? 'text-[#19B779]' : 'text-[#F0B94A]',
          },
          {
            label: 'Selic Meta',
            val: `${snapshots.find((s) => s.definition.id === 'SELIC_META')?.latest?.value?.toFixed(2) ?? '—'}%`,
            tone: 'text-slate-900 dark:text-[#E6EEF5]',
          },
          {
            label: 'USD / BRL PTAX',
            val: `R$ ${snapshots.find((s) => s.definition.id === 'USD_BRL_PTAX')?.latest?.value?.toFixed(4) ?? '—'}`,
            tone: 'text-[#5CD9F5]',
          },
          {
            label: 'Dívida Bruta/PIB',
            val: `${snapshots.find((s) => s.definition.id === 'DIVIDA_BRUTA_PIB')?.latest?.value?.toFixed(2) ?? '—'}%`,
            tone: 'text-[#E45159]',
          },
          {
            label: 'Reservas Int.',
            val: `US$ ${((snapshots.find((s) => s.definition.id === 'RESERVAS_INT')?.latest?.value ?? 0) / 1000).toFixed(1)} bi`,
            tone: 'text-[#19B779]',
          },
          {
            label: 'VaR MC 95% (1d)',
            val: risk ? `-${risk.metrics.monteCarloVar95Pct.toFixed(2)}%` : '—',
            tone: 'text-[#F0B94A]',
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]"
          >
            <div className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">{kpi.label}</div>
            <div className={`text-sm font-bold mt-0.5 ${kpi.tone}`}>{kpi.val}</div>
          </div>
        ))}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar fatores SWOT, evidências ou indicadores (ex.: Selic, Reservas, China, DBGG)…"
            className="w-full pl-9 pr-3 py-2 text-xs rounded-md border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] text-slate-900 dark:text-[#E6EEF5] focus:outline-none focus:border-[#00B4D8]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-[#061827] rounded-md border border-slate-200 dark:border-[#1A334B]">
          {(
            [
              { id: 'ALL', label: 'Todos Quadrantes' },
              { id: 'strengths', label: 'Forças' },
              { id: 'weaknesses', label: 'Fraquezas' },
              { id: 'opportunities', label: 'Oportunidades' },
              { id: 'threats', label: 'Ameaças' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setQuadrantFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                quadrantFilter === tab.id
                  ? 'bg-[#00B4D8] text-[#061827] font-semibold'
                  : 'text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4-Quadrant Interactive SWOT Grid */}
      <div className={`grid grid-cols-1 ${visibleQuadrants.length > 1 ? 'lg:grid-cols-2' : ''} gap-4`}>
        {visibleQuadrants.map((q) => {
          const items = mergedMatrix[q.key].filter(filterItem);
          return (
            <div
              key={q.key}
              className={`p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] ${q.surfaceBg} space-y-4`}
            >
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 dark:border-[#1A334B] pb-2.5">
                <div>
                  <h2 className={`text-sm font-bold uppercase tracking-wide ${q.accentText}`}>{q.title}</h2>
                  <p className="text-xs text-slate-500 dark:text-[#8FA6B9] mt-0.5">{q.subtitle}</p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-[#8FA6B9]">
                  {items.length} fatores
                </span>
              </div>

              <div className="divide-y divide-slate-200/70 dark:divide-[#1A334B]/70">
                {items.map((item, idx) => (
                  <div key={`${item.title}-${idx}`} className="py-3 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">{item.title}</div>
                      {item.customId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomNote(item.customId!)}
                          title="Remover anotação SWOT personalizada"
                          className="text-slate-400 hover:text-[#E45159] p-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-700 dark:text-[#C5D6E5] leading-relaxed">{item.plainLanguage}</p>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">
                      Evidência: {item.evidence}
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="py-4 text-xs text-slate-500 dark:text-[#8FA6B9]">
                    Nenhum fator correspondente ao filtro atual neste quadrante.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quantitative Balance Charts: Pulse Dimensions + Stress Scenarios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EChartBox
          title="Forças vs Vulnerabilidades (10 Dimensões Brazil Pulse)"
          subtitle="Linha tracejada em 50 pontos marca a média histórica neutra (acima = força relativa; abaixo = pressão)."
          option={pulseDivergingOption}
          height={300}
          darkMode={darkMode}
        />

        <EChartBox
          title="Mapa de Ameaças Quantificadas (Cenários de Estresse A–J)"
          subtitle="Impacto percentual simulado sobre a carteira mista de referência (IBOV, USD/BRL, Brent, VALE3)."
          option={stressChartOption}
          height={300}
          darkMode={darkMode}
        />
      </div>

      {/* Add Custom Institutional SWOT Item (Included in PDF Export) */}
      <form
        onSubmit={handleAddCustomNote}
        className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3"
      >
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
            Adicionar Fator Analítico à Matriz SWOT (Incluído na Exportação PDF)
          </h3>
          <p className="text-xs text-slate-500 dark:text-[#8FA6B9]">
            Personalize a matriz com premissas setoriais ou decisões do comitê antes de gerar o PDF institucional.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <select
            value={newQuadrant}
            onChange={(e) => setNewQuadrant(e.target.value as SwotQuadrantKey)}
            className="px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
          >
            <option value="strengths">Forças (Strengths)</option>
            <option value="weaknesses">Fraquezas (Weaknesses)</option>
            <option value="opportunities">Oportunidades (Opportunities)</option>
            <option value="threats">Ameaças (Threats)</option>
          </select>

          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título do fator SWOT..."
            className="px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
          />

          <input
            type="text"
            value={newEvidence}
            onChange={(e) => setNewEvidence(e.target.value)}
            placeholder="Evidência / indicador (opcional)..."
            className="px-3 py-2 rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
          />

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0A2540] text-[#5CD9F5] border border-[#1E3A54] rounded hover:border-[#00B4D8]"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar ao SWOT
          </button>
        </div>

        <input
          type="text"
          value={newPlainText}
          onChange={(e) => setNewPlainText(e.target.value)}
          placeholder="Explicação em linguagem simples (impacto prático)..."
          className="w-full px-3 py-2 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5]"
        />
      </form>

      {/* Active Supporting Indicators Snapshot Table */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-[#E6EEF5]">
            Indicadores-Chave Vinculados à Matriz SWOT ({filteredSnapshots.length})
          </h3>
          <span className="text-xs font-mono text-slate-500 dark:text-[#8FA6B9]">
            Clique para abrir série histórica detalhada
          </span>
        </div>
        <table className="w-full text-xs font-mono tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 dark:border-[#1A334B] text-slate-500 dark:text-[#8FA6B9]">
              <th className="py-2 text-left">Código</th>
              <th className="py-2 text-left font-sans">Indicador</th>
              <th className="py-2 text-right">Valor</th>
              <th className="py-2 text-right">Var. %</th>
              <th className="py-2 text-right">Data Ref.</th>
              <th className="py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
            {filteredSnapshots.map((s) => (
              <tr
                key={s.definition.id}
                onClick={() => onSelectIndicator(s.definition.id)}
                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-[#061827]/70"
              >
                <td className="py-2 font-bold text-[#00B4D8]">{s.definition.code}</td>
                <td className="py-2 font-sans text-slate-900 dark:text-[#E6EEF5]">
                  {language === 'pt' ? s.definition.namePt : s.definition.nameEn}
                </td>
                <td className="py-2 text-right">
                  {s.latest ? `${s.latest.value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${s.definition.unit}` : 'MISSING'}
                </td>
                <td
                  className={`py-2 text-right font-semibold ${
                    (s.changePct ?? 0) >= 0 ? 'text-[#19B779]' : 'text-[#E45159]'
                  }`}
                >
                  {s.changePct !== null ? `${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}%` : '—'}
                </td>
                <td className="py-2 text-right text-slate-500 dark:text-[#8FA6B9]">{s.latest?.date ?? '—'}</td>
                <td className="py-2 text-right text-slate-600 dark:text-[#8FA6B9]">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
