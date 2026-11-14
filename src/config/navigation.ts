export type ViewMode =
  | 'EXECUTIVE'
  | 'SWOT_DASHBOARD'
  | 'PULSE'
  | 'MARKETS'
  | 'MACRO'
  | 'INTERNATIONAL'
  | 'QUANT_CORRELATION'
  | 'QUANT_FORECAST'
  | 'QUANT_RISK'
  | 'INDICATORS_DB'
  | 'AI_ANALYST'
  | 'NEWS_CALENDAR'
  | 'ALERTS_CENTER'
  | 'QUALITY_FEEDBACK'
  | 'PROVIDERS'
  | 'REPORTS'
  | 'SCHEDULES'
  | 'SECURITY_AUDIT';

export interface NavItem {
  id: string;
  labelPt: string;
  labelEn: string;
  view: ViewMode;
  defaultIndicatorId?: string;
  categoryFilter?: string;
}

export interface NavGroup {
  id: string;
  code: string;
  titlePt: string;
  titleEn: string;
  items: NavItem[];
}

export const NAVIGATION_GROUPS: NavGroup[] = [
  {
    id: 'exec',
    code: 'A',
    titlePt: 'Inteligência Executiva',
    titleEn: 'Executive Intelligence',
    items: [
      { id: 'exec-overview', labelPt: 'Visão Geral Executiva', labelEn: 'Executive Overview', view: 'EXECUTIVE' },
      { id: 'swot-dashboard', labelPt: 'Dashboard SWOT Brasil', labelEn: 'Brazil SWOT Dashboard', view: 'SWOT_DASHBOARD' },
      { id: 'brazil-pulse', labelPt: 'Brazil Economic Pulse', labelEn: 'Brazil Economic Pulse', view: 'PULSE' },
      { id: 'global-pulse', labelPt: 'Pulso Econômico Global', labelEn: 'Global Economic Pulse', view: 'INTERNATIONAL' },
      { id: 'risk-index', labelPt: 'Índice de Risco Econômico', labelEn: 'Economic Risk Index', view: 'QUANT_RISK' },
      { id: 'daily-briefing', labelPt: 'Briefing Diário AI', labelEn: 'Daily Intelligence Briefing', view: 'AI_ANALYST' },
    ],
  },
  {
    id: 'markets',
    code: 'B',
    titlePt: 'Mercados Financeiros',
    titleEn: 'Financial Markets',
    items: [
      { id: 'mkt-live', labelPt: 'Mercados e Cotações', labelEn: 'Market Quotations', view: 'MARKETS', defaultIndicatorId: 'USD_BRL_PTAX' },
      { id: 'mkt-b3', labelPt: 'Bolsa Brasileira (B3)', labelEn: 'Brazilian Stock Exchange', view: 'MARKETS', defaultIndicatorId: 'IBOV', categoryFilter: 'EQUITIES_BR' },
      { id: 'mkt-global', labelPt: 'Bolsas Internacionais', labelEn: 'International Stock Markets', view: 'MARKETS', defaultIndicatorId: 'SP500', categoryFilter: 'EQUITIES_GLOBAL' },
      { id: 'mkt-fx', labelPt: 'Câmbio e PTAX', labelEn: 'Foreign Exchange', view: 'MARKETS', defaultIndicatorId: 'USD_BRL_PTAX', categoryFilter: 'FX' },
      { id: 'mkt-rates', labelPt: 'Taxas de Juros (Selic / CDI)', labelEn: 'Interest Rates', view: 'MACRO', defaultIndicatorId: 'SELIC_META', categoryFilter: 'MONETARY' },
      { id: 'mkt-commodities', labelPt: 'Commodities Globais', labelEn: 'Commodities', view: 'MARKETS', defaultIndicatorId: 'BRENT', categoryFilter: 'COMMODITIES' },
      { id: 'mkt-vol', labelPt: 'Volatilidade Financeira', labelEn: 'Financial Volatility', view: 'QUANT_RISK' },
    ],
  },
  {
    id: 'macro',
    code: 'C',
    titlePt: 'Economia Brasileira',
    titleEn: 'Brazilian Economy',
    items: [
      { id: 'mac-gdp', labelPt: 'PIB e Atividade (IBC-Br)', labelEn: 'GDP & Growth', view: 'MACRO', defaultIndicatorId: 'IBC_BR', categoryFilter: 'ACTIVITY' },
      { id: 'mac-inf', labelPt: 'Inflação (IPCA / IGP-M)', labelEn: 'Inflation & Prices', view: 'MACRO', defaultIndicatorId: 'IPCA_MENSAL', categoryFilter: 'INFLATION' },
      { id: 'mac-mon', labelPt: 'Política Monetária', labelEn: 'Monetary Policy', view: 'MACRO', defaultIndicatorId: 'SELIC_META', categoryFilter: 'MONETARY' },
      { id: 'mac-fisc', labelPt: 'Política Fiscal e Dívida', labelEn: 'Fiscal Policy & Debt', view: 'MACRO', defaultIndicatorId: 'DIVIDA_BRUTA_PIB', categoryFilter: 'FISCAL' },
      { id: 'mac-labor', labelPt: 'Emprego e Renda (PNAD)', labelEn: 'Employment & Income', view: 'MACRO', defaultIndicatorId: 'DESEMPREGO_PNAD', categoryFilter: 'LABOR' },
      { id: 'mac-credit', labelPt: 'Bancos e Crédito (SFN)', labelEn: 'Banking & Credit', view: 'MACRO', defaultIndicatorId: 'CREDITO_TOTAL', categoryFilter: 'CREDIT' },
      { id: 'mac-trade', labelPt: 'Comércio Exterior e Reservas', labelEn: 'Foreign Trade & Reserves', view: 'MACRO', defaultIndicatorId: 'BALANCA_COMERCIAL', categoryFilter: 'EXTERNAL' },
    ],
  },
  {
    id: 'intl',
    code: 'D',
    titlePt: 'Inteligência Internacional',
    titleEn: 'International Intelligence',
    items: [
      { id: 'intl-us', labelPt: 'Estados Unidos (S&P / US10Y)', labelEn: 'United States', view: 'INTERNATIONAL', defaultIndicatorId: 'US_10Y' },
      { id: 'intl-china', labelPt: 'China e Minério / Soja', labelEn: 'China Exposure', view: 'INTERNATIONAL', defaultIndicatorId: 'SHANGHAI' },
      { id: 'intl-eu', labelPt: 'União Europeia (DAX / EUR)', labelEn: 'European Union', view: 'INTERNATIONAL', defaultIndicatorId: 'DAX' },
    ],
  },
  {
    id: 'quant',
    code: 'E',
    titlePt: 'Análise Quantitativa',
    titleEn: 'Quantitative Analysis',
    items: [
      { id: 'q-db', labelPt: 'Base Histórica e Indicadores', labelEn: 'Historical Database', view: 'INDICATORS_DB' },
      { id: 'q-corr', labelPt: 'Correlação e Granger', labelEn: 'Correlation & Causality', view: 'QUANT_CORRELATION' },
      { id: 'q-fcst', labelPt: 'Previsões Econométricas', labelEn: 'Econometric Forecasts', view: 'QUANT_FORECAST' },
      { id: 'q-risk', labelPt: 'Risco Quantitativo & Stress', labelEn: 'Quantitative Risk & Stress', view: 'QUANT_RISK' },
    ],
  },
  {
    id: 'ai',
    code: 'F',
    titlePt: 'Inteligência Artificial',
    titleEn: 'Artificial Intelligence',
    items: [
      { id: 'ai-analyst', labelPt: 'SYGMA AI Economic Analyst', labelEn: 'SYGMA AI Economic Analyst', view: 'AI_ANALYST' },
      { id: 'ai-news', labelPt: 'Inteligência de Notícias', labelEn: 'AI News Intelligence', view: 'NEWS_CALENDAR' },
    ],
  },
  {
    id: 'mon',
    code: 'G',
    titlePt: 'Monitoramento',
    titleEn: 'Monitoring',
    items: [
      { id: 'mon-alerts', labelPt: 'Alertas da Watchlist', labelEn: 'Watchlist Alerts', view: 'ALERTS_CENTER' },
      { id: 'mon-news', labelPt: 'Central de Notícias BCB', labelEn: 'News Center', view: 'NEWS_CALENDAR' },
      { id: 'mon-qual', labelPt: 'SYGMA Technical Feedback', labelEn: 'Data Quality & Tech Feedback', view: 'QUALITY_FEEDBACK' },
      { id: 'mon-prov', labelPt: 'Monitoramento de Fontes', labelEn: 'Source Monitoring', view: 'PROVIDERS' },
    ],
  },
  {
    id: 'admin',
    code: 'H',
    titlePt: 'Relatórios & Administração',
    titleEn: 'Reporting & Administration',
    items: [
      { id: 'adm-rep', labelPt: 'Central de Relatórios', labelEn: 'Reports Center', view: 'REPORTS' },
      { id: 'adm-sched', labelPt: 'Agendamentos PDF', labelEn: 'Scheduled Reports', view: 'SCHEDULES' },
      { id: 'adm-prov', labelPt: 'Administração de Provedores', labelEn: 'Provider Administration', view: 'PROVIDERS' },
      { id: 'adm-sec', labelPt: 'Segurança E2EE e Auditoria', labelEn: 'E2EE Security & Audit', view: 'SECURITY_AUDIT' },
    ],
  },
];
