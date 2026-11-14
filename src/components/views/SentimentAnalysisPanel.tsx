import type * as echarts from 'echarts';
import { RefreshCw, Send, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type {
  Language,
  MonetaryStance,
  SentimentAnalysisReport,
  SentimentPolarity,
  TextSentimentScore,
} from '../../types/sygma';
import { EChartBox } from '../charts/EChartBox';

interface SentimentAnalysisPanelProps {
  darkMode: boolean;
  language: Language;
}

function getScoreColor(score: number): string {
  if (score >= 60) return 'text-[#19B779]';
  if (score <= 40) return 'text-[#E45159]';
  return 'text-[#F0B94A]';
}

function getPolarityColor(polarity: SentimentPolarity): string {
  if (polarity === 'POSITIVE') return 'text-[#19B779]';
  if (polarity === 'NEGATIVE') return 'text-[#E45159]';
  if (polarity === 'MIXED') return 'text-[#F0B94A]';
  return 'text-[#8FA6B9]';
}

function getStanceColor(stance: MonetaryStance): string {
  if (stance === 'HAWKISH') return 'text-[#E45159]';
  if (stance === 'DOVISH') return 'text-[#00B4D8]';
  return 'text-[#8FA6B9]';
}

export function SentimentAnalysisPanel({ darkMode, language }: SentimentAnalysisPanelProps) {
  const [report, setReport] = useState<SentimentAnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sampleText, setSampleText] = useState(
    'O Comitê avalia que a persistência da pressão inflacionária e o risco fiscal exigem vigilância e possível aperto monetário adicional para assegurar a convergência da inflação à meta.'
  );
  const [customResult, setCustomResult] = useState<TextSentimentScore | null>(null);
  const [analyzingText, setAnalyzingText] = useState(false);

  const loadSentiment = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sygmaClient.fetchJson<SentimentAnalysisReport>('/api/v1/sentiment');
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao calcular análise de sentimento');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSentiment();
  }, [loadSentiment]);

  const handleAnalyzeCustomText = async () => {
    const clean = sampleText.trim();
    if (clean.length < 4) return;
    setAnalyzingText(true);
    try {
      const res = await sygmaClient.fetchJson<TextSentimentScore>('/api/v1/sentiment/analyze-text', {
        method: 'POST',
        body: JSON.stringify({ text: clean }),
      });
      setCustomResult(res);
    } finally {
      setAnalyzingText(false);
    }
  };

  const trajectoryOption = useMemo<echarts.EChartsOption>(() => {
    const pts = report?.historicalMarketSentiment ?? [];
    const dates = pts.map((p) => p.date);
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: [
          language === 'pt' ? 'Índice Sentimento (Composto)' : 'Composite Sentiment',
          language === 'pt' ? 'Renda Variável (IBOV)' : 'Equities (IBOV)',
          language === 'pt' ? 'Fluxo Câmbio (BRL)' : 'FX Flow (BRL)',
          language === 'pt' ? 'Global (S&P 500)' : 'Global (S&P 500)',
        ],
        textStyle: { color: darkMode ? '#8FA6B9' : '#475569', fontSize: 11 },
        top: 0,
      },
      grid: { left: 40, right: 16, top: 34, bottom: 26 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: darkMode ? '#8FA6B9' : '#64748B', fontSize: 10 },
        splitLine: { lineStyle: { color: darkMode ? 'rgba(143,166,185,0.08)' : 'rgba(15,23,42,0.06)' } },
      },
      series: [
        {
          name: language === 'pt' ? 'Índice Sentimento (Composto)' : 'Composite Sentiment',
          type: 'line',
          smooth: true,
          data: pts.map((p) => p.marketSentimentIndex),
          itemStyle: { color: '#00B4D8' },
          lineStyle: { width: 2.5 },
          areaStyle: { color: 'rgba(0, 180, 216, 0.12)' },
        },
        {
          name: language === 'pt' ? 'Renda Variável (IBOV)' : 'Equities (IBOV)',
          type: 'line',
          showSymbol: false,
          data: pts.map((p) => p.equitiesComponent),
          itemStyle: { color: '#19B779' },
          lineStyle: { width: 1.5, type: 'dashed' },
        },
        {
          name: language === 'pt' ? 'Fluxo Câmbio (BRL)' : 'FX Flow (BRL)',
          type: 'line',
          showSymbol: false,
          data: pts.map((p) => p.fxComponent),
          itemStyle: { color: '#F0B94A' },
          lineStyle: { width: 1.5, type: 'dashed' },
        },
        {
          name: language === 'pt' ? 'Global (S&P 500)' : 'Global (S&P 500)',
          type: 'line',
          showSymbol: false,
          data: pts.map((p) => p.globalRatesComponent),
          itemStyle: { color: '#A855F7' },
          lineStyle: { width: 1.3, type: 'dotted' },
        },
      ],
    };
  }, [report, darkMode, language]);

  return (
    <section className="p-4 sm:p-5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#00B4D8]">
            {language === 'pt'
              ? 'MOTOR HÍBRIDO NLP & REGIME QUANTITATIVO DE MERCADO'
              : 'HYBRID MACRO NLP & QUANTITATIVE SENTIMENT ENGINE'}
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-[#E6EEF5] mt-0.5">
            {language === 'pt'
              ? 'Análise de Sentimento Macroeconômico & Tom de Política Monetária (COPOM / BCB)'
              : 'Macroeconomic Sentiment Analysis & Monetary Policy Stance'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#8FA6B9] mt-0.5">
            {report?.methodologyNote ??
              'Combina pontuação léxica auditável sobre comunicados oficiais do Banco Central com dinâmica de fluxos (IBOV, PTAX, S&P 500, US 10Y e Focus).'}
          </p>
        </div>
        <button
          type="button"
          onClick={loadSentiment}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0A2540] hover:bg-[#103456] text-[#5CD9F5] border border-[#1E3A54] rounded transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {language === 'pt' ? 'Recalcular Sentimento' : 'Refresh Sentiment'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded border border-[#E45159]/40 bg-[#E45159]/10 text-xs text-[#E45159]">
          {error}
        </div>
      )}

      {report && (
        <>
          {/* 4-Card Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] space-y-1">
              <div className="text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9]">
                {language === 'pt' ? 'Score Composto de Sentimento' : 'Composite Sentiment Score'}
              </div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${getScoreColor(report.compositeScore)}`}>
                {report.compositeScore.toFixed(1)}
                <span className="text-xs font-normal text-slate-500 dark:text-[#8FA6B9]"> / 100</span>
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-[#C5D6E5]">
                {language === 'pt' ? report.regimeLabelPt : report.regimeLabelEn}
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] space-y-1">
              <div className="text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9]">
                {language === 'pt' ? 'Viés Monetário Dominante' : 'Monetary Policy Tilt'}
              </div>
              <div className={`text-xl font-bold font-mono ${getStanceColor(report.policyTone.dominantStance)}`}>
                {report.policyTone.dominantStance}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-[#8FA6B9]">
                Tilt Líquido: {report.policyTone.netMonetaryTilt > 0 ? '+' : ''}
                {report.policyTone.netMonetaryTilt.toFixed(1)} · H:{report.policyTone.hawkishCount} / D:
                {report.policyTone.dovishCount}
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] space-y-1">
              <div className="text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9]">
                {language === 'pt' ? 'Score NLP Comunicados BCB' : 'BCB News NLP Score'}
              </div>
              <div
                className={`text-xl font-bold font-mono tabular-nums ${getScoreColor(
                  report.newsDistribution.avgNewsScore
                )}`}
              >
                {report.newsDistribution.avgNewsScore.toFixed(1)}
                <span className="text-xs font-normal text-slate-500 dark:text-[#8FA6B9]"> / 100</span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-[#8FA6B9]">
                {report.newsDistribution.totalArticles} artigos · +{report.newsDistribution.positive} / -
                {report.newsDistribution.negative} / ={report.newsDistribution.neutral}
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] space-y-1">
              <div className="text-[11px] font-medium text-slate-500 dark:text-[#8FA6B9]">
                {language === 'pt' ? 'Distribuição de Polaridade' : 'Polarity Distribution'}
              </div>
              <div className="grid grid-cols-4 gap-1 pt-0.5 text-center font-mono tabular-nums">
                <div>
                  <div className="text-sm font-bold text-[#19B779]">{report.newsDistribution.positive}</div>
                  <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">POS</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#E45159]">{report.newsDistribution.negative}</div>
                  <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">NEG</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#F0B94A]">{report.newsDistribution.mixed}</div>
                  <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">MIX</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#8FA6B9]">{report.newsDistribution.neutral}</div>
                  <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">NEU</div>
                </div>
              </div>
            </div>
          </div>

          {/* 5-Pillar Breakdown & 30-Day Sentiment Trajectory */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className="xl:col-span-6 space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-[#8FA6B9]">
                {language === 'pt'
                  ? 'Decomposição dos 5 Pilares de Sentimento'
                  : '5-Pillar Sentiment Decomposition'}
              </h3>
              <div className="divide-y divide-slate-200 dark:divide-[#1A334B] border border-slate-200 dark:border-[#1A334B] rounded-lg bg-slate-50/70 dark:bg-[#061827]">
                {report.pillars.map((p) => (
                  <div key={p.id} className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="font-semibold text-slate-900 dark:text-[#E6EEF5]">
                        {language === 'pt' ? p.namePt : p.nameEn}
                        <span className="ml-1.5 font-mono text-[10px] text-slate-500 dark:text-[#8FA6B9]">
                          ({Math.round(p.weight * 100)}%)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                        <span className="text-[11px] text-slate-500 dark:text-[#8FA6B9]">
                          {language === 'pt' ? p.signalLabelPt : p.signalLabelEn}
                        </span>
                        <span className={`font-bold ${getScoreColor(p.score)}`}>{p.score.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded bg-slate-200 dark:bg-[#102438] overflow-hidden">
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${Math.max(4, Math.min(100, p.score))}%`,
                          backgroundColor: p.score >= 60 ? '#19B779' : p.score <= 40 ? '#E45159' : '#00B4D8',
                        }}
                      />
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-[#8FA6B9]">{p.evidence}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="xl:col-span-6">
              <EChartBox
                title={
                  language === 'pt'
                    ? 'Trajetória Histórica do Sentimento de Mercado (30 Pregões)'
                    : 'Historical Market Sentiment Trajectory (30 Trading Days)'
                }
                subtitle={
                  language === 'pt'
                    ? 'Construído via séries reais diárias de IBOV, USD/BRL PTAX e S&P 500 (escala 0–100)'
                    : 'Derived from real daily IBOV, USD/BRL PTAX & S&P 500 series (0–100 scale)'
                }
                option={trajectoryOption}
                height={285}
                darkMode={darkMode}
                intelligenceNote={{
                  whatItShows:
                    'Leitura de 50 representa equilíbrio neutro; acima de 60 indica apetite construtivo (Risk-On) e abaixo de 40 sinaliza aversão a risco.',
                  sourceAndTime: `Atualizado: ${report.generatedAt.slice(0, 19).replace('T', ' ')} UTC`,
                }}
              />
            </div>
          </div>

          {/* Interactive Statement / Headline NLP Analyzer */}
          <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#00B4D8]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-[#E6EEF5]">
                  {language === 'pt'
                    ? 'Analisador Léxico Interativo (Atas do COPOM, Notas do BCB ou Manchetes)'
                    : 'Interactive Macro Lexicon Analyzer (COPOM Minutes, BCB Notes or Headlines)'}
                </h3>
              </div>
              <button
                type="button"
                disabled={analyzingText || sampleText.trim().length < 4}
                onClick={handleAnalyzeCustomText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#00B4D8] hover:bg-[#5CD9F5] text-[#061827] rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                {analyzingText ? 'Pontuando…' : language === 'pt' ? 'Avaliar Texto via Motor NLP' : 'Score Text'}
              </button>
            </div>
            <textarea
              rows={2}
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="Cole aqui um trecho de comunicado do COPOM, nota fiscal ou manchete econômica..."
              className="w-full px-3 py-2 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] text-slate-900 dark:text-[#E6EEF5] focus:outline-none focus:border-[#00B4D8]"
            />
            {customResult && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1 text-xs font-mono tabular-nums">
                <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                  <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">POLARIDADE & SCORE</div>
                  <div className={`font-bold ${getPolarityColor(customResult.polarity)}`}>
                    {customResult.polarity} ({customResult.scoreNormalized}/100)
                  </div>
                </div>
                <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                  <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">VIÉS MONETÁRIO</div>
                  <div className={`font-bold ${getStanceColor(customResult.monetaryStance)}`}>
                    {customResult.monetaryStance} (H:{customResult.hawkishScore} / D:{customResult.dovishScore})
                  </div>
                </div>
                <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438]">
                  <div className="text-[10px] text-slate-500 dark:text-[#8FA6B9]">CONFIANÇA & NET</div>
                  <div className="font-bold text-slate-900 dark:text-[#E6EEF5]">
                    {Math.round(customResult.confidence * 100)}% · Net {customResult.netScore > 0 ? '+' : ''}
                    {customResult.netScore}
                  </div>
                </div>
                <div className="p-2.5 rounded border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] text-[11px] font-sans">
                  <div className="text-[10px] font-mono text-slate-500 dark:text-[#8FA6B9]">GATILHOS DETECTADOS</div>
                  <div className="text-slate-700 dark:text-[#C5D6E5] truncate">
                    {[
                      ...customResult.positiveHits.map((t) => `+${t}`),
                      ...customResult.negativeHits.map((t) => `-${t}`),
                      ...customResult.hawkishHits.map((t) => `HAWK:${t}`),
                      ...customResult.dovishHits.map((t) => `DOVE:${t}`),
                    ].join(' · ') || 'Nenhum termo macroeconômico forte'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Scored BCB News Table */}
          {report.scoredNews.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-[#8FA6B9]">
                {language === 'pt'
                  ? `Comunicados Oficiais Pontuados (${report.scoredNews.length})`
                  : `Scored Official Communications (${report.scoredNews.length})`}
              </h3>
              <div className="overflow-x-auto border border-slate-200 dark:border-[#1A334B] rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-500 dark:text-[#8FA6B9]">
                      <th className="py-2 px-3 text-left">Data</th>
                      <th className="py-2 px-3 text-left">Comunicado / Manchete</th>
                      <th className="py-2 px-3 text-left">Polaridade</th>
                      <th className="py-2 px-3 text-left">Viés Monetário</th>
                      <th className="py-2 px-3 text-right">Score</th>
                      <th className="py-2 px-3 text-left">Termos Léxicos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1A334B]/50">
                    {report.scoredNews.slice(0, 12).map((item) => {
                      const triggers = [
                        ...item.analysis.positiveHits.map((h) => `+${h}`),
                        ...item.analysis.negativeHits.map((h) => `-${h}`),
                        ...item.analysis.hawkishHits.map((h) => `H:${h}`),
                        ...item.analysis.dovishHits.map((h) => `D:${h}`),
                      ];
                      return (
                        <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-[#061827]/60">
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-500 dark:text-[#8FA6B9] whitespace-nowrap">
                            {item.publishedAt.slice(0, 10)}
                          </td>
                          <td className="py-2 px-3 max-w-[360px]">
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-slate-900 dark:text-[#E6EEF5] hover:text-[#00B4D8] line-clamp-1"
                            >
                              {item.title}
                            </a>
                          </td>
                          <td className={`py-2 px-3 font-mono font-semibold whitespace-nowrap ${getPolarityColor(item.analysis.polarity)}`}>
                            {item.analysis.polarity}
                          </td>
                          <td className={`py-2 px-3 font-mono font-semibold whitespace-nowrap ${getStanceColor(item.analysis.monetaryStance)}`}>
                            {item.analysis.monetaryStance}
                          </td>
                          <td className={`py-2 px-3 text-right font-mono font-bold tabular-nums ${getScoreColor(item.analysis.scoreNormalized)}`}>
                            {item.analysis.scoreNormalized.toFixed(1)}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-500 dark:text-[#8FA6B9] max-w-[220px] truncate">
                            {triggers.length > 0 ? triggers.join(', ') : 'Neutro / Descritivo'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
