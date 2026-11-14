import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { connectorEngine } from './connectors/connectorEngine.ts';
import { cryptoService } from './cryptoService.ts';
import { dataQualityEngine } from './dataQualityEngine.ts';
import { quantEngine } from './quantEngine.ts';
import { timeSeriesStore } from './timeseriesStore.ts';

export type ReportType =
  | 'CONSOLIDATED_BRAZIL_SWOT'
  | 'DAILY_BRIEFING'
  | 'INFLATION_MONETARY'
  | 'FISCAL_RISK'
  | 'FX_ANALYSIS'
  | 'QUANTITATIVE_RISK';

export type ExportScope =
  | 'SNAPSHOTS'
  | 'TIMESERIES'
  | 'MACRO_BCB'
  | 'MARKETS'
  | 'RISK_SCENARIOS'
  | 'FOCUS_PULSE'
  | 'AUDIT_LOGS';

export interface SwotItem {
  title: string;
  evidence: string;
  plainLanguage: string;
}

export interface ConsolidatedSwotReport {
  generatedAt: string;
  reproducibilityHash: string;
  plainLanguageHeadline: string;
  plainLanguageSummary: string[];
  macroForecastScenarios: Array<{
    indicatorId: string;
    name: string;
    unit: string;
    currentValue: number | null;
    horizonDate: string;
    baseCentral: number;
    optimistic: number;
    adverse: number;
    severeStress: number;
    confidence90Band: string;
    mae: number;
    mase: number;
    plainInterpretation: string;
  }>;
  stressScenariosPlain: Array<{
    code: string;
    namePt: string;
    estimatedPortfolioImpactPct: number;
    estimatedBrlImpactPer100M: number;
    shockDescription: string;
    plainLanguageImpact: string;
    transmissionChannels: string[];
  }>;
  swotMatrix: {
    strengths: SwotItem[];
    weaknesses: SwotItem[];
    opportunities: SwotItem[];
    threats: SwotItem[];
  };
}

export interface PdfExportContext {
  userIdentification?: string;
  e2eeSessionId?: string;
}

export interface ViewPdfExportInput {
  viewTitle: string;
  activeView: string;
  language?: 'pt' | 'en';
  userIdentification?: string;
  e2eeSessionId?: string;
  filters?: {
    categoryFilter?: string;
    searchQuery?: string;
    selectedIndicatorId?: string;
    watchlistIds?: string[];
  };
  snapshots?: Array<{
    code: string;
    name: string;
    category?: string;
    value: number | null;
    unit: string;
    changePct: number | null;
    date: string | null;
    status: string;
    source?: string;
  }>;
  tables?: Array<{
    title: string;
    columns: string[];
    rows: Array<Array<string | number | null>>;
  }>;
  swotMatrix?: {
    strengths: SwotItem[];
    weaknesses: SwotItem[];
    opportunities: SwotItem[];
    threats: SwotItem[];
  };
  includeSwot?: boolean;
  includeStressScenarios?: boolean;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/D';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function sanitizePdfText(text: string): string {
  // pdfkit built-in Helvetica uses WinAnsiEncoding; normalize unsupported Unicode punctuation cleanly
  return text
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '*')
    .replace(/…/g, '...')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/±/g, '+/-')
    .replace(/²/g, '2')
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r]/g, '');
}

function appendInstitutionalDisclaimersPdf(
  doc: PDFKit.PDFDocument,
  opts: {
    leftX: number;
    pageW: number;
    ensureSpace: (needed: number) => void;
    sectionTitle: (title: string) => void;
    generatedAt: string;
    userIdentification?: string;
    e2eeSessionId?: string;
    sha256: string;
    reportLabel: string;
  }
) {
  const { leftX, pageW, ensureSpace, sectionTitle, generatedAt, userIdentification, e2eeSessionId, sha256, reportLabel } = opts;
  const resolvedUser = userIdentification?.trim() || 'Operador Institucional SYGMA AIS (Terminal Web)';
  const sessionLabel = e2eeSessionId?.trim() || 'SESSAO_PADRAO_SERVIDOR';

  sectionTitle('Institutional Disclaimers (Avisos Institucionais & Conformidade)');
  ensureSpace(138);

  const boxY = doc.y;
  const boxH = 128;
  doc.rect(leftX, boxY, pageW, boxH).fillAndStroke('#F8FAFC', '#0A2540');

  doc
    .fillColor('#0A2540')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(sanitizePdfText('IDENTIFICACAO DE EMISSAO & RASTREABILIDADE (AUDIT TRAIL)'), leftX + 10, boxY + 8, {
      width: pageW - 20,
    });

  doc
    .fillColor('#1E293B')
    .font('Courier')
    .fontSize(7.4)
    .text(
      sanitizePdfText(
        `Timestamp UTC (ISO-8601): ${generatedAt}   |   Relatorio: ${reportLabel}\nUser Identification: ${resolvedUser}   |   Sessao E2EE: ${sessionLabel}\nSHA-256 Verification Digest: ${sha256}`
      ),
      leftX + 10,
      boxY + 20,
      { width: pageW - 20, lineGap: 1.5 }
    );

  doc
    .fillColor('#B91C1C')
    .font('Helvetica-Bold')
    .fontSize(7.8)
    .text(
      sanitizePdfText('MANDATORY COMPLIANCE NOTICE - FINANCIAL ADVISORY & REGULATORY DISCLAIMER (CVM / ANBIMA / SEC)'),
      leftX + 10,
      boxY + 52,
      { width: pageW - 20 }
    );

  doc
    .fillColor('#334155')
    .font('Helvetica')
    .fontSize(7.2)
    .text(
      sanitizePdfText(
        'AVISO OBRIGATORIO: Este relatorio foi gerado automaticamente pela plataforma SYGMA AIS exclusivamente para fins informativos, analiticos e de monitoramento quantitativo. O conteudo NAO constitui consultoria de investimentos, recomendacao personalizada, analise de valores mobiliarios ou oferta de compra/venda de ativos financeiros nos termos das Resolucoes CVM 19/2021 e 20/2021. Simulacoes Monte Carlo e cenarios hipoteticos (A-J) dependem de premissas historicas e nao garantem resultados futuros. NOTICE: For institutional informational use only; does not constitute financial advisory, fiduciary counsel, or investment solicitation.'
      ),
      leftX + 10,
      boxY + 64,
      { width: pageW - 20, lineGap: 1.4 }
    );

  doc.y = boxY + boxH + 10;
}

export class ReportService {
  public buildConsolidatedSwotAnalysis(): ConsolidatedSwotReport {
    const generatedAt = new Date().toISOString();
    const snapshots = connectorEngine.getAllSnapshots();
    const snapById = new Map(snapshots.map((s) => [s.definition.id, s]));
    const pulse = quantEngine.computeBrazilPulse();
    const risk = quantEngine.computeRiskReport();
    const focus = connectorEngine.getFocusExpectations();

    const getVal = (id: string) => snapById.get(id)?.latest?.value ?? null;
    const getDate = (id: string) => snapById.get(id)?.latest?.date ?? 'N/D';

    const usd = getVal('USD_BRL_PTAX');
    const selic = getVal('SELIC_META');
    const ipca = getVal('IPCA_MENSAL');
    const ibov = getVal('IBOV');
    const dbgg = getVal('DIVIDA_BRUTA_PIB');
    const desemp = getVal('DESEMPREGO_PNAD');
    const reservas = getVal('RESERVAS_INT');
    const balanca = getVal('BALANCA_COMERCIAL');
    const inadimp = getVal('INADIMPLENCIA');
    const us10y = getVal('US_10Y');
    const ibcBr = getVal('IBC_BR');

    const focusIpca = focus.find((f) => f.indicator === 'IPCA');
    const focusSelic = focus.find((f) => f.indicator === 'Selic');
    const focusCambio = focus.find((f) => f.indicator === 'Câmbio');
    const focusPib = focus.find((f) => f.indicator === 'PIB Total');

    const pulseLabelPt =
      pulse.assessment === 'FAVORABLE'
        ? 'Favorável'
        : pulse.assessment === 'STABLE'
        ? 'Estável'
        : pulse.assessment === 'CAUTION'
        ? 'Cautela / Atenção Moderada'
        : pulse.assessment === 'ADVERSE'
        ? 'Adverso'
        : 'Estresse Severo';

    const plainLanguageHeadline = `Economia brasileira em estado de "${pulseLabelPt}" (Brazil Pulse ${pulse.compositeScore ?? 'N/D'}/100): mercado de trabalho firme e reservas externas sólidas equilibram juros restritivos, dívida pública elevada e sensibilidade ao dólar.`;

    const plainLanguageSummary = [
      `1. Foto Geral Hoje: O índice composto Brazil Economic Pulse marca ${pulse.compositeScore ?? 'N/D'} de 100 (${pulseLabelPt}). Na prática, a economia não está em crise aberta, mas opera com freio de mão puxado pelos juros altos.`,
      `2. Juros, Preços e Poder de Compra: A taxa Selic está em ${fmtNum(selic)}% ao ano (ref. ${getDate('SELIC_META')}), enquanto o IPCA mensal mais recente registrou ${fmtNum(ipca)}% (${getDate('IPCA_MENSAL')}). Juros elevados seguram a inflação, mas encarecem empréstimos para famílias e empresas (inadimplência SFN em ${fmtNum(inadimp)}%).`,
      `3. Dólar, Contas Externas e Emprego: O dólar PTAX está em R$ ${fmtNum(usd, 4)} (${getDate('USD_BRL_PTAX')}), protegido por US$ ${fmtNum((reservas ?? 0) / 1000, 1)} bilhões em reservas internacionais e superávit comercial mensal de US$ ${fmtNum(balanca, 0)} milhões. O desemprego (PNAD) segue em patamar historicamente baixo (${fmtNum(desemp)}%).`,
      `4. Contas Públicas e Risco de Mercado: A Dívida Bruta do Governo (DBGG) está em ${fmtNum(dbgg)}% do PIB (${getDate('DIVIDA_BRUTA_PIB')}), principal ponto de atenção dos investidores. Em uma carteira mista Brasil (35% Ibovespa, 25% Dólar, 20% Petróleo Brent, 20% Vale), o risco diário normal (VaR 95% Monte Carlo) é de queda de até ${fmtNum(risk.metrics.monteCarloVar95Pct)}%, podendo chegar a ${fmtNum(risk.metrics.expectedShortfall95Pct)}% nos piores 5% dos dias.`,
    ];

    // Macro econometric forecasts across 4 scenarios (Central, Optimistic, Adverse, Severe)
    const forecastTargets = [
      {
        id: 'USD_BRL_PTAX',
        name: 'Dólar Comercial (PTAX)',
        unit: 'BRL/USD',
        plainFn: (cur: number | null, base: number, opt: number, adv: number) =>
          `Saindo de R$ ${fmtNum(cur, 2)}, o cenário central projeta R$ ${fmtNum(base, 2)} em 12 passos; em melhora fiscal/externa pode recuar a R$ ${fmtNum(opt, 2)}, ou subir a R$ ${fmtNum(adv, 2)} sob aversão a risco.`,
      },
      {
        id: 'SELIC_META',
        name: 'Taxa Básica Selic Meta',
        unit: '% a.a.',
        plainFn: (cur: number | null, base: number, opt: number, adv: number) =>
          `De ${fmtNum(cur)}% a.a., o modelo aponta ${fmtNum(base)}% no cenário base (${fmtNum(opt)}% se inflação ceder mais rápido; ${fmtNum(adv)}% se houver pressão inflacionária/fiscal).`,
      },
      {
        id: 'IPCA_MENSAL',
        name: 'Inflação IPCA Mensal',
        unit: '% a.m.',
        plainFn: (cur: number | null, base: number, opt: number, adv: number) =>
          `Variação mensal atual de ${fmtNum(cur)}%; projeção base em ${fmtNum(base)}%/mês (banda entre ${fmtNum(opt)}% e ${fmtNum(adv)}%).`,
      },
      {
        id: 'IBOV',
        name: 'Índice Ibovespa B3',
        unit: 'pts',
        plainFn: (cur: number | null, base: number, opt: number, adv: number) =>
          `Patamar atual de ${fmtNum(cur, 0)} pts; trajetória central estima ${fmtNum(base, 0)} pts (otimista ${fmtNum(opt, 0)} pts; adversa ${fmtNum(adv, 0)} pts).`,
      },
    ];

    const macroForecastScenarios = forecastTargets.map((t) => {
      const fc = quantEngine.generateForecast(t.id, 12);
      const lastH = fc.horizonPoints[fc.horizonPoints.length - 1];
      const cur = getVal(t.id);
      const base = lastH?.central ?? cur ?? 0;
      const opt = lastH?.optimistic ?? base;
      const adv = lastH?.adverse ?? base;
      const sev = lastH?.severeStress ?? base;
      return {
        indicatorId: t.id,
        name: t.name,
        unit: t.unit,
        currentValue: cur,
        horizonDate: lastH?.date ?? 'N/D',
        baseCentral: base,
        optimistic: opt,
        adverse: adv,
        severeStress: sev,
        confidence90Band: `${fmtNum(lastH?.lower90, 2)} a ${fmtNum(lastH?.upper90, 2)}`,
        mae: fc.validation.mae,
        mase: fc.validation.mase,
        plainInterpretation: t.plainFn(cur, base, opt, adv),
      };
    });

    const plainScenarioGuides: Record<string, string> = {
      A: 'Juros sobem rápido (+2% na Selic): bolsas caem porque empresas pagam mais caro por dívidas, mas o dólar recua um pouco atraído pelo juro maior.',
      B: 'Disparada do Dólar (+15%): quem tem proteção cambial ou exporta (como Vale) ganha, compensando parte da queda das ações domésticas.',
      C: 'Tombo do Petróleo (-25%): derruba ações de energia e receitas de exportação, reduzindo o retorno total mesmo ajudando no combustível.',
      D: 'Queda do Minério de Ferro (-30%): atinge em cheio mineradoras brasileiras e reduz a entrada de dólares no país.',
      E: 'Inflação descontrolada (+3 p.p. no IPCA): corrói o poder de compra, pressiona juros longos e penaliza varejo e bolsa.',
      F: 'Desaceleração forte da China: como a China é o principal comprador do Brasil, caem minério, soja, petróleo e a bolsa local.',
      G: 'Recessão nos Estados Unidos: investidores globais fogem para segurança, derrubando bolsas emergentes e commodities.',
      H: 'Crise Fiscal no Brasil: desconfiança sobre contas públicas faz o dólar disparar (+18%) e a bolsa cair forte (-16%).',
      I: 'Pânico Global (VIX > 40): crise financeira mundial faz quase todos os ativos de risco caírem juntos em busca de caixa em dólar.',
      J: 'Tempestade Perfeita (Fiscal + Exterior): soma crise interna com queda de commodities; exige máxima proteção de liquidez.',
    };

    const stressScenariosPlain = risk.stressScenarios.map((sc) => ({
      code: sc.code,
      namePt: sc.namePt,
      estimatedPortfolioImpactPct: sc.estimatedPortfolioImpactPct,
      estimatedBrlImpactPer100M: sc.estimatedBrlImpactPer100M,
      shockDescription: sc.shockDescription,
      plainLanguageImpact: plainScenarioGuides[sc.code] ?? sc.shockDescription,
      transmissionChannels: sc.transmissionChannels,
    }));

    const swotMatrix = {
      strengths: [
        {
          title: 'Colchão de Reservas Internacionais Sólido',
          evidence: `Reservas de US$ ${fmtNum((reservas ?? 0) / 1000, 1)} bi (BCB ${getDate('RESERVAS_INT')})`,
          plainLanguage: 'O Brasil tem reservas em dólar suficientes para evitar crises cambiais abruptas no curto prazo.',
        },
        {
          title: 'Balança Comercial Superavitária e Agro Competitivo',
          evidence: `Saldo comercial mensal de US$ ${fmtNum(balanca, 0)} mi (${getDate('BALANCA_COMERCIAL')})`,
          plainLanguage: 'O país exporta muito mais do que importa em bens físicos, garantindo entrada contínua de dólares.',
        },
        {
          title: 'Mercado de Trabalho Resiliente',
          evidence: `Taxa de desocupação PNAD em ${fmtNum(desemp)}% (${getDate('DESEMPREGO_PNAD')})`,
          plainLanguage: 'Mais pessoas empregadas sustentam a renda das famílias e evitam desaceleração brusca do consumo.',
        },
        {
          title: 'Sistema Financeiro Capitalizado e Bolsa Descontada',
          evidence: `Ibovespa em ${fmtNum(ibov, 0)} pts; IBC-Br em ${fmtNum(ibcBr, 2)}`,
          plainLanguage: 'Empresas listadas líderes geram caixa forte e operam com múltiplos atrativos frente a pares globais.',
        },
      ],
      weaknesses: [
        {
          title: 'Dívida Pública Elevada e Trajetória Fiscal Sensível',
          evidence: `DBGG/PIB em ${fmtNum(dbgg)}% (ref. ${getDate('DIVIDA_BRUTA_PIB')})`,
          plainLanguage: 'O governo gasta parcela relevante do orçamento pagando juros; qualquer dúvida fiscal encarece o dólar e o crédito.',
        },
        {
          title: 'Juro Real Muito Restritivo (Selic Elevada)',
          evidence: `Selic Meta em ${fmtNum(selic)}% a.a. vs IPCA mensal ${fmtNum(ipca)}%`,
          plainLanguage: 'Crédito caro inibe investimentos produtivos de longo prazo e pressiona o orçamento de famílias endividadas.',
        },
        {
          title: 'Inadimplência e Custo de Crédito Corporativo',
          evidence: `Inadimplência SFN em ${fmtNum(inadimp)}% (${getDate('INADIMPLENCIA')})`,
          plainLanguage: 'Pequenas e médias empresas enfrentam margens apertadas com juros de capital de giro elevados.',
        },
        {
          title: 'Dependência de Commodities na Pauta Exportadora',
          evidence: `Sensibilidade direta a Brent, Soja e Minério (TIO=F)`,
          plainLanguage: 'Oscilações de preços internacionais de matérias-primas afetam rapidamente arrecadação e câmbio.',
        },
      ],
      opportunities: [
        {
          title: 'Ciclo Gradual de Queda de Juros caso Inflação Ceda',
          evidence:
            focusIpca && focusSelic
              ? `Focus IPCA (${focusIpca.referenceYear}: ${fmtNum(focusIpca.median)}%) & Selic (${fmtNum(focusSelic.median)}%)`
              : `Selic atual em ${fmtNum(selic)}% a.a. vs IPCA mensal de ${fmtNum(ipca)}%`,
          plainLanguage: 'Se a inflação convergir para a meta, há espaço para cortes futuros da Selic que destravam bolsa e imóveis.',
        },
        {
          title: 'Demanda Global por Alimentos, Energia e Transição Verde',
          evidence: `Saldo comercial mensal de US$ ${fmtNum(balanca, 0)} mi (${getDate('BALANCA_COMERCIAL')})`,
          plainLanguage: 'O Brasil se beneficia como fornecedor confiável de proteína, grãos, petróleo e energia renovável.',
        },
        {
          title: 'Fluxo Estrangeiro se Juros nos EUA Recuarem',
          evidence: focusCambio
            ? `Treasury US 10Y em ${fmtNum(us10y)}%; Focus Câmbio em R$ ${fmtNum(focusCambio.median)}`
            : `Treasury US 10Y em ${fmtNum(us10y)}%; USD/BRL PTAX em R$ ${fmtNum(usd, 4)}`,
          plainLanguage: 'Queda nos juros americanos costuma redirecionar capital global para mercados emergentes líquidos como o Brasil.',
        },
        {
          title: 'Reformas Microeconômicas e Infraestrutura',
          evidence: focusPib
            ? `Focus PIB projeta ${fmtNum(focusPib.median)}% (${focusPib.referenceYear})`
            : `Atividade IBC-Br em ${fmtNum(ibcBr, 2)} pts (${getDate('IBC_BR')})`,
          plainLanguage: 'Concessões, reforma tributária e digitalização do crédito aumentam a produtividade gradualmente.',
        },
      ],
      threats: [
        {
          title: 'Estresse Fiscal Doméstico (Cenário H)',
          evidence: `Choque simulado H: -${Math.abs(risk.stressScenarios.find((s) => s.code === 'H')?.estimatedPortfolioImpactPct ?? 0).toFixed(2)}% na carteira`,
          plainLanguage: 'Perda de credibilidade fiscal pode disparar o dólar, obrigar juros mais altos e derrubar ativos locais.',
        },
        {
          title: 'Juros Altos nos EUA por Mais Tempo e Recessão Americana (Cenário G)',
          evidence: `US 10Y em ${fmtNum(us10y)}%; Cenário G: ${fmtNum(risk.stressScenarios.find((s) => s.code === 'G')?.estimatedPortfolioImpactPct)}%`,
          plainLanguage: 'Dinheiro global fica nos títulos americanos e reduz apetite por países emergentes.',
        },
        {
          title: 'Desaceleração Chinesa (Cenário F)',
          evidence: `Cenário F (China -2 p.p.): impacto estimado de ${fmtNum(risk.stressScenarios.find((s) => s.code === 'F')?.estimatedPortfolioImpactPct)}%`,
          plainLanguage: 'Menor ritmo de construção e indústria na China derruba minério de ferro e receita de exportação brasileira.',
        },
        {
          title: 'Desancoragem Inflacionária e Choques Climáticos (Cenário E)',
          evidence: `Cenário E (IPCA +3 p.p.): impacto estimado de ${fmtNum(risk.stressScenarios.find((s) => s.code === 'E')?.estimatedPortfolioImpactPct)}%`,
          plainLanguage: 'Secas, choques de energia ou repasse do dólar para preços impedem queda dos juros.',
        },
      ],
    };

    const raw = {
      generatedAt,
      plainLanguageHeadline,
      plainLanguageSummary,
      macroForecastScenarios,
      stressScenariosPlain,
      swotMatrix,
    };

    const reproducibilityHash = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    return { ...raw, reproducibilityHash };
  }

  public buildReportPayload(type: ReportType) {
    const generatedAt = new Date().toISOString();
    const snapshots = connectorEngine.getAllSnapshots();
    const pulse = quantEngine.computeBrazilPulse();
    const risk = quantEngine.computeRiskReport();
    const health = dataQualityEngine.evaluateAll();
    const focus = connectorEngine.getFocusExpectations();

    const titles: Record<ReportType, string> = {
      CONSOLIDATED_BRAZIL_SWOT: 'Relatorio Consolidado Brasil - Cenarios, Risco e Matriz SWOT (SYGMA AIS)',
      DAILY_BRIEFING: 'Relatorio Executivo Diario - Economia Brasileira e Mercados',
      INFLATION_MONETARY: 'Relatorio de Inflacao, Expectativas Focus e Politica Monetaria',
      FISCAL_RISK: 'Relatorio de Sustentabilidade Fiscal e Divida Publica',
      FX_ANALYSIS: 'Analise Cambial Institucional (USD/BRL, EUR/BRL, DXY)',
      QUANTITATIVE_RISK: 'Relatorio de Risco Quantitativo (VaR Monte Carlo & Testes de Estresse)',
    };

    const consolidatedSwot =
      type === 'CONSOLIDATED_BRAZIL_SWOT' ? this.buildConsolidatedSwotAnalysis() : undefined;

    const payload = {
      brand: 'SYGMA AIS - SYGMA BRAZIL ECONOMIC INTELLIGENCE AI',
      version: '1.0.0',
      reportType: type,
      title: titles[type],
      generatedAt,
      pulse,
      snapshots: snapshots.map((s) => ({
        id: s.definition.id,
        code: s.definition.code,
        name: s.definition.namePt,
        category: s.definition.category,
        value: s.latest?.value ?? null,
        unit: s.definition.unit,
        date: s.latest?.date ?? null,
        changePct: s.changePct,
        status: s.status,
        source: s.latest?.sourceName ?? s.definition.providerId,
        methodology: s.definition.methodologyNote,
      })),
      focusExpectations: focus,
      riskMetrics: risk.metrics,
      stressScenarios: risk.stressScenarios,
      consolidatedSwot,
      dataQualitySummary: {
        overallStatus: health.overallStatus,
        openCritical: health.metrics.openIssuesCritical,
        openHigh: health.metrics.openIssuesHigh,
        openModerate: health.metrics.openIssuesModerate,
      },
    };

    const reproducibilityHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    return { ...payload, reproducibilityHash };
  }

  public exportDataset(options: {
    scope: ExportScope;
    format: 'csv' | 'json';
    range?: string;
    ids?: string[];
  }): { filename: string; contentType: string; content: string; sha256: string; recordCount: number } {
    const scope = options.scope;
    const format = options.format;
    const range = options.range || 'MAX';
    const filterIds = options.ids && options.ids.length > 0 ? new Set(options.ids) : null;
    const stamp = new Date().toISOString().slice(0, 10);

    const applyRangeCutoff = <T extends { date: string }>(series: T[]): T[] => {
      if (range === 'MAX' || series.length === 0) return series;
      const lastTs = Date.parse(series[series.length - 1].date);
      const daysMap: Record<string, number> = {
        '1M': 31,
        '3M': 93,
        '6M': 186,
        '1Y': 366,
        '3Y': 1096,
        '5Y': 1827,
      };
      const days = daysMap[range];
      if (!days || Number.isNaN(lastTs)) return series;
      const cutoff = lastTs - days * 86400_000;
      return series.filter((p) => Date.parse(p.date) >= cutoff);
    };

    let rows: Array<Record<string, unknown>> = [];

    if (scope === 'TIMESERIES') {
      const snaps = connectorEngine.getAllSnapshots().filter((s) => !filterIds || filterIds.has(s.definition.id));
      for (const s of snaps) {
        const series = applyRangeCutoff(timeSeriesStore.getSeries(s.definition.id));
        for (const pt of series) {
          rows.push({
            indicator_id: s.definition.id,
            code: s.definition.code,
            name: s.definition.namePt,
            category: s.definition.category,
            date: pt.date,
            value: pt.value,
            unit: s.definition.unit,
            status: pt.status,
            revision_count: pt.revisionCount,
            source: pt.sourceName,
            digest_sha256: pt.digestSha256,
          });
        }
      }
    } else if (scope === 'SNAPSHOTS' || scope === 'MACRO_BCB' || scope === 'MARKETS') {
      const macroCats = new Set(['MONETARY', 'INFLATION', 'FISCAL', 'ACTIVITY', 'LABOR', 'CREDIT', 'EXTERNAL']);
      const marketCats = new Set(['FX', 'EQUITIES_BR', 'EQUITIES_GLOBAL', 'COMMODITIES']);
      const snaps = connectorEngine.getAllSnapshots().filter((s) => {
        if (filterIds && !filterIds.has(s.definition.id)) return false;
        if (scope === 'MACRO_BCB') return macroCats.has(s.definition.category);
        if (scope === 'MARKETS') return marketCats.has(s.definition.category);
        return true;
      });
      rows = snaps.map((s) => ({
        indicator_id: s.definition.id,
        code: s.definition.code,
        name: s.definition.namePt,
        category: s.definition.category,
        value: s.latest?.value ?? null,
        unit: s.definition.unit,
        reference_date: s.latest?.date ?? null,
        change_abs: s.changeAbs,
        change_pct: s.changePct,
        observations: s.observationsCount,
        status: s.status,
        source: s.latest?.sourceName ?? s.definition.providerId,
      }));
    } else if (scope === 'RISK_SCENARIOS') {
      const risk = quantEngine.computeRiskReport();
      rows = risk.stressScenarios.map((sc) => ({
        scenario_code: sc.code,
        name: sc.namePt,
        portfolio_impact_pct: sc.estimatedPortfolioImpactPct,
        brl_impact_per_100m: sc.estimatedBrlImpactPer100M,
        hypothetical: sc.isHypothetical,
        mc_var_95_pct: risk.metrics.monteCarloVar95Pct,
        expected_shortfall_95_pct: risk.metrics.expectedShortfall95Pct,
        annualized_vol_pct: risk.metrics.annualizedVolatilityPct,
        channels: sc.transmissionChannels.join(' | '),
      }));
    } else if (scope === 'FOCUS_PULSE') {
      const pulse = quantEngine.computeBrazilPulse();
      const focus = connectorEngine.getFocusExpectations();
      rows = [
        ...pulse.dimensions.map((d) => ({
          type: 'BRAZIL_PULSE_DIMENSION',
          id: d.id,
          name: d.namePt,
          score_0_100: d.score,
          weight: d.weight,
          value: d.primaryValue,
          unit: d.primaryUnit,
          z_score: d.zScore,
          status: d.dataStatus,
        })),
        ...focus.map((f) => ({
          type: 'FOCUS_EXPECTATION',
          id: `${f.indicator}_${f.referenceYear}`,
          name: `${f.indicator} (${f.referenceYear})`,
          score_0_100: null,
          weight: null,
          value: f.median,
          unit: `mean=${f.mean} sd=${f.stdDev}`,
          z_score: f.respondents,
          status: f.date,
        })),
      ];
    } else if (scope === 'AUDIT_LOGS') {
      const events = cryptoService.getAuditEvents(500);
      rows = events.map((ev) => ({
        seq: ev.seq,
        id: ev.id,
        timestamp: ev.timestamp,
        actor: ev.actor,
        service: ev.service,
        action: ev.action,
        resource: ev.resource,
        outcome: ev.outcome,
        prev_hash: ev.prevHash,
        hash: ev.hash,
        metadata: JSON.stringify(ev.metadata ?? {}),
      }));
    }

    let content = '';
    let contentType = 'application/json; charset=utf-8';
    const baseName = `sygma_export_${scope.toLowerCase()}_${stamp}`;

    if (format === 'csv') {
      contentType = 'text/csv; charset=utf-8';
      if (rows.length === 0) {
        content = '# SYGMA AIS - No records matched filter criteria\n';
      } else {
        const cols = Object.keys(rows[0]);
        const esc = (v: unknown) => {
          if (v === null || v === undefined) return '';
          const s = String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        };
        content = [
          `# SYGMA BRAZIL ECONOMIC INTELLIGENCE AI | Scope: ${scope} | Range: ${range} | Generated: ${new Date().toISOString()}`,
          cols.join(','),
          ...rows.map((r) => cols.map((c) => esc(r[c])).join(',')),
        ].join('\n');
      }
    } else {
      content = JSON.stringify(
        {
          brand: 'SYGMA AIS — SYGMA BRAZIL ECONOMIC INTELLIGENCE AI',
          scope,
          range,
          generatedAt: new Date().toISOString(),
          recordCount: rows.length,
          records: rows,
        },
        null,
        2
      );
    }

    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    return {
      filename: `${baseName}.${format}`,
      contentType,
      content,
      sha256,
      recordCount: rows.length,
    };
  }

  public renderCsv(type: ReportType): string {
    const data = this.buildReportPayload(type);
    const header = [
      'indicator_id',
      'code',
      'name',
      'category',
      'value',
      'unit',
      'reference_date',
      'change_pct',
      'data_status',
      'source',
    ].join(',');

    const rows = data.snapshots.map((s) =>
      [
        s.id,
        s.code,
        `"${s.name.replace(/"/g, '""')}"`,
        s.category,
        s.value ?? '',
        `"${s.unit}"`,
        s.date ?? '',
        s.changePct ?? '',
        s.status,
        `"${s.source.replace(/"/g, '""')}"`,
      ].join(',')
    );

    return [
      `# SYGMA BRAZIL ECONOMIC INTELLIGENCE AI (${data.reproducibilityHash.slice(0, 16)})`,
      `# Generated At: ${data.generatedAt}`,
      header,
      ...rows,
    ].join('\n');
  }

  public renderHtml(type: ReportType, context?: PdfExportContext): string {
    const data = this.buildReportPayload(type);
    const swot = data.consolidatedSwot ?? this.buildConsolidatedSwotAnalysis();
    const resolvedUser = context?.userIdentification?.trim() || 'Operador Institucional SYGMA AIS (Terminal Web)';

    const rowsHtml = data.snapshots
      .map(
        (s) => `
      <tr>
        <td>${s.code}</td>
        <td>${s.name}</td>
        <td style="text-align:right;font-family:monospace;">${s.value !== null ? s.value.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : 'MISSING'} ${s.unit}</td>
        <td style="text-align:right;font-family:monospace;">${s.changePct !== null ? `${s.changePct > 0 ? '+' : ''}${s.changePct}%` : '—'}</td>
        <td>${s.date ?? '—'}</td>
        <td><strong>${s.status}</strong></td>
        <td>${s.source}</td>
      </tr>`
      )
      .join('');

    const scenRows = swot.stressScenariosPlain
      .map(
        (sc) => `
      <tr>
        <td><strong>${sc.code}</strong></td>
        <td>${sc.namePt}</td>
        <td style="text-align:right;font-family:monospace;color:${sc.estimatedPortfolioImpactPct >= 0 ? '#047857' : '#b91c1c'};"><strong>${sc.estimatedPortfolioImpactPct > 0 ? '+' : ''}${sc.estimatedPortfolioImpactPct.toFixed(2)}%</strong></td>
        <td style="text-align:right;font-family:monospace;">R$ ${(sc.estimatedBrlImpactPer100M / 1_000_000).toFixed(2)}M</td>
        <td>${sc.plainLanguageImpact}</td>
      </tr>`
      )
      .join('');

    const renderSwotList = (items: SwotItem[]) =>
      items
        .map(
          (it) =>
            `<li><strong>${it.title}</strong><br/><span style="font-size:11px;color:#334155;">${it.plainLanguage}</span><br/><code style="font-size:10px;color:#0f172a;">Evidência: ${it.evidence}</code></li>`
        )
        .join('');

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${data.title}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 24px auto; max-width: 960px; line-height: 1.5; }
  h1, h2 { color: #0A2540; margin: 18px 0 6px; page-break-after: avoid; }
  .header-banner { background: #0A2540; color: #ffffff; padding: 18px 20px; border-radius: 6px; margin-bottom: 16px; }
  .header-banner small { color: #5CD9F5; font-weight: 700; letter-spacing: 0.04em; display: block; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #475569; border-bottom: 1px solid #cbd5e1; padding-bottom: 10px; margin-bottom: 16px; }
  .print-btn { background: #00B4D8; color: #061827; border: none; padding: 8px 14px; font-weight: 700; border-radius: 4px; cursor: pointer; float: right; }
  .summary-box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 14px; border-radius: 6px; margin-bottom: 18px; }
  .disclaimer-box { background: #f8fafc; border: 1.5px solid #0A2540; padding: 14px; border-radius: 6px; margin-top: 20px; page-break-inside: avoid; font-size: 11.5px; }
  .swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0 24px; page-break-inside: avoid; }
  .swot-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; background: #ffffff; }
  .swot-card h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em; }
  .swot-card ul { margin: 0; padding-left: 16px; font-size: 12px; }
  .swot-card li { margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 10px 0 22px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #0A2540; color: #ffffff; }
  @media print { .no-print { display: none; } body { margin: 0; } .header-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; } th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Imprimir / Salvar PDF A4</button>
  <div class="header-banner">
    <small>SYGMA AIS · SYGMA BRAZIL ECONOMIC INTELLIGENCE AI</small>
    <h1 style="color:#ffffff;margin:0;font-size:20px;">${data.title}</h1>
  </div>
  <div class="meta">
    <strong>Emissão:</strong> ${data.generatedAt} · <strong>Identificação Usuário:</strong> ${resolvedUser} · <strong>Qualidade Global:</strong> ${data.dataQualitySummary.overallStatus} ·
    <strong>SHA-256 Reprodutibilidade:</strong> <code>${data.reproducibilityHash.slice(0, 24)}</code>
  </div>

  <h2>1. Resumo Executivo em Linguagem Simples</h2>
  <div class="summary-box">
    <p style="margin-top:0;font-weight:700;">${swot.plainLanguageHeadline}</p>
    ${swot.plainLanguageSummary.map((p) => `<p style="margin:6px 0;font-size:13px;">${p}</p>`).join('')}
  </div>

  <h2>2. Matriz SWOT — Panorama Econômico Brasileiro</h2>
  <div class="swot-grid">
    <div class="swot-card"><h3 style="color:#047857;">Forças (Interno · Positivo)</h3><ul>${renderSwotList(swot.swotMatrix.strengths)}</ul></div>
    <div class="swot-card"><h3 style="color:#b91c1c;">Fraquezas (Interno · Vulnerabilidades)</h3><ul>${renderSwotList(swot.swotMatrix.weaknesses)}</ul></div>
    <div class="swot-card"><h3 style="color:#0369a1;">Oportunidades (Externo · Favorável)</h3><ul>${renderSwotList(swot.swotMatrix.opportunities)}</ul></div>
    <div class="swot-card"><h3 style="color:#b45309;">Ameaças (Externo · Riscos)</h3><ul>${renderSwotList(swot.swotMatrix.threats)}</ul></div>
  </div>

  <h2>3. Todos os Cenários de Estresse (A–J) — Impacto na Carteira e Significado Prático</h2>
  <table>
    <thead><tr><th>Cód.</th><th>Cenário Hipotético</th><th>Impacto %</th><th>Por R$ 100M</th><th>Explicação em Linguagem Simples</th></tr></thead>
    <tbody>${scenRows}</tbody>
  </table>

  <h2>4. Tabela Auditada de Indicadores e Status de Confiabilidade</h2>
  <table>
    <thead><tr><th>Código</th><th>Indicador</th><th>Valor</th><th>Var. %</th><th>Data Ref.</th><th>Status</th><th>Fonte</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <h2>5. Institutional Disclaimers (Avisos Institucionais & Conformidade)</h2>
  <div class="disclaimer-box">
    <p style="margin:0 0 6px;"><strong>Timestamp UTC:</strong> ${data.generatedAt} · <strong>User Identification:</strong> ${resolvedUser} · <strong>SHA-256:</strong> <code>${data.reproducibilityHash}</code></p>
    <p style="margin:0;color:#991b1b;font-weight:700;">MANDATORY COMPLIANCE NOTICE — FINANCIAL ADVISORY DISCLAIMER (CVM / ANBIMA / SEC):</p>
    <p style="margin:4px 0 0;color:#334155;">Este documento foi gerado pela plataforma SYGMA AIS exclusivamente para fins informativos e analíticos quantitativos. NÃO constitui consultoria financeira, recomendação personalizada de investimentos ou oferta de valores mobiliários (Resoluções CVM 19/2021 e 20/2021). Simulações Monte Carlo e cenários hipotéticos (A–J) não garantem retornos futuros.</p>
  </div>
</body>
</html>`;
  }

  public renderPdf(type: ReportType, context?: PdfExportContext): Promise<Buffer> {
    const data = this.buildReportPayload(type);
    const swot = data.consolidatedSwot ?? this.buildConsolidatedSwotAnalysis();

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 44, bottom: 48, left: 40, right: 40 },
        bufferPages: true,
        info: {
          Title: sanitizePdfText(data.title),
          Author: 'SYGMA AIS - SYGMA BRAZIL ECONOMIC INTELLIGENCE AI',
          Subject: 'Institutional Economic Intelligence, Scenarios & Brazil SWOT Matrix',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = 515;
      const leftX = 40;

      const ensureSpace = (needed: number) => {
        if (doc.y + needed > 765) {
          doc.addPage();
        }
      };

      const sectionTitle = (title: string) => {
        ensureSpace(34);
        doc.moveDown(0.5);
        doc.fillColor('#0A2540').font('Helvetica-Bold').fontSize(11).text(sanitizePdfText(title), leftX, doc.y);
        doc.moveTo(leftX, doc.y + 2).lineTo(leftX + pageW, doc.y + 2).strokeColor('#00B4D8').lineWidth(1).stroke();
        doc.lineWidth(0.5);
        doc.moveDown(0.45);
      };

      // Cover Header Banner (Print-Crisp High-Contrast Header)
      doc.rect(leftX, 34, pageW, 60).fill('#0A2540');
      doc
        .fillColor('#5CD9F5')
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text('SYGMA AIS  |  SYGMA BRAZIL ECONOMIC INTELLIGENCE AI  |  RELATORIO PARA IMPRESSAO A4', leftX + 12, 44);
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(sanitizePdfText(data.title), leftX + 12, 58, { width: pageW - 24 });

      doc.y = 104;
      doc
        .fillColor('#334155')
        .font('Helvetica')
        .fontSize(8)
        .text(
          sanitizePdfText(
            `Emitido em: ${data.generatedAt}   |   Qualidade: ${data.dataQualitySummary.overallStatus}   |   SHA-256: ${data.reproducibilityHash.slice(0, 28)}`
          ),
          leftX
        );

      // 1. Plain Language Executive Summary
      sectionTitle('1. Analise Consolidada do Panorama Brasileiro (Linguagem Simples)');
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9.5).text(sanitizePdfText(swot.plainLanguageHeadline), leftX, doc.y, { width: pageW });
      doc.moveDown(0.35);
      for (const para of swot.plainLanguageSummary) {
        ensureSpace(32);
        doc.fillColor('#1E293B').font('Helvetica').fontSize(8.5).text(sanitizePdfText(para), leftX, doc.y, { width: pageW, lineGap: 1.5 });
        doc.moveDown(0.25);
      }

      // 2. Brazil SWOT Matrix (4-Quadrant Print Grid)
      sectionTitle('2. Matriz SWOT do Brasil (Baseada em Dados Oficiais e de Mercado)');
      const quadrants: Array<{ title: string; color: string; bg: string; items: SwotItem[] }> = [
        { title: 'FORCAS (Interno · Positivo)', color: '#047857', bg: '#ECFDF5', items: swot.swotMatrix.strengths },
        { title: 'FRAQUEZAS (Interno · Vulneravel)', color: '#B91C1C', bg: '#FEF2F2', items: swot.swotMatrix.weaknesses },
        { title: 'OPORTUNIDADES (Externo · Favoravel)', color: '#0369A1', bg: '#F0F9FF', items: swot.swotMatrix.opportunities },
        { title: 'AMEACAS (Externo · Riscos)', color: '#B45309', bg: '#FFFBEB', items: swot.swotMatrix.threats },
      ];

      for (let row = 0; row < 2; row++) {
        ensureSpace(178);
        const startY = doc.y;
        const colW = (pageW - 10) / 2;
        const boxH = 166;
        for (let col = 0; col < 2; col++) {
          const q = quadrants[row * 2 + col];
          const x = leftX + col * (colW + 10);
          doc.rect(x, startY, colW, boxH).fillAndStroke(q.bg, '#CBD5E1');
          doc.fillColor(q.color).font('Helvetica-Bold').fontSize(8.5).text(sanitizePdfText(q.title), x + 8, startY + 7, { width: colW - 16 });
          let cy = startY + 21;
          for (const item of q.items) {
            doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5).text(`* ${sanitizePdfText(item.title)}`, x + 8, cy, { width: colW - 16 });
            cy = doc.y;
            doc.fillColor('#334155').font('Helvetica').fontSize(7).text(sanitizePdfText(`${item.plainLanguage} (${item.evidence})`), x + 12, cy, { width: colW - 20 });
            cy = doc.y + 3;
          }
        }
        doc.y = startY + boxH + 8;
      }

      // 3. Brazil Economic Pulse (10 Dimensions)
      sectionTitle('3. Brazil Economic Pulse - As 10 Dimensoes da Economia');
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9).text(
        sanitizePdfText(`Score Composto: ${data.pulse.compositeScore ?? 'N/D'} / 100 (${data.pulse.assessment})`),
        leftX
      );
      doc.fillColor('#475569').font('Helvetica').fontSize(7.5).text(sanitizePdfText(data.pulse.methodology.disclaimer), leftX, doc.y, { width: pageW });
      doc.moveDown(0.3);

      for (const dim of data.pulse.dimensions) {
        ensureSpace(14);
        const y = doc.y;
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5).text(sanitizePdfText(dim.namePt), leftX, y, { width: 195 });
        doc.font('Courier').text(`${dim.score.toFixed(1)}/100`, leftX + 200, y, { width: 55, align: 'right' });
        doc.font('Helvetica').text(sanitizePdfText(dim.statusLabelPt), leftX + 262, y, { width: 70 });
        doc.font('Courier').text(
          dim.primaryValue !== null ? sanitizePdfText(`${dim.primaryValue.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${dim.primaryUnit}`) : 'N/D',
          leftX + 338,
          y,
          { width: 110, align: 'right' }
        );
        doc.fillColor('#475569').text(dim.dataStatus, leftX + 455, y, { width: 60, align: 'right' });
        doc.moveTo(leftX, y + 11).lineTo(leftX + pageW, y + 11).strokeColor('#E2E8F0').stroke();
        doc.y = y + 13;
      }

      // 4. Econometric Multi-Scenario Projections
      sectionTitle('4. Cenarios Macroeconomicos Projetados (ARIMA-Damped + GARCH 1,1)');
      for (const fc of swot.macroForecastScenarios) {
        ensureSpace(42);
        doc
          .fillColor('#0A2540')
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .text(sanitizePdfText(`${fc.name} (${fc.unit}) - Atual: ${fmtNum(fc.currentValue)}`), leftX);
        doc
          .fillColor('#0F172A')
          .font('Courier')
          .fontSize(7.5)
          .text(
            sanitizePdfText(
              `Horizonte ${fc.horizonDate}: Base ${fmtNum(fc.baseCentral)} | Otimista ${fmtNum(fc.optimistic)} | Adverso ${fmtNum(fc.adverse)} | Estresse ${fmtNum(fc.severeStress)} | IC90%: ${fc.confidence90Band} (MAE=${fc.mae}, MASE=${fc.mase})`
            ),
            leftX,
            doc.y,
            { width: pageW }
          );
        doc.fillColor('#334155').font('Helvetica').fontSize(7.5).text(sanitizePdfText(fc.plainInterpretation), leftX, doc.y, { width: pageW });
        doc.moveDown(0.25);
      }

      // 5. All 10 Stress Scenarios (A-J)
      sectionTitle('5. Todos os 10 Cenarios de Estresse Hipoteticos (A-J) e Risco Monte Carlo');
      doc
        .fillColor('#0F172A')
        .font('Courier')
        .fontSize(8)
        .text(
          sanitizePdfText(
            `Carteira Referencia (35% IBOV, 25% USD/BRL, 20% Brent, 20% VALE3) | VaR Hist 95%: -${data.riskMetrics.historicalVar95Pct}% | VaR MC 95% (10k): -${data.riskMetrics.monteCarloVar95Pct}% | CVaR 95%: -${data.riskMetrics.expectedShortfall95Pct}% | Vol Anual: ${data.riskMetrics.annualizedVolatilityPct}% | Max DD: ${data.riskMetrics.maxDrawdownPct}%`
          ),
          leftX,
          doc.y,
          { width: pageW }
        );
      doc.moveDown(0.35);

      for (const sc of swot.stressScenariosPlain) {
        ensureSpace(34);
        const impactColor = sc.estimatedPortfolioImpactPct >= 0 ? '#047857' : '#B91C1C';
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(sanitizePdfText(`[Cenario ${sc.code}] ${sc.namePt} -> `), leftX, doc.y, { continued: true })
          .fillColor(impactColor)
          .font('Courier')
          .text(
            sanitizePdfText(
              `${sc.estimatedPortfolioImpactPct > 0 ? '+' : ''}${sc.estimatedPortfolioImpactPct.toFixed(2)}% (R$ ${(sc.estimatedBrlImpactPer100M / 1_000_000).toFixed(2)}M por R$100M)`
            )
          );
        doc
          .fillColor('#334155')
          .font('Helvetica')
          .fontSize(7.5)
          .text(sanitizePdfText(`Na pratica: ${sc.plainLanguageImpact}`), leftX + 10, doc.y, { width: pageW - 10 });
        doc.moveDown(0.2);
      }

      // 6. Full Audited Indicators Table
      sectionTitle('6. Painel Auditado Completo de Indicadores (39 Series Monitoradas)');
      const drawTableHeader = () => {
        const y = doc.y;
        doc.rect(leftX, y, pageW, 15).fill('#0A2540');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.2);
        doc.text('CODIGO', leftX + 4, y + 4, { width: 68 });
        doc.text('INDICADOR', leftX + 74, y + 4, { width: 175 });
        doc.text('VALOR', leftX + 252, y + 4, { width: 76, align: 'right' });
        doc.text('VAR %', leftX + 332, y + 4, { width: 46, align: 'right' });
        doc.text('DATA REF', leftX + 384, y + 4, { width: 60 });
        doc.text('STATUS', leftX + 448, y + 4, { width: 62 });
        doc.y = y + 17;
      };
      drawTableHeader();

      data.snapshots.forEach((s, idx) => {
        if (doc.y > 745) {
          doc.addPage();
          drawTableHeader();
        }
        const y = doc.y;
        if (idx % 2 === 1) {
          doc.rect(leftX, y - 1, pageW, 13).fill('#F8FAFC');
        }
        const valText =
          s.value !== null
            ? sanitizePdfText(`${s.value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${s.unit}`)
            : 'MISSING';
        const chgText = s.changePct !== null ? `${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}%` : '-';

        doc.fillColor('#0F172A').font('Courier').fontSize(7.2).text(sanitizePdfText(s.code), leftX + 4, y + 1, { width: 68 });
        doc.font('Helvetica').fontSize(7.2).text(sanitizePdfText(s.name), leftX + 74, y + 1, { width: 175 });
        doc.font('Courier').text(valText, leftX + 252, y + 1, { width: 76, align: 'right' });
        doc
          .fillColor((s.changePct ?? 0) >= 0 ? '#047857' : '#B91C1C')
          .text(chgText, leftX + 332, y + 1, { width: 46, align: 'right' });
        doc.fillColor('#334155').text(s.date ?? '-', leftX + 384, y + 1, { width: 60 });
        doc.font('Helvetica-Bold').text(s.status, leftX + 448, y + 1, { width: 62 });
        doc.y = y + 13;
      });

      // 7. Focus Expectations
      if (data.focusExpectations.length > 0) {
        sectionTitle('7. Expectativas Oficiais do Boletim Focus (BCB Olinda)');
        for (const f of data.focusExpectations.slice(0, 14)) {
          ensureSpace(13);
          doc
            .fillColor('#1E293B')
            .font('Courier')
            .fontSize(7.5)
            .text(
              sanitizePdfText(
                `${f.indicator.padEnd(14)} | Ano ${f.referenceYear} | Mediana: ${f.median.toFixed(2)} | Media: ${f.mean.toFixed(2)} | Min/Max: ${f.min.toFixed(2)}/${f.max.toFixed(2)} (Ref: ${f.date})`
              ),
              leftX
            );
        }
      }

      // 8. Mandatory Institutional Disclaimers
      appendInstitutionalDisclaimersPdf(doc, {
        leftX,
        pageW,
        ensureSpace,
        sectionTitle,
        generatedAt: data.generatedAt,
        userIdentification: context?.userIdentification,
        e2eeSessionId: context?.e2eeSessionId,
        sha256: data.reproducibilityHash,
        reportLabel: type,
      });

      // Stamp print page numbers & footer on all buffered pages
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc
          .fillColor('#64748B')
          .font('Helvetica')
          .fontSize(7.2)
          .text(
            sanitizePdfText(
              `SYGMA AIS  |  Documento Auditavel SHA-256: ${data.reproducibilityHash.slice(0, 20)}  |  Pagina ${i + 1} de ${range.count}`
            ),
            leftX,
            795,
            { width: pageW, align: 'center', lineBreak: false }
          );
      }

      doc.end();
    });
  }

  public renderViewSnapshotPdf(input: ViewPdfExportInput): Promise<{ buffer: Buffer; sha256: string }> {
    const generatedAt = new Date().toISOString();
    const consolidated = this.buildConsolidatedSwotAnalysis();
    const swot = input.swotMatrix ?? consolidated.swotMatrix;
    const pulse = quantEngine.computeBrazilPulse();

    // Use caller's visible snapshots or filter catalog dynamically by caller's filters
    let snapRows = input.snapshots;
    if (!snapRows) {
      const all = connectorEngine.getAllSnapshots();
      const filtered = all.filter((s) => {
        if (input.filters?.categoryFilter && s.definition.category !== input.filters.categoryFilter) {
          return false;
        }
        if (input.filters?.searchQuery) {
          const q = input.filters.searchQuery.toLowerCase();
          const hit =
            s.definition.code.toLowerCase().includes(q) ||
            s.definition.namePt.toLowerCase().includes(q) ||
            s.definition.nameEn.toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      });
      snapRows = filtered.map((s) => ({
        code: s.definition.code,
        name: s.definition.namePt,
        category: s.definition.category,
        value: s.latest?.value ?? null,
        unit: s.definition.unit,
        changePct: s.changePct,
        date: s.latest?.date ?? null,
        status: s.status,
        source: s.latest?.sourceName ?? s.definition.providerId,
      }));
    }

    const digestInput = JSON.stringify({
      viewTitle: input.viewTitle,
      activeView: input.activeView,
      filters: input.filters ?? {},
      snapshotCount: snapRows.length,
      tablesCount: input.tables?.length ?? 0,
      swot,
      generatedAt,
    });
    const sha256 = crypto.createHash('sha256').update(digestInput).digest('hex');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 44, bottom: 48, left: 40, right: 40 },
        bufferPages: true,
        info: {
          Title: sanitizePdfText(`SYGMA AIS - ${input.viewTitle}`),
          Author: 'SYGMA AIS - SYGMA BRAZIL ECONOMIC INTELLIGENCE AI',
          Subject: `Exportacao Institucional da Visualizacao: ${input.activeView}`,
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), sha256 }));
      doc.on('error', reject);

      const pageW = 515;
      const leftX = 40;

      const ensureSpace = (needed: number) => {
        if (doc.y + needed > 760) {
          doc.addPage();
        }
      };

      const sectionTitle = (title: string) => {
        ensureSpace(34);
        doc.moveDown(0.45);
        doc.fillColor('#0A2540').font('Helvetica-Bold').fontSize(10.5).text(sanitizePdfText(title), leftX, doc.y);
        doc.moveTo(leftX, doc.y + 2).lineTo(leftX + pageW, doc.y + 2).strokeColor('#00B4D8').lineWidth(1).stroke();
        doc.lineWidth(0.5);
        doc.moveDown(0.4);
      };

      // Institutional SYGMA AIS Header Banner
      doc.rect(leftX, 34, pageW, 64).fill('#0A2540');
      doc
        .fillColor('#5CD9F5')
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text('SYGMA AIS  |  SYGMA BRAZIL ECONOMIC INTELLIGENCE AI  |  EXPORTACAO DE VISUALIZACAO (A4)', leftX + 12, 43);
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(sanitizePdfText(input.viewTitle), leftX + 12, 57, { width: pageW - 24 });
      doc
        .fillColor('#CBD5E1')
        .font('Courier')
        .fontSize(7.5)
        .text(
          sanitizePdfText(`MODULO: ${input.activeView}   |   BRAZIL PULSE: ${pulse.compositeScore ?? 'N/D'}/100 (${pulse.assessment})`),
          leftX + 12,
          78,
          { width: pageW - 24 }
        );

      doc.y = 108;
      doc
        .fillColor('#334155')
        .font('Helvetica')
        .fontSize(8)
        .text(
          sanitizePdfText(
            `Emitido em: ${generatedAt}   |   SHA-256 Estado: ${sha256.slice(0, 28)}   |   Filtros: ${
              input.filters?.categoryFilter || 'Todos'
            }${input.filters?.searchQuery ? ` · Busca "${input.filters.searchQuery}"` : ''}${
              input.filters?.watchlistIds?.length ? ` · Watchlist (${input.filters.watchlistIds.length})` : ''
            }`
          ),
          leftX,
          doc.y,
          { width: pageW }
        );

      // 1. Snapshot Executive Context
      sectionTitle('1. Resumo Executivo do Estado Atual');
      doc
        .fillColor('#0F172A')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(sanitizePdfText(consolidated.plainLanguageHeadline), leftX, doc.y, { width: pageW });
      doc.moveDown(0.25);
      for (const p of consolidated.plainLanguageSummary.slice(0, 3)) {
        ensureSpace(26);
        doc.fillColor('#334155').font('Helvetica').fontSize(8).text(sanitizePdfText(p), leftX, doc.y, { width: pageW });
        doc.moveDown(0.18);
      }

      // 2. Visible Snapshots Table
      if (snapRows.length > 0) {
        sectionTitle(`2. Snapshots da Visualizacao Atual (${snapRows.length} Indicadores)`);
        const drawSnapHeader = () => {
          const y = doc.y;
          doc.rect(leftX, y, pageW, 15).fill('#0A2540');
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.2);
          doc.text('CODIGO', leftX + 4, y + 4, { width: 68 });
          doc.text('INDICADOR', leftX + 74, y + 4, { width: 175 });
          doc.text('VALOR', leftX + 252, y + 4, { width: 76, align: 'right' });
          doc.text('VAR %', leftX + 332, y + 4, { width: 46, align: 'right' });
          doc.text('DATA REF', leftX + 384, y + 4, { width: 60 });
          doc.text('STATUS', leftX + 448, y + 4, { width: 62 });
          doc.y = y + 17;
        };
        drawSnapHeader();

        snapRows.forEach((s, idx) => {
          if (doc.y > 745) {
            doc.addPage();
            drawSnapHeader();
          }
          const y = doc.y;
          if (idx % 2 === 1) {
            doc.rect(leftX, y - 1, pageW, 13).fill('#F8FAFC');
          }
          const valText =
            s.value !== null
              ? sanitizePdfText(`${s.value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${s.unit}`)
              : 'MISSING';
          const chgText = s.changePct !== null ? `${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}%` : '-';

          doc.fillColor('#0F172A').font('Courier').fontSize(7.2).text(sanitizePdfText(s.code), leftX + 4, y + 1, { width: 68 });
          doc.font('Helvetica').fontSize(7.2).text(sanitizePdfText(s.name), leftX + 74, y + 1, { width: 175 });
          doc.font('Courier').text(valText, leftX + 252, y + 1, { width: 76, align: 'right' });
          doc
            .fillColor((s.changePct ?? 0) >= 0 ? '#047857' : '#B91C1C')
            .text(chgText, leftX + 332, y + 1, { width: 46, align: 'right' });
          doc.fillColor('#334155').text(s.date ?? '-', leftX + 384, y + 1, { width: 60 });
          doc.font('Helvetica-Bold').text(sanitizePdfText(s.status), leftX + 448, y + 1, { width: 62 });
          doc.y = y + 13;
        });
      }

      // 3. Dynamic View Tables (if provided by active view)
      if (input.tables && input.tables.length > 0) {
        input.tables.forEach((tbl, tIdx) => {
          sectionTitle(`3.${tIdx + 1}. ${tbl.title}`);
          const colCount = Math.max(1, Math.min(6, tbl.columns.length));
          const colW = pageW / colCount;

          const drawCustomHdr = () => {
            const y = doc.y;
            doc.rect(leftX, y, pageW, 15).fill('#0A2540');
            doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7);
            tbl.columns.slice(0, colCount).forEach((c, ci) => {
              doc.text(sanitizePdfText(c), leftX + ci * colW + 4, y + 4, { width: colW - 8 });
            });
            doc.y = y + 17;
          };
          drawCustomHdr();

          tbl.rows.slice(0, 60).forEach((row, rIdx) => {
            if (doc.y > 745) {
              doc.addPage();
              drawCustomHdr();
            }
            const y = doc.y;
            if (rIdx % 2 === 1) {
              doc.rect(leftX, y - 1, pageW, 13).fill('#F8FAFC');
            }
            doc.fillColor('#0F172A').font('Helvetica').fontSize(7);
            row.slice(0, colCount).forEach((cell, ci) => {
              const txt = cell === null || cell === undefined ? '-' : String(cell);
              doc.text(sanitizePdfText(txt), leftX + ci * colW + 4, y + 1, { width: colW - 8, ellipsis: true, lineBreak: false });
            });
            doc.y = y + 13;
          });
        });
      }

      // 4. Institutional SWOT Matrix (Preserved on every view export or customized from SWOT Dashboard)
      if (input.includeSwot !== false) {
        sectionTitle('4. Matriz SWOT Institucional - Panorama Brasileiro');
        const quadrants: Array<{ title: string; color: string; bg: string; items: SwotItem[] }> = [
          { title: 'FORCAS (Interno · Positivo)', color: '#047857', bg: '#ECFDF5', items: swot.strengths.slice(0, 6) },
          { title: 'FRAQUEZAS (Interno · Vulneravel)', color: '#B91C1C', bg: '#FEF2F2', items: swot.weaknesses.slice(0, 6) },
          { title: 'OPORTUNIDADES (Externo · Favoravel)', color: '#0369A1', bg: '#F0F9FF', items: swot.opportunities.slice(0, 6) },
          { title: 'AMEACAS (Externo · Riscos)', color: '#B45309', bg: '#FFFBEB', items: swot.threats.slice(0, 6) },
        ];

        for (let row = 0; row < 2; row++) {
          const maxItems = Math.max(quadrants[row * 2].items.length, quadrants[row * 2 + 1].items.length);
          const boxH = Math.max(150, 34 + maxItems * 32);
          ensureSpace(boxH + 10);
          const startY = doc.y;
          const colW = (pageW - 10) / 2;
          for (let col = 0; col < 2; col++) {
            const q = quadrants[row * 2 + col];
            const x = leftX + col * (colW + 10);
            doc.rect(x, startY, colW, boxH).fillAndStroke(q.bg, '#CBD5E1');
            doc.fillColor(q.color).font('Helvetica-Bold').fontSize(8.5).text(sanitizePdfText(q.title), x + 8, startY + 7, { width: colW - 16 });
            let cy = startY + 21;
            for (const item of q.items) {
              if (cy > startY + boxH - 18) break;
              doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.4).text(`* ${sanitizePdfText(item.title)}`, x + 8, cy, { width: colW - 16 });
              cy = doc.y;
              doc.fillColor('#334155').font('Helvetica').fontSize(6.9).text(sanitizePdfText(`${item.plainLanguage} (${item.evidence})`), x + 12, cy, { width: colW - 20 });
              cy = doc.y + 3;
            }
          }
          doc.y = startY + boxH + 8;
        }
      }

      // 5. Optional Stress Scenarios summary
      if (input.includeStressScenarios) {
        sectionTitle('5. Cenarios de Estresse Hipoteticos (A-J)');
        for (const sc of consolidated.stressScenariosPlain) {
          ensureSpace(26);
          doc
            .fillColor('#0F172A')
            .font('Helvetica-Bold')
            .fontSize(7.8)
            .text(sanitizePdfText(`[${sc.code}] ${sc.namePt}: `), leftX, doc.y, { continued: true })
            .fillColor(sc.estimatedPortfolioImpactPct >= 0 ? '#047857' : '#B91C1C')
            .font('Courier')
            .text(`${sc.estimatedPortfolioImpactPct > 0 ? '+' : ''}${sc.estimatedPortfolioImpactPct.toFixed(2)}%`);
          doc.fillColor('#334155').font('Helvetica').fontSize(7.2).text(sanitizePdfText(sc.plainLanguageImpact), leftX + 10, doc.y, { width: pageW - 10 });
          doc.moveDown(0.15);
        }
      }

      // Mandatory Institutional Disclaimers on every exported view PDF
      appendInstitutionalDisclaimersPdf(doc, {
        leftX,
        pageW,
        ensureSpace,
        sectionTitle,
        generatedAt,
        userIdentification: input.userIdentification,
        e2eeSessionId: input.e2eeSessionId,
        sha256,
        reportLabel: input.activeView,
      });

      // Stamp SYGMA AIS institutional footer & page numbering
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc
          .fillColor('#64748B')
          .font('Helvetica')
          .fontSize(7.2)
          .text(
            sanitizePdfText(
              `SYGMA AIS  |  SYGMA BRAZIL ECONOMIC INTELLIGENCE AI  |  SHA-256: ${sha256.slice(0, 18)}  |  Pagina ${i + 1} de ${range.count}`
            ),
            leftX,
            795,
            { width: pageW, align: 'center', lineBreak: false }
          );
      }

      doc.end();
    });
  }
}

export const reportService = new ReportService();
