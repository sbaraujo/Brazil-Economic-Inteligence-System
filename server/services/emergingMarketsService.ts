import fs from 'fs';
import path from 'path';
import { apiQuotaService } from './apiQuotaService.ts';
import { cryptoService } from './cryptoService.ts';

export interface EmergingMarketCountryMeta {
  iso3: string;
  namePt: string;
  nameEn: string;
  regionPt: string;
  etfSymbol: string;
  fxSymbol: string;
  isAnchorBrazil: boolean;
}

export interface EmergingMarketIndicatorMeta {
  id: string;
  code: string;
  namePt: string;
  nameEn: string;
  unit: string;
  higherIsBetter: boolean;
  sourceName: string;
  category: 'MACRO' | 'MARKET';
  linkedLocalIndicatorId?: string;
}

export interface EmergingMarketHeatmapCell {
  iso3: string;
  indicatorId: string;
  value: number | null;
  referenceYear: string;
  peerMean: number | null;
  peerStdDev: number | null;
  rawZScore: number | null;
  /** Signed relative Z-score where positive = stronger relative economic/market performance */
  relativeZScore: number | null;
  /** Cross-sectional percentile rank (0..100 where 100 = strongest performer among peers) */
  percentileRank: number | null;
  /** Rank among available peers (1 = best) */
  rank: number | null;
  peerCount: number;
  source: string;
}

export interface EmergingMarketCountryRank {
  iso3: string;
  namePt: string;
  nameEn: string;
  isAnchorBrazil: boolean;
  compositeScore: number | null; // 0..100 normalized (50 = EM peer mean)
  avgRelativeZScore: number | null;
  rank: number | null;
  indicatorsCovered: number;
}

export interface EmergingMarketsHeatmapReport {
  generatedAt: string;
  lastSyncedAt: string | null;
  selectedYear: string;
  availableYears: string[];
  dataStatus: 'LIVE' | 'CACHED' | 'DEGRADED';
  countries: EmergingMarketCountryMeta[];
  indicators: EmergingMarketIndicatorMeta[];
  cells: EmergingMarketHeatmapCell[];
  countryRankings: EmergingMarketCountryRank[];
  brazilSummary: {
    rank: number | null;
    totalCountries: number;
    compositeScore: number | null;
    strongestIndicatorPt: string | null;
    weakestIndicatorPt: string | null;
    historicalBrazilScoreSeries: Array<{
      year: string;
      brazilScore: number | null;
      brazilRank: number | null;
      emMedianScore: number | null;
    }>;
  };
  sources: string[];
  limitations: string[];
}

export const EM_COUNTRIES: EmergingMarketCountryMeta[] = [
  { iso3: 'BRA', namePt: 'Brasil', nameEn: 'Brazil', regionPt: 'América Latina', etfSymbol: 'EWZ', fxSymbol: 'BRL=X', isAnchorBrazil: true },
  { iso3: 'MEX', namePt: 'México', nameEn: 'Mexico', regionPt: 'América Latina', etfSymbol: 'EWW', fxSymbol: 'MXN=X', isAnchorBrazil: false },
  { iso3: 'CHL', namePt: 'Chile', nameEn: 'Chile', regionPt: 'América Latina', etfSymbol: 'ECH', fxSymbol: 'CLP=X', isAnchorBrazil: false },
  { iso3: 'IND', namePt: 'Índia', nameEn: 'India', regionPt: 'Ásia Emergente', etfSymbol: 'INDA', fxSymbol: 'INR=X', isAnchorBrazil: false },
  { iso3: 'IDN', namePt: 'Indonésia', nameEn: 'Indonesia', regionPt: 'Ásia Emergente', etfSymbol: 'EIDO', fxSymbol: 'IDR=X', isAnchorBrazil: false },
  { iso3: 'ZAF', namePt: 'África do Sul', nameEn: 'South Africa', regionPt: 'EMEA', etfSymbol: 'EZA', fxSymbol: 'ZAR=X', isAnchorBrazil: false },
  { iso3: 'CHN', namePt: 'China', nameEn: 'China', regionPt: 'Ásia Emergente', etfSymbol: 'MCHI', fxSymbol: 'CNY=X', isAnchorBrazil: false },
  { iso3: 'POL', namePt: 'Polônia', nameEn: 'Poland', regionPt: 'Europa Emergente', etfSymbol: 'EPOL', fxSymbol: 'PLN=X', isAnchorBrazil: false },
];

export const EM_INDICATORS: EmergingMarketIndicatorMeta[] = [
  {
    id: 'NGDP_RPCH',
    code: 'PIB %',
    namePt: 'Crescimento Real PIB',
    nameEn: 'Real GDP Growth',
    unit: '% a.a.',
    higherIsBetter: true,
    sourceName: 'FMI WEO (via DBnomics)',
    category: 'MACRO',
    linkedLocalIndicatorId: 'PIB_REAL_ANUAL',
  },
  {
    id: 'PCPIPCH',
    code: 'CPI %',
    namePt: 'Inflação (CPI)',
    nameEn: 'CPI Inflation',
    unit: '% a.a.',
    higherIsBetter: false,
    sourceName: 'FMI WEO (via DBnomics)',
    category: 'MACRO',
    linkedLocalIndicatorId: 'IPCA_MENSAL',
  },
  {
    id: 'LUR',
    code: 'DESEMP %',
    namePt: 'Taxa de Desemprego',
    nameEn: 'Unemployment Rate',
    unit: '%',
    higherIsBetter: false,
    sourceName: 'FMI WEO (via DBnomics)',
    category: 'MACRO',
    linkedLocalIndicatorId: 'DESEMPREGO_PNAD',
  },
  {
    id: 'GGXCNL_NGDP',
    code: 'FISCAL %',
    namePt: 'Resultado Fiscal (% PIB)',
    nameEn: 'Fiscal Balance (% GDP)',
    unit: '% PIB',
    higherIsBetter: true,
    sourceName: 'FMI WEO (via DBnomics)',
    category: 'MACRO',
  },
  {
    id: 'GGXWDG_NGDP',
    code: 'DÍVIDA %',
    namePt: 'Dívida Bruta (% PIB)',
    nameEn: 'Gross Debt (% GDP)',
    unit: '% PIB',
    higherIsBetter: false,
    sourceName: 'FMI WEO (via DBnomics)',
    category: 'MACRO',
    linkedLocalIndicatorId: 'DIVIDA_BRUTA_PIB',
  },
  {
    id: 'BCA_NGDPD',
    code: 'C.CORR %',
    namePt: 'Conta Corrente (% PIB)',
    nameEn: 'Current Account (% GDP)',
    unit: '% PIB',
    higherIsBetter: true,
    sourceName: 'FMI WEO (via DBnomics)',
    category: 'MACRO',
    linkedLocalIndicatorId: 'BALANCA_COMERCIAL',
  },
  {
    id: 'EQUITY_1Y_USD',
    code: 'BOLSA 12M',
    namePt: 'Bolsa País ETF (USD)',
    nameEn: 'Country Equity ETF (USD)',
    unit: '% 12M',
    higherIsBetter: true,
    sourceName: 'Yahoo Finance (EWZ/EM ETFs)',
    category: 'MARKET',
    linkedLocalIndicatorId: 'IBOV',
  },
  {
    id: 'FX_VS_USD_1Y',
    code: 'MOEDA 12M',
    namePt: 'Moeda vs USD (+Aprec.)',
    nameEn: 'FX vs USD (+Apprec.)',
    unit: '% 12M',
    higherIsBetter: true,
    sourceName: 'Yahoo Finance FX',
    category: 'MARKET',
    linkedLocalIndicatorId: 'USD_BRL_PTAX',
  },
];

export interface PersistedEmCache {
  syncedAt: string;
  /** values[iso3][indicatorId][year] = number */
  values: Record<string, Record<string, Record<string, number>>>;
  /** Latest rolling 252d / trailing 12m market returns stored under 'LATEST' */
  latestMarketValues: Record<string, Record<string, { value: number; refPeriod: string }>>;
  years: string[];
  datasetTag: string;
}

const DEFAULT_DATA_DIR = process.env.SYGMA_DATA_DIR
  ? path.resolve(process.env.SYGMA_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export function buildHeatmapFromCache(
  cache: PersistedEmCache,
  requestedYear: string,
  dataStatus: 'LIVE' | 'CACHED' | 'DEGRADED'
): EmergingMarketsHeatmapReport {
  const availableYears = [...cache.years].sort((a, b) => Number(b) - Number(a));
  const resolvedYear =
    requestedYear === 'LATEST' || !availableYears.includes(requestedYear)
      ? 'LATEST'
      : requestedYear;

  const targetMacroYear =
    resolvedYear === 'LATEST'
      ? availableYears.find((y) => Number(y) <= new Date().getFullYear()) || availableYears[0] || '2025'
      : resolvedYear;

  const computeYearSnapshot = (yearChoice: string) => {
    const macroYear = yearChoice === 'LATEST' ? targetMacroYear : yearChoice;
    const cells: EmergingMarketHeatmapCell[] = [];

    for (const ind of EM_INDICATORS) {
      const rawEntries: Array<{ iso3: string; value: number | null; refYear: string; source: string }> = [];
      for (const c of EM_COUNTRIES) {
        let val: number | null = null;
        let refYear = macroYear;
        let source = ind.sourceName;

        if (ind.category === 'MARKET') {
          if (yearChoice === 'LATEST') {
            const latestMkt = cache.latestMarketValues?.[c.iso3]?.[ind.id];
            if (latestMkt && Number.isFinite(latestMkt.value)) {
              val = latestMkt.value;
              refYear = latestMkt.refPeriod;
            }
          } else {
            const histVal = cache.values?.[c.iso3]?.[ind.id]?.[yearChoice];
            if (typeof histVal === 'number' && Number.isFinite(histVal)) {
              val = histVal;
              refYear = yearChoice;
            }
          }
          source = ind.id === 'EQUITY_1Y_USD' ? `Yahoo Finance (${c.etfSymbol})` : `Yahoo Finance (${c.fxSymbol})`;
        } else {
          const histVal = cache.values?.[c.iso3]?.[ind.id]?.[macroYear];
          if (typeof histVal === 'number' && Number.isFinite(histVal)) {
            val = histVal;
          }
          source = `FMI ${cache.datasetTag || 'WEO'} (DBnomics)`;
        }

        rawEntries.push({ iso3: c.iso3, value: val, refYear, source });
      }

      const validVals = rawEntries.map((e) => e.value).filter((v): v is number => v !== null);
      const m = validVals.length > 0 ? validVals.reduce((s, v) => s + v, 0) / validVals.length : null;
      const sd =
        validVals.length > 1 && m !== null
          ? Math.sqrt(validVals.reduce((s, v) => s + (v - m) ** 2, 0) / (validVals.length - 1))
          : null;

      // Rank order where rank 1 = best performer according to polarity
      const sortedForRank = rawEntries
        .filter((e): e is { iso3: string; value: number; refYear: string; source: string } => e.value !== null)
        .sort((a, b) => (ind.higherIsBetter ? b.value - a.value : a.value - b.value));

      const rankMap = new Map<string, number>();
      sortedForRank.forEach((item, idx) => rankMap.set(item.iso3, idx + 1));

      for (const entry of rawEntries) {
        if (entry.value === null || m === null) {
          cells.push({
            iso3: entry.iso3,
            indicatorId: ind.id,
            value: null,
            referenceYear: entry.refYear,
            peerMean: m !== null ? Number(m.toFixed(2)) : null,
            peerStdDev: sd !== null ? Number(sd.toFixed(2)) : null,
            rawZScore: null,
            relativeZScore: null,
            percentileRank: null,
            rank: null,
            peerCount: validVals.length,
            source: entry.source,
          });
          continue;
        }

        const rawZ = sd !== null && sd > 1e-6 ? (entry.value - m) / sd : 0;
        const signedZ = ind.higherIsBetter ? rawZ : -rawZ;
        const rank = rankMap.get(entry.iso3) ?? null;
        const pct =
          rank !== null && validVals.length > 1
            ? Number((((validVals.length - rank) / (validVals.length - 1)) * 100).toFixed(1))
            : rank === 1
            ? 100
            : null;

        cells.push({
          iso3: entry.iso3,
          indicatorId: ind.id,
          value: Number(entry.value.toFixed(2)),
          referenceYear: entry.refYear,
          peerMean: Number(m.toFixed(2)),
          peerStdDev: sd !== null ? Number(sd.toFixed(2)) : null,
          rawZScore: Number(rawZ.toFixed(2)),
          relativeZScore: Number(Math.max(-3, Math.min(3, signedZ)).toFixed(2)),
          percentileRank: pct,
          rank,
          peerCount: validVals.length,
          source: entry.source,
        });
      }
    }

    const rankingsRaw: EmergingMarketCountryRank[] = EM_COUNTRIES.map((c) => {
      const cCells = cells.filter((cell) => cell.iso3 === c.iso3 && cell.relativeZScore !== null);
      if (cCells.length === 0) {
        return {
          iso3: c.iso3,
          namePt: c.namePt,
          nameEn: c.nameEn,
          isAnchorBrazil: c.isAnchorBrazil,
          compositeScore: null,
          avgRelativeZScore: null,
          rank: null,
          indicatorsCovered: 0,
        };
      }
      const avgZ = cCells.reduce((s, x) => s + (x.relativeZScore ?? 0), 0) / cCells.length;
      const score = Math.max(5, Math.min(95, Number((50 + avgZ * 18).toFixed(1))));
      return {
        iso3: c.iso3,
        namePt: c.namePt,
        nameEn: c.nameEn,
        isAnchorBrazil: c.isAnchorBrazil,
        compositeScore: score,
        avgRelativeZScore: Number(avgZ.toFixed(2)),
        rank: null,
        indicatorsCovered: cCells.length,
      };
    });

    const sortedRanks = [...rankingsRaw]
      .filter((r) => r.compositeScore !== null)
      .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
    sortedRanks.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    // Return ordered by composite rank (or default country order if missing)
    const countryRankings = rankingsRaw.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

    return { cells, countryRankings };
  };

  const active = computeYearSnapshot(resolvedYear);
  const braCells = active.cells
    .filter((c) => c.iso3 === 'BRA' && c.relativeZScore !== null)
    .sort((a, b) => (b.relativeZScore ?? 0) - (a.relativeZScore ?? 0));

  const strongest = braCells[0]
    ? EM_INDICATORS.find((i) => i.id === braCells[0].indicatorId)?.namePt ?? null
    : null;
  const weakest = braCells[braCells.length - 1]
    ? EM_INDICATORS.find((i) => i.id === braCells[braCells.length - 1].indicatorId)?.namePt ?? null
    : null;

  const braRankObj = active.countryRankings.find((r) => r.iso3 === 'BRA');

  // Historical Brazil Score vs EM Median trajectory across available years
  const histYears = [...availableYears].sort((a, b) => Number(a) - Number(b));
  const historicalBrazilScoreSeries = histYears.map((yr) => {
    const yrSnap = computeYearSnapshot(yr);
    const bra = yrSnap.countryRankings.find((r) => r.iso3 === 'BRA');
    const validScores = yrSnap.countryRankings
      .map((r) => r.compositeScore)
      .filter((s): s is number => s !== null)
      .sort((a, b) => a - b);
    const medianScore =
      validScores.length > 0 ? validScores[Math.floor(validScores.length / 2)] : null;
    return {
      year: yr,
      brazilScore: bra?.compositeScore ?? null,
      brazilRank: bra?.rank ?? null,
      emMedianScore: medianScore,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    lastSyncedAt: cache.syncedAt || null,
    selectedYear: resolvedYear,
    availableYears,
    dataStatus,
    countries: EM_COUNTRIES,
    indicators: EM_INDICATORS,
    cells: active.cells,
    countryRankings: active.countryRankings,
    brazilSummary: {
      rank: braRankObj?.rank ?? null,
      totalCountries: active.countryRankings.filter((r) => r.compositeScore !== null).length,
      compositeScore: braRankObj?.compositeScore ?? null,
      strongestIndicatorPt: strongest,
      weakestIndicatorPt: weakest,
      historicalBrazilScoreSeries,
    },
    sources: [
      `FMI World Economic Outlook (${cache.datasetTag || 'WEO'}) via DBnomics API`,
      'Yahoo Finance (ETFs Soberanos em USD & Pares Cambiais Diários 5Y)',
    ],
    limitations: [
      'Indicadores macroeconômicos do FMI WEO possuem periodicidade anual e podem incluir estimativas oficiais do FMI para o ano corrente.',
      'Z-Score relativo (σ) e Percentil EM medem o posicionamento relativo dentro desta cesta de 8 mercados emergentes com polaridade ajustada (inflação, desemprego e dívida menores pontuam positivamente).',
      'Retornos de bolsa (EWZ/EWW/ECH/INDA/EIDO/EZA/MCHI/EPOL) refletem desempenho em USD via ETFs líquidos internacionais.',
    ],
  };
}

export class EmergingMarketsService {
  private readonly cacheFile: string;
  private cache: PersistedEmCache | null = null;
  private syncPromise: Promise<PersistedEmCache> | null = null;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.cacheFile = path.join(dataDir, 'sygma_em_cache.json');
    this.loadCache();
  }

  private loadCache() {
    if (!fs.existsSync(this.cacheFile)) return;
    try {
      const raw = fs.readFileSync(this.cacheFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedEmCache;
      if (parsed && parsed.values && Array.isArray(parsed.years)) {
        this.cache = parsed;
      }
    } catch {
      this.cache = null;
    }
  }

  private saveCache(data: PersistedEmCache) {
    this.cache = data;
    try {
      const tmp = `${this.cacheFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.cacheFile);
    } catch {
      // Ignore disk persistence error on read-only FS
    }
  }

  private async fetchImfMacroMatrix(): Promise<{
    values: Record<string, Record<string, Record<string, number>>>;
    years: Set<string>;
    datasetTag: string;
  }> {
    const t0 = Date.now();
    const dims = JSON.stringify({
      'weo-country': EM_COUNTRIES.map((c) => c.iso3),
      'weo-subject': ['NGDP_RPCH', 'PCPIPCH', 'LUR', 'BCA_NGDPD', 'GGXWDG_NGDP', 'GGXCNL_NGDP'],
    });
    const url = `https://api.db.nomics.world/v22/series/IMF/WEO:latest?dimensions=${encodeURIComponent(dims)}&observations=1&limit=100`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json', 'User-Agent': 'SYGMA-AIS/1.0' },
      });
      if (!res.ok) {
        throw new Error(`DBnomics IMF WEO HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        series?: {
          docs?: Array<{
            dataset_code?: string;
            series_code: string;
            period: string[];
            value: Array<number | string | null>;
          }>;
        };
      };

      const docs = json?.series?.docs || [];
      if (docs.length === 0) {
        throw new Error('DBnomics retornou 0 séries do FMI WEO');
      }

      const values: Record<string, Record<string, Record<string, number>>> = {};
      const years = new Set<string>();
      const minYear = 2016;
      const maxYear = new Date().getFullYear() + 1;
      let datasetTag = docs[0]?.dataset_code || 'WEO:latest';
      let obsCount = 0;

      for (const doc of docs) {
        if (doc.dataset_code) datasetTag = doc.dataset_code;
        const [iso3, indCode] = doc.series_code.split('.');
        if (!iso3 || !indCode) continue;
        if (!values[iso3]) values[iso3] = {};
        if (!values[iso3][indCode]) values[iso3][indCode] = {};

        for (let i = 0; i < doc.period.length; i++) {
          const yr = doc.period[i];
          const yrNum = Number(yr);
          const val = doc.value[i];
          if (
            Number.isInteger(yrNum) &&
            yrNum >= minYear &&
            yrNum <= maxYear &&
            typeof val === 'number' &&
            Number.isFinite(val)
          ) {
            values[iso3][indCode][yr] = Number(val.toFixed(3));
            years.add(yr);
            obsCount++;
          }
        }
      }

      apiQuotaService.recordCall('dbnomics-imf', {
        ok: true,
        latencyMs: Date.now() - t0,
        records: obsCount,
      });
      return { values, years, datasetTag };
    } catch (err) {
      apiQuotaService.recordCall('dbnomics-imf', {
        ok: false,
        latencyMs: Date.now() - t0,
        records: 0,
      });
      throw err;
    }
  }

  private async fetchYahooChartAnnualReturns(
    symbol: string,
    invertFxReturn = false
  ): Promise<{
    annualReturns: Record<string, number>;
    trailing12m: { value: number; refPeriod: string } | null;
  }> {
    const t0 = Date.now();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6y&interval=1d`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(7000),
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) {
        throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };

      const result = json?.chart?.result?.[0];
      const ts = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const points: Array<{ date: string; close: number }> = [];

      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
          const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
          points.push({ date, close: c });
        }
      }

      apiQuotaService.recordCall('yahoo-market', {
        ok: true,
        latencyMs: Date.now() - t0,
        records: points.length,
      });

      if (points.length < 20) {
        return { annualReturns: {}, trailing12m: null };
      }

      // Group closes by calendar year to compute annual return vs prior year's close
      const byYear = new Map<string, Array<{ date: string; close: number }>>();
      for (const pt of points) {
        const yr = pt.date.slice(0, 4);
        if (!byYear.has(yr)) byYear.set(yr, []);
        byYear.get(yr)!.push(pt);
      }

      const sortedYears = Array.from(byYear.keys()).sort();
      const annualReturns: Record<string, number> = {};
      for (let i = 0; i < sortedYears.length; i++) {
        const yr = sortedYears[i];
        const yrPts = byYear.get(yr)!;
        const endPrice = yrPts[yrPts.length - 1].close;
        const prevYearPts = i > 0 ? byYear.get(sortedYears[i - 1]) : null;
        const startPrice = prevYearPts ? prevYearPts[prevYearPts.length - 1].close : yrPts[0].close;
        if (startPrice > 0 && yrPts.length >= 15) {
          // For FX pairs quoted as LOCAL per 1 USD (e.g. BRL=X), local currency appreciation = start/end - 1
          const ret = invertFxReturn
            ? (startPrice / endPrice - 1) * 100
            : (endPrice / startPrice - 1) * 100;
          annualReturns[yr] = Number(ret.toFixed(2));
        }
      }

      // Trailing 252 trading days (12M rolling return)
      const lastPt = points[points.length - 1];
      const lookbackIdx = Math.max(0, points.length - 252);
      const basePt = points[lookbackIdx];
      const trailingVal = invertFxReturn
        ? (basePt.close / lastPt.close - 1) * 100
        : (lastPt.close / basePt.close - 1) * 100;

      return {
        annualReturns,
        trailing12m: {
          value: Number(trailingVal.toFixed(2)),
          refPeriod: lastPt.date,
        },
      };
    } catch (err) {
      apiQuotaService.recordCall('yahoo-market', {
        ok: false,
        latencyMs: Date.now() - t0,
        records: 0,
      });
      throw err;
    }
  }

  public async syncLive(): Promise<PersistedEmCache> {
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = (async () => {
      try {
        const imf = await this.fetchImfMacroMatrix();
        const values = imf.values;
        const latestMarketValues: PersistedEmCache['latestMarketValues'] = {};

        await Promise.all(
          EM_COUNTRIES.map(async (c) => {
            if (!values[c.iso3]) values[c.iso3] = {};
            latestMarketValues[c.iso3] = {};

            const [etfRes, fxRes] = await Promise.allSettled([
              this.fetchYahooChartAnnualReturns(c.etfSymbol, false),
              this.fetchYahooChartAnnualReturns(c.fxSymbol, true),
            ]);

            if (etfRes.status === 'fulfilled') {
              values[c.iso3]['EQUITY_1Y_USD'] = etfRes.value.annualReturns;
              if (etfRes.value.trailing12m) {
                latestMarketValues[c.iso3]['EQUITY_1Y_USD'] = etfRes.value.trailing12m;
              }
            }
            if (fxRes.status === 'fulfilled') {
              values[c.iso3]['FX_VS_USD_1Y'] = fxRes.value.annualReturns;
              if (fxRes.value.trailing12m) {
                latestMarketValues[c.iso3]['FX_VS_USD_1Y'] = fxRes.value.trailing12m;
              }
            }
          })
        );

        const nextCache: PersistedEmCache = {
          syncedAt: new Date().toISOString(),
          values,
          latestMarketValues,
          years: Array.from(imf.years).sort((a, b) => Number(a) - Number(b)),
          datasetTag: imf.datasetTag,
        };
        this.saveCache(nextCache);

        cryptoService.recordAudit('svc-quant', 'SYSTEM', 'EM_BENCHMARK_SYNCED', 'FMI_WEO_YAHOO_EM', 'SUCCESS', {
          countries: EM_COUNTRIES.length,
          datasetTag: imf.datasetTag,
          yearsCount: nextCache.years.length,
        });
        return nextCache;
      } finally {
        this.syncPromise = null;
      }
    })();

    return this.syncPromise;
  }

  public async getHeatmapReport(requestedYear = 'LATEST', forceRefresh = false): Promise<EmergingMarketsHeatmapReport> {
    const now = Date.now();
    const isFresh =
      this.cache &&
      this.cache.syncedAt &&
      now - Date.parse(this.cache.syncedAt) < CACHE_TTL_MS;

    if (!forceRefresh && isFresh && this.cache) {
      return buildHeatmapFromCache(this.cache, requestedYear, 'CACHED');
    }

    try {
      const fresh = await this.syncLive();
      return buildHeatmapFromCache(fresh, requestedYear, 'LIVE');
    } catch {
      if (this.cache) {
        return buildHeatmapFromCache(this.cache, requestedYear, 'DEGRADED');
      }
      // Honest empty report if offline and no cache exists
      return buildHeatmapFromCache(
        {
          syncedAt: '',
          values: {},
          latestMarketValues: {},
          years: ['2025'],
          datasetTag: 'UNAVAILABLE',
        },
        requestedYear,
        'DEGRADED'
      );
    }
  }
}

export const emergingMarketsService = new EmergingMarketsService();
