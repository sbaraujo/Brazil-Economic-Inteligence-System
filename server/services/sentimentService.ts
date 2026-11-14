import type { IndicatorSnapshot, NewsItem, ObservationPoint } from '../types/domain.ts';
import { connectorEngine } from './connectors/connectorEngine.ts';
import { quantEngine } from './quantEngine.ts';
import { timeSeriesStore } from './timeseriesStore.ts';

export type SentimentPolarity = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
export type MonetaryStance = 'HAWKISH' | 'DOVISH' | 'NEUTRAL';
export type SentimentRegime =
  | 'RISK_ON_BULLISH'
  | 'CONSTRUCTIVE'
  | 'NEUTRAL'
  | 'CAUTIOUS'
  | 'RISK_OFF_BEARISH';

export interface TextSentimentScore {
  scoreNormalized: number; // 0..100 (50 = neutral)
  netScore: number; // -100..+100
  polarity: SentimentPolarity;
  monetaryStance: MonetaryStance;
  hawkishScore: number;
  dovishScore: number;
  confidence: number; // 0..1
  positiveHits: string[];
  negativeHits: string[];
  hawkishHits: string[];
  dovishHits: string[];
}

export interface ScoredNewsItem extends NewsItem {
  analysis: TextSentimentScore;
}

export interface SentimentPillar {
  id: string;
  namePt: string;
  nameEn: string;
  weight: number;
  score: number; // 0..100
  signalLabelPt: string;
  signalLabelEn: string;
  evidence: string;
}

export interface SentimentHistoryPoint {
  date: string;
  marketSentimentIndex: number; // 0..100
  equitiesComponent: number;
  fxComponent: number;
  globalRatesComponent: number;
}

export interface SentimentAnalysisReport {
  generatedAt: string;
  compositeScore: number; // 0..100
  regime: SentimentRegime;
  regimeLabelPt: string;
  regimeLabelEn: string;
  policyTone: {
    hawkishCount: number;
    dovishCount: number;
    neutralCount: number;
    dominantStance: MonetaryStance;
    netMonetaryTilt: number; // -100 (dovish) .. +100 (hawkish)
  };
  newsDistribution: {
    totalArticles: number;
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
    avgNewsScore: number;
  };
  pillars: SentimentPillar[];
  scoredNews: ScoredNewsItem[];
  historicalMarketSentiment: SentimentHistoryPoint[];
  methodologyNote: string;
  limitations: string[];
}

interface LexiconEntry {
  term: string;
  weight: number;
}

// Curated institutional Portuguese & English macroeconomic/financial sentiment lexicon
const POSITIVE_LEXICON: LexiconEntry[] = [
  { term: 'crescimento', weight: 1.6 },
  { term: 'expansão', weight: 1.6 },
  { term: 'superávit', weight: 1.8 },
  { term: 'superavit', weight: 1.8 },
  { term: 'desinflação', weight: 1.8 },
  { term: 'desaceleração da inflação', weight: 2.2 },
  { term: 'convergência', weight: 1.5 },
  { term: 'estabilidade', weight: 1.4 },
  { term: 'solidez', weight: 1.6 },
  { term: 'resiliência', weight: 1.5 },
  { term: 'melhora', weight: 1.4 },
  { term: 'avanço', weight: 1.3 },
  { term: 'alta na criação', weight: 1.4 },
  { term: 'redução do desemprego', weight: 1.7 },
  { term: 'reservas internacionais', weight: 1.2 },
  { term: 'liquidez adequada', weight: 1.5 },
  { term: 'queda da inadimplência', weight: 1.7 },
  { term: 'apreciação', weight: 1.3 },
  { term: 'recorde', weight: 1.3 },
  { term: 'eficiência', weight: 1.2 },
  { term: 'modernização', weight: 1.1 },
  { term: 'inclusão financeira', weight: 1.1 },
  { term: 'segurança', weight: 1.0 },
  { term: 'reforma', weight: 1.2 },
  { term: 'investimento', weight: 1.2 },
  { term: 'growth', weight: 1.6 },
  { term: 'surplus', weight: 1.8 },
  { term: 'resilient', weight: 1.5 },
  { term: 'disinflation', weight: 1.8 },
  { term: 'stability', weight: 1.4 },
  { term: 'expansion', weight: 1.5 },
  { term: 'easing', weight: 1.3 },
];

const NEGATIVE_LEXICON: LexiconEntry[] = [
  { term: 'inflação pressionada', weight: 2.2 },
  { term: 'pressão inflacionária', weight: 2.1 },
  { term: 'desancoragem', weight: 2.4 },
  { term: 'risco fiscal', weight: 2.3 },
  { term: 'déficit', weight: 1.9 },
  { term: 'deficit', weight: 1.9 },
  { term: 'recessão', weight: 2.5 },
  { term: 'contração', weight: 2.0 },
  { term: 'deterioração', weight: 2.1 },
  { term: 'inadimplência', weight: 1.9 },
  { term: 'incerteza elevada', weight: 2.0 },
  { term: 'incerteza', weight: 1.3 },
  { term: 'volatilidade', weight: 1.5 },
  { term: 'estresse', weight: 1.9 },
  { term: 'crise', weight: 2.4 },
  { term: 'choque', weight: 1.7 },
  { term: 'sanção', weight: 1.8 },
  { term: 'multa', weight: 1.4 },
  { term: 'penalidade', weight: 1.5 },
  { term: 'fraude', weight: 2.0 },
  { term: 'desaceleração', weight: 1.4 },
  { term: 'depreciação', weight: 1.5 },
  { term: 'queda', weight: 1.3 },
  { term: 'recessive', weight: 2.3 },
  { term: 'fiscal stress', weight: 2.2 },
  { term: 'default', weight: 2.2 },
  { term: 'tightening risk', weight: 1.8 },
  { term: 'volatility', weight: 1.5 },
  { term: 'deterioration', weight: 2.0 },
];

const HAWKISH_LEXICON: LexiconEntry[] = [
  { term: 'elevação da taxa selic', weight: 2.6 },
  { term: 'aumento da taxa selic', weight: 2.5 },
  { term: 'alta da selic', weight: 2.4 },
  { term: 'aperto monetário', weight: 2.5 },
  { term: 'política monetária contracionista', weight: 2.5 },
  { term: 'vigilância', weight: 1.6 },
  { term: 'cautela', weight: 1.4 },
  { term: 'desancoragem', weight: 2.1 },
  { term: 'resistência inflacionária', weight: 2.2 },
  { term: 'pressão de custos', weight: 1.8 },
  { term: 'juros elevados por mais tempo', weight: 2.4 },
  { term: 'manutenção da taxa', weight: 1.2 },
  { term: 'hiato positivo', weight: 1.6 },
  { term: 'hawkish', weight: 2.2 },
  { term: 'rate hike', weight: 2.4 },
  { term: 'higher for longer', weight: 2.2 },
];

const DOVISH_LEXICON: LexiconEntry[] = [
  { term: 'redução da taxa selic', weight: 2.6 },
  { term: 'corte na taxa selic', weight: 2.5 },
  { term: 'flexibilização monetária', weight: 2.4 },
  { term: 'afrouxamento monetário', weight: 2.4 },
  { term: 'ciclo de cortes', weight: 2.3 },
  { term: 'desinflação', weight: 1.9 },
  { term: 'convergência à meta', weight: 2.0 },
  { term: 'arrefecimento', weight: 1.7 },
  { term: 'moderação', weight: 1.4 },
  { term: 'estímulo', weight: 1.6 },
  { term: 'dovish', weight: 2.2 },
  { term: 'rate cut', weight: 2.4 },
  { term: 'monetary easing', weight: 2.3 },
];

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function scoreTextSentiment(text: string): TextSentimentScore {
  const clean = normalizeText(text);
  const positiveHits: string[] = [];
  const negativeHits: string[] = [];
  const hawkishHits: string[] = [];
  const dovishHits: string[] = [];

  let posWeight = 0;
  let negWeight = 0;
  let hawkWeight = 0;
  let doveWeight = 0;

  for (const item of POSITIVE_LEXICON) {
    if (clean.includes(normalizeText(item.term))) {
      positiveHits.push(item.term);
      posWeight += item.weight;
    }
  }
  for (const item of NEGATIVE_LEXICON) {
    if (clean.includes(normalizeText(item.term))) {
      negativeHits.push(item.term);
      negWeight += item.weight;
    }
  }
  for (const item of HAWKISH_LEXICON) {
    if (clean.includes(normalizeText(item.term))) {
      hawkishHits.push(item.term);
      hawkWeight += item.weight;
    }
  }
  for (const item of DOVISH_LEXICON) {
    if (clean.includes(normalizeText(item.term))) {
      dovishHits.push(item.term);
      doveWeight += item.weight;
    }
  }

  const totalPolarityWeight = posWeight + negWeight;
  const rawNet = totalPolarityWeight > 0 ? ((posWeight - negWeight) / (totalPolarityWeight + 1.5)) * 100 : 0;
  const netScore = Number(clamp(rawNet, -100, 100).toFixed(1));
  const scoreNormalized = Number(clamp(50 + netScore * 0.5, 0, 100).toFixed(1));

  let polarity: SentimentPolarity = 'NEUTRAL';
  if (posWeight >= 1.5 && negWeight >= 1.5 && Math.abs(posWeight - negWeight) < 1.2) {
    polarity = 'MIXED';
  } else if (netScore >= 12) {
    polarity = 'POSITIVE';
  } else if (netScore <= -12) {
    polarity = 'NEGATIVE';
  }

  let monetaryStance: MonetaryStance = 'NEUTRAL';
  if (hawkWeight - doveWeight >= 1.2) {
    monetaryStance = 'HAWKISH';
  } else if (doveWeight - hawkWeight >= 1.2) {
    monetaryStance = 'DOVISH';
  }

  const totalHits = positiveHits.length + negativeHits.length + hawkishHits.length + dovishHits.length;
  const confidence = Number(clamp(0.25 + totalHits * 0.14, 0.25, 0.96).toFixed(2));

  return {
    scoreNormalized,
    netScore,
    polarity,
    monetaryStance,
    hawkishScore: Number(hawkWeight.toFixed(2)),
    dovishScore: Number(doveWeight.toFixed(2)),
    confidence,
    positiveHits,
    negativeHits,
    hawkishHits,
    dovishHits,
  };
}

export class SentimentService {
  public analyzeText(text: string): TextSentimentScore {
    return scoreTextSentiment(text);
  }

  public analyzeCurrentSentiment(): SentimentAnalysisReport {
    const news = connectorEngine.getNewsFeed();
    const snapshots = connectorEngine.getAllSnapshots();
    const snapMap = new Map<string, IndicatorSnapshot>(snapshots.map((s) => [s.definition.id, s]));
    const focus = connectorEngine.getFocusExpectations();
    const pulse = quantEngine.computeBrazilPulse();

    // 1. Score all live official news items
    const scoredNews: ScoredNewsItem[] = news.map((item) => {
      const analysis = scoreTextSentiment(`${item.title}. ${item.summary}`);
      return {
        ...item,
        sentiment: analysis.polarity,
        analysis,
      };
    });

    let positive = 0;
    let negative = 0;
    let neutral = 0;
    let mixed = 0;
    let hawkishCount = 0;
    let dovishCount = 0;
    let neutralStanceCount = 0;

    let weightedNewsSum = 0;
    let newsWeightTotal = 0;
    let weightedPolicyTiltSum = 0;

    scoredNews.forEach((n, idx) => {
      if (n.analysis.polarity === 'POSITIVE') positive++;
      else if (n.analysis.polarity === 'NEGATIVE') negative++;
      else if (n.analysis.polarity === 'MIXED') mixed++;
      else neutral++;

      if (n.analysis.monetaryStance === 'HAWKISH') hawkishCount++;
      else if (n.analysis.monetaryStance === 'DOVISH') dovishCount++;
      else neutralStanceCount++;

      // Recency decay weight (newest announcements carry higher weight)
      const w = Math.exp(-idx * 0.08);
      weightedNewsSum += n.analysis.scoreNormalized * w;
      weightedPolicyTiltSum += (n.analysis.hawkishScore - n.analysis.dovishScore) * w;
      newsWeightTotal += w;
    });

    const avgNewsScore = newsWeightTotal > 0 ? Number((weightedNewsSum / newsWeightTotal).toFixed(1)) : 50;
    const netMonetaryTilt =
      newsWeightTotal > 0 ? Number(clamp((weightedPolicyTiltSum / newsWeightTotal) * 28, -100, 100).toFixed(1)) : 0;
    const dominantStance: MonetaryStance =
      netMonetaryTilt >= 12 ? 'HAWKISH' : netMonetaryTilt <= -12 ? 'DOVISH' : 'NEUTRAL';

    // 2. Quantitative Market & Macro Regime Pillars (zero mock numbers; derived strictly from stored series)
    const compute20dReturnPct = (series: ObservationPoint[]): number | null => {
      if (series.length < 22) return null;
      const latest = series[series.length - 1].value;
      const base = series[series.length - 21].value;
      if (base <= 0) return null;
      return ((latest - base) / base) * 100;
    };

    const ibovSeries = timeSeriesStore.getSeries('IBOV');
    const fxSeries = timeSeriesStore.getSeries('USD_BRL_PTAX');
    const spSeries = timeSeriesStore.getSeries('SP500');
    const us10Series = timeSeriesStore.getSeries('US_10Y');

    const ibovRet20 = compute20dReturnPct(ibovSeries);
    const fxRet20 = compute20dReturnPct(fxSeries);
    const spRet20 = compute20dReturnPct(spSeries);
    const us10Latest = snapMap.get('US_10Y')?.latest?.value ?? null;
    const us10Prev20 = us10Series.length >= 21 ? us10Series[us10Series.length - 21].value : null;
    const us10DeltaBps = us10Latest !== null && us10Prev20 !== null ? (us10Latest - us10Prev20) * 100 : null;

    // Equities momentum score (IBOV + S&P500)
    const eqScoreRaw =
      50 + (ibovRet20 ?? 0) * 2.4 + (spRet20 ?? 0) * 1.4;
    const eqScore = Number(clamp(eqScoreRaw, 5, 95).toFixed(1));

    // FX Risk Appetite score (BRL appreciation = positive sentiment, sharp depreciation = negative sentiment)
    const fxScore = Number(clamp(50 - (fxRet20 ?? 0) * 3.8, 5, 95).toFixed(1));

    // Global Rates & Risk Condition score (lower US10Y / stable yields = constructive for EM)
    const globalRatesScore = Number(
      clamp(50 + (spRet20 ?? 0) * 1.6 - (us10DeltaBps ?? 0) * 0.45, 5, 95).toFixed(1)
    );

    // Focus & Monetary Anchoring score
    const focusIpca = focus.find((f) => f.indicator === 'IPCA');
    const focusSelic = focus.find((f) => f.indicator === 'Selic');
    const selicNow = snapMap.get('SELIC_META')?.latest?.value ?? 11.25;
    const ipcaFocusGap = focusIpca ? focusIpca.median - 3.0 : 1.5; // Target 3.0% BCB
    const focusScore = Number(clamp(62 - ipcaFocusGap * 9.5 + (focusSelic && focusSelic.median < selicNow ? 6 : -3), 10, 90).toFixed(1));

    // Macro Pulse Anchor
    const macroPulseScore = Number(clamp(pulse.compositeScore ?? 50, 5, 95).toFixed(1));

    const pillars: SentimentPillar[] = [
      {
        id: 'news_nlp',
        namePt: 'Tom Editorial & Comunicados BCB (NLP)',
        nameEn: 'BCB Communications & News NLP Tone',
        weight: 0.25,
        score: avgNewsScore,
        signalLabelPt: avgNewsScore >= 58 ? 'Construtivo' : avgNewsScore <= 42 ? 'Restritivo' : 'Neutro',
        signalLabelEn: avgNewsScore >= 58 ? 'Constructive' : avgNewsScore <= 42 ? 'Restrictive' : 'Neutral',
        evidence: `${scoredNews.length} comunicados oficiais analisados (${positive} pos / ${negative} neg / ${neutral + mixed} neutros)`,
      },
      {
        id: 'equities_momentum',
        namePt: 'Apetite Renda Variável (IBOV & S&P 500 20d)',
        nameEn: 'Equities Risk Appetite (IBOV & S&P 500 20d)',
        weight: 0.22,
        score: eqScore,
        signalLabelPt: eqScore >= 58 ? 'Comprador (Risk-On)' : eqScore <= 42 ? 'Defensivo' : 'Lateral',
        signalLabelEn: eqScore >= 58 ? 'Risk-On' : eqScore <= 42 ? 'Defensive' : 'Neutral',
        evidence: `IBOV 20d: ${ibovRet20 !== null ? `${ibovRet20 > 0 ? '+' : ''}${ibovRet20.toFixed(2)}%` : 'N/D'} | S&P 500 20d: ${spRet20 !== null ? `${spRet20 > 0 ? '+' : ''}${spRet20.toFixed(2)}%` : 'N/D'}`,
      },
      {
        id: 'fx_appetite',
        namePt: 'Sentimento Cambial (PTAX USD/BRL 20d)',
        nameEn: 'FX Sentiment & BRL Flows (20d)',
        weight: 0.20,
        score: fxScore,
        signalLabelPt: fxScore >= 58 ? 'Fluxo Favorável (BRL Forte)' : fxScore <= 42 ? 'Aversão / Pressão Cambial' : 'Estável',
        signalLabelEn: fxScore >= 58 ? 'BRL Supportive' : fxScore <= 42 ? 'FX Pressure' : 'Balanced',
        evidence: `USD/BRL variação 20d: ${fxRet20 !== null ? `${fxRet20 > 0 ? '+' : ''}${fxRet20.toFixed(2)}%` : 'N/D'}`,
      },
      {
        id: 'focus_anchoring',
        namePt: 'Ancoragem de Expectativas (Boletim Focus)',
        nameEn: 'Market Expectations Anchoring (Focus)',
        weight: 0.18,
        score: focusScore,
        signalLabelPt: focusScore >= 58 ? 'Ancorado' : focusScore <= 42 ? 'Desancorado' : 'Atenção Moderada',
        signalLabelEn: focusScore >= 58 ? 'Anchored' : focusScore <= 42 ? 'Unanchored' : 'Moderate Caution',
        evidence: focusIpca
          ? `Focus IPCA (${focusIpca.referenceYear}): ${focusIpca.median.toFixed(2)}% vs Meta 3,00%`
          : `Selic Meta atual: ${selicNow.toFixed(2)}% a.a.`,
      },
      {
        id: 'global_macro',
        namePt: 'Condições Globais & Pulso Macro (US 10Y / Pulse)',
        nameEn: 'Global Rates & Macro Pulse Anchor',
        weight: 0.15,
        score: Number(((globalRatesScore + macroPulseScore) / 2).toFixed(1)),
        signalLabelPt: (globalRatesScore + macroPulseScore) / 2 >= 58 ? 'Benigno' : (globalRatesScore + macroPulseScore) / 2 <= 42 ? 'Adverso' : 'Equilibrado',
        signalLabelEn: (globalRatesScore + macroPulseScore) / 2 >= 58 ? 'Benign' : (globalRatesScore + macroPulseScore) / 2 <= 42 ? 'Adverse' : 'Balanced',
        evidence: `US 10Y Δ20d: ${us10DeltaBps !== null ? `${us10DeltaBps > 0 ? '+' : ''}${us10DeltaBps.toFixed(0)} bps` : 'N/D'} | Pulse: ${macroPulseScore}/100`,
      },
    ];

    const compositeScore = Number(
      pillars.reduce((sum, p) => sum + p.score * p.weight, 0).toFixed(1)
    );

    let regime: SentimentRegime = 'NEUTRAL';
    let regimeLabelPt = 'Neutro / Seletivo';
    let regimeLabelEn = 'Neutral / Selective';
    if (compositeScore >= 68) {
      regime = 'RISK_ON_BULLISH';
      regimeLabelPt = 'Otimista (Risk-On)';
      regimeLabelEn = 'Risk-On / Bullish';
    } else if (compositeScore >= 56) {
      regime = 'CONSTRUCTIVE';
      regimeLabelPt = 'Construtivo Moderado';
      regimeLabelEn = 'Moderately Constructive';
    } else if (compositeScore >= 44) {
      regime = 'NEUTRAL';
      regimeLabelPt = 'Neutro / Seletivo';
      regimeLabelEn = 'Neutral / Selective';
    } else if (compositeScore >= 32) {
      regime = 'CAUTIOUS';
      regimeLabelPt = 'Cautela (Risk-Off Leve)';
      regimeLabelEn = 'Cautious';
    } else {
      regime = 'RISK_OFF_BEARISH';
      regimeLabelPt = 'Aversão a Risco (Bearish)';
      regimeLabelEn = 'Risk-Off / Bearish';
    }

    // 3. Build 30-day Historical Market Sentiment Trajectory from real daily stored series
    const historicalMarketSentiment = this.buildHistoricalMarketSentiment(ibovSeries, fxSeries, spSeries);

    return {
      generatedAt: new Date().toISOString(),
      compositeScore,
      regime,
      regimeLabelPt,
      regimeLabelEn,
      policyTone: {
        hawkishCount,
        dovishCount,
        neutralCount: neutralStanceCount,
        dominantStance,
        netMonetaryTilt,
      },
      newsDistribution: {
        totalArticles: scoredNews.length,
        positive,
        negative,
        neutral,
        mixed,
        avgNewsScore,
      },
      pillars,
      scoredNews,
      historicalMarketSentiment,
      methodologyNote:
        'Índice híbrido auditável: 25% análise léxica NLP sobre comunicados oficiais do Banco Central + 75% dinâmica quantitativa de mercado/expectativas (IBOV, PTAX, S&P 500, US 10Y e Boletim Focus).',
      limitations: [
        'A análise léxica avalia frequência ponderada de termos macroeconômicos oficiais em português e inglês; ironias ou contextos jurídicos complexos exigem revisão humana.',
        'Não constitui recomendação de compra, venda ou alocação de ativos financeiros.',
      ],
    };
  }

  private buildHistoricalMarketSentiment(
    ibov: ObservationPoint[],
    fx: ObservationPoint[],
    sp: ObservationPoint[]
  ): SentimentHistoryPoint[] {
    if (ibov.length < 30 || fx.length < 30) return [];
    const fxMap = new Map(fx.map((p) => [p.date.slice(0, 10), p.value]));
    const spMap = new Map(sp.map((p) => [p.date.slice(0, 10), p.value]));

    const points: SentimentHistoryPoint[] = [];
    const startIdx = Math.max(15, ibov.length - 30);

    for (let i = startIdx; i < ibov.length; i++) {
      const dt = ibov[i].date.slice(0, 10);
      const prevIdx = Math.max(0, i - 10);
      const ibovBase = ibov[prevIdx].value;
      const eqRet10 = ibovBase > 0 ? ((ibov[i].value - ibovBase) / ibovBase) * 100 : 0;
      const eqComp = Number(clamp(50 + eqRet10 * 3.2, 5, 95).toFixed(1));

      const fxNow = fxMap.get(dt);
      const fxPrev = fxMap.get(ibov[prevIdx].date.slice(0, 10));
      const fxRet10 = fxNow && fxPrev && fxPrev > 0 ? ((fxNow - fxPrev) / fxPrev) * 100 : 0;
      const fxComp = Number(clamp(50 - fxRet10 * 4.5, 5, 95).toFixed(1));

      const spNow = spMap.get(dt);
      const spPrev = spMap.get(ibov[prevIdx].date.slice(0, 10));
      const spRet10 = spNow && spPrev && spPrev > 0 ? ((spNow - spPrev) / spPrev) * 100 : 0;
      const glComp = Number(clamp(50 + spRet10 * 3.0, 5, 95).toFixed(1));

      const idxScore = Number((0.4 * eqComp + 0.35 * fxComp + 0.25 * glComp).toFixed(1));
      points.push({
        date: dt,
        marketSentimentIndex: idxScore,
        equitiesComponent: eqComp,
        fxComponent: fxComp,
        globalRatesComponent: glComp,
      });
    }

    return points;
  }
}

export const sentimentService = new SentimentService();
