import {
  Bell,
  ChevronDown,
  ChevronRight,
  FileDown,
  Lock,
  Menu,
  Moon,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiAnalystView } from './components/views/AiAnalystView';
import { AlertsCenterView } from './components/views/AlertsCenterView';
import { ExecutiveOverviewView } from './components/views/ExecutiveOverviewView';
import { GovernanceAndTechView } from './components/views/GovernanceAndTechView';
import { MarketAndMacroExplorerView } from './components/views/MarketAndMacroExplorerView';
import { QuantitativeLabView } from './components/views/QuantitativeLabView';
import { ScheduledReportsView } from './components/views/ScheduledReportsView';
import { SWOT_CUSTOM_STORAGE_KEY, SwotDashboardView, type CustomSwotNote } from './components/views/SwotDashboardView';
import { NAVIGATION_GROUPS, type NavItem, type ViewMode } from './config/navigation';
import { sygmaClient, type E2eeSessionTelemetry } from './lib/e2eeClient';
import type {
  AlertRule,
  BrazilPulseReport,
  ConsolidatedSwotReport,
  FocusExpectation,
  IndicatorSnapshot,
  Language,
  NewsItem,
  ProviderStatus,
  ReportSchedule,
  RiskReport,
  ScheduledDeliveryRecord,
  SchedulesStateResponse,
  SentimentAnalysisReport,
  SmtpStatus,
  SwotItem,
  SystemHealthResponse,
  TriggeredAlert,
} from './types/sygma';

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [language, setLanguage] = useState<Language>('pt');
  const [activeNavId, setActiveNavId] = useState('exec-overview');
  const [activeView, setActiveView] = useState<ViewMode>('EXECUTIVE');
  const [selectedIndicatorId, setSelectedIndicatorId] = useState('USD_BRL_PTAX');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    exec: true,
    markets: true,
    macro: true,
    intl: false,
    quant: true,
    ai: true,
    mon: false,
    admin: false,
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Global Data State
  const [snapshots, setSnapshots] = useState<IndicatorSnapshot[]>([]);
  const [focusExpectations, setFocusExpectations] = useState<FocusExpectation[]>([]);
  const [pulse, setPulse] = useState<BrazilPulseReport | null>(null);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [sentiment, setSentiment] = useState<SentimentAnalysisReport | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exportingViewPdf, setExportingViewPdf] = useState(false);
  const [e2eeTelemetry, setE2eeTelemetry] = useState<E2eeSessionTelemetry>(sygmaClient.getTelemetry());
  const [operatorId, setOperatorId] = useState<string>(() => {
    try {
      return localStorage.getItem('sygma_operator_id') ?? '';
    } catch {
      return '';
    }
  });

  // Watchlist Configurable Alerts & Browser Push Notifications
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>([]);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const [bannerAlert, setBannerAlert] = useState<TriggeredAlert | null>(null);
  const [pushEnabled, setPushEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sygma_push_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [pushPermission, setPushPermission] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  );
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const alertsInitializedRef = useRef(false);

  // Scheduled PDF Reports State & Delivery Notifications
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [scheduledDeliveries, setScheduledDeliveries] = useState<ScheduledDeliveryRecord[]>([]);
  const [unreadDeliveriesCount, setUnreadDeliveriesCount] = useState(0);
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus | null>(null);
  const [bannerDelivery, setBannerDelivery] = useState<ScheduledDeliveryRecord | null>(null);
  const seenDeliveryIdsRef = useRef<Set<string>>(new Set());
  const deliveriesInitializedRef = useRef(false);

  // Quick Search & Watchlist
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('sygma_watchlist');
      return saved ? JSON.parse(saved) : ['USD_BRL_PTAX', 'SELIC_META', 'IPCA_MENSAL', 'IBOV'];
    } catch {
      return ['USD_BRL_PTAX', 'SELIC_META', 'IPCA_MENSAL', 'IBOV'];
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('sygma_watchlist', JSON.stringify(watchlist));
    } catch {
      // Ignore storage error
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem('sygma_push_enabled', String(pushEnabled));
    } catch {
      // Ignore storage error
    }
  }, [pushEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('sygma_operator_id', operatorId);
    } catch {
      // Ignore storage error
    }
  }, [operatorId]);

  const handleRequestPushPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushPermission('unsupported');
      return;
    }
    try {
      const res = await window.Notification.requestPermission();
      setPushPermission(res);
    } catch {
      setPushPermission('denied');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const alertRes = await sygmaClient.fetchJson<{
        rules: AlertRule[];
        alerts: TriggeredAlert[];
        unreadCount: number;
      }>('/api/v1/alerts');
      setAlertRules(alertRes.rules);
      setTriggeredAlerts(alertRes.alerts);
      setUnreadAlertCount(alertRes.unreadCount);

      if (!alertsInitializedRef.current) {
        for (const a of alertRes.alerts) seenAlertIdsRef.current.add(a.id);
        alertsInitializedRef.current = true;
      } else {
        for (const a of alertRes.alerts) {
          if (!seenAlertIdsRef.current.has(a.id)) {
            seenAlertIdsRef.current.add(a.id);
            if (!a.acknowledged) {
              setBannerAlert(a);
              if (
                pushEnabled &&
                typeof window !== 'undefined' &&
                'Notification' in window &&
                window.Notification.permission === 'granted'
              ) {
                try {
                  new window.Notification(`SYGMA Alerta: ${a.code}`, {
                    body: `${a.namePt}: variação de ${a.observedPctChange > 0 ? '+' : ''}${a.observedPctChange}% (limiar ±${a.thresholdPct}%)`,
                  });
                } catch {
                  // Ignore iframe notification restrictions
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore transient polling error
    }
  }, [pushEnabled]);

  const loadSchedules = useCallback(async () => {
    try {
      const res = await sygmaClient.fetchJson<SchedulesStateResponse>('/api/v1/schedules');
      setSchedules(res.schedules);
      setScheduledDeliveries(res.deliveries);
      setUnreadDeliveriesCount(res.unreadDeliveriesCount);
      setSmtpStatus(res.smtpStatus);

      if (!deliveriesInitializedRef.current) {
        for (const d of res.deliveries) seenDeliveryIdsRef.current.add(d.id);
        deliveriesInitializedRef.current = true;
      } else {
        for (const d of res.deliveries) {
          if (!seenDeliveryIdsRef.current.has(d.id)) {
            seenDeliveryIdsRef.current.add(d.id);
            if (d.systemStatus === 'STORED' && !d.acknowledged) {
              setBannerDelivery(d);
              if (
                pushEnabled &&
                typeof window !== 'undefined' &&
                'Notification' in window &&
                window.Notification.permission === 'granted'
              ) {
                try {
                  new window.Notification(`SYGMA Relatório PDF Agendado`, {
                    body: `${d.scheduleName} (${d.pdfFilename}) disponível para download no sistema.`,
                  });
                } catch {
                  // Ignore iframe restriction
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore transient polling error
    }
  }, [pushEnabled]);

  const loadAllPlatformData = useCallback(async () => {
    try {
      const [indRes, pulseRes, riskRes, healthRes, provRes, newsRes, sentRes] = await Promise.all([
        sygmaClient.fetchJson<{
          lastGlobalSyncAt: string | null;
          snapshots: IndicatorSnapshot[];
          focusExpectations: FocusExpectation[];
        }>('/api/v1/indicators'),
        sygmaClient.fetchJson<BrazilPulseReport>('/api/v1/quant/pulse'),
        sygmaClient.fetchJson<RiskReport>('/api/v1/quant/risk'),
        sygmaClient.fetchJson<SystemHealthResponse>('/api/v1/health'),
        sygmaClient.fetchJson<{ providers: ProviderStatus[] }>('/api/v1/providers'),
        sygmaClient.fetchJson<{ news: NewsItem[] }>('/api/v1/news'),
        sygmaClient.fetchJson<SentimentAnalysisReport>('/api/v1/sentiment'),
      ]);

      setSnapshots(indRes.snapshots);
      setFocusExpectations(indRes.focusExpectations);
      setLastSyncAt(indRes.lastGlobalSyncAt);
      setPulse(pulseRes);
      setRisk(riskRes);
      setHealth(healthRes);
      setProviders(provRes.providers);
      setNews(newsRes.news);
      setSentiment(sentRes);
      setE2eeTelemetry(sygmaClient.getTelemetry());
      await Promise.all([loadAlerts(), loadSchedules()]);
    } catch {
      setE2eeTelemetry(sygmaClient.getTelemetry());
    }
  }, [loadAlerts, loadSchedules]);

  useEffect(() => {
    loadAllPlatformData();
    // Re-poll after 4s in case initial server sync just finished populating historical series
    const t1 = setTimeout(loadAllPlatformData, 4000);
    const interval = setInterval(loadAllPlatformData, 120_000);
    const schedInterval = setInterval(loadSchedules, 35_000);
    return () => {
      clearTimeout(t1);
      clearInterval(interval);
      clearInterval(schedInterval);
    };
  }, [loadAllPlatformData, loadSchedules]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await sygmaClient.fetchJson('/api/v1/sync', { method: 'POST' });
      await loadAllPlatformData();
    } finally {
      setSyncing(false);
    }
  };

  const handleNavClick = (item: NavItem) => {
    setActiveNavId(item.id);
    setActiveView(item.view);
    if (item.defaultIndicatorId) setSelectedIndicatorId(item.defaultIndicatorId);
    setCategoryFilter(item.categoryFilter);
    setMobileMenuOpen(false);
  };

  const handleToggleWatchlist = (id: string) => {
    setWatchlist((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return snapshots
      .filter(
        (s) =>
          s.definition.code.toLowerCase().includes(q) ||
          s.definition.namePt.toLowerCase().includes(q) ||
          s.definition.nameEn.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [searchQuery, snapshots]);

  const activeNavMeta = useMemo(() => {
    for (const g of NAVIGATION_GROUPS) {
      const found = g.items.find((i) => i.id === activeNavId);
      if (found) return { group: g, item: found };
    }
    return { group: NAVIGATION_GROUPS[0], item: NAVIGATION_GROUPS[0].items[0] };
  }, [activeNavId]);

  const exportCurrentViewPdf = async (overrides?: {
    viewTitle?: string;
    swotMatrix?: {
      strengths: SwotItem[];
      weaknesses: SwotItem[];
      opportunities: SwotItem[];
      threats: SwotItem[];
    };
    visibleSnapshots?: IndicatorSnapshot[];
    customSearch?: string;
  }) => {
    setExportingViewPdf(true);
    try {
      const visibleSnaps =
        overrides?.visibleSnapshots ??
        snapshots.filter((s) => {
          if (categoryFilter && s.definition.category !== categoryFilter) return false;
          if (activeView === 'MARKETS') {
            return ['FX', 'EQUITIES_BR', 'EQUITIES_GLOBAL', 'COMMODITIES'].includes(s.definition.category);
          }
          if (activeView === 'MACRO') {
            return ['MONETARY', 'INFLATION', 'FISCAL', 'ACTIVITY', 'LABOR', 'CREDIT', 'EXTERNAL'].includes(s.definition.category);
          }
          return true;
        });

      const tables: Array<{ title: string; columns: string[]; rows: Array<Array<string | number | null>> }> = [];

      if (pulse && (activeView === 'EXECUTIVE' || activeView === 'PULSE' || activeView === 'SWOT_DASHBOARD')) {
        tables.push({
          title: `Brazil Economic Pulse (${pulse.compositeScore ?? 'N/D'}/100 - ${pulse.assessment})`,
          columns: ['Dimensão', 'Score', 'Classificação', 'Valor Atual', 'Z-Score', 'Status'],
          rows: pulse.dimensions.map((d) => [
            language === 'pt' ? d.namePt : d.nameEn,
            d.score.toFixed(1),
            language === 'pt' ? d.statusLabelPt : d.statusLabelEn,
            d.primaryValue !== null ? `${d.primaryValue} ${d.primaryUnit}` : 'N/D',
            d.zScore !== null ? d.zScore.toFixed(2) : 'N/D',
            d.dataStatus,
          ]),
        });
      }

      if (risk && (activeView === 'QUANT_RISK' || activeView === 'SWOT_DASHBOARD' || activeView === 'EXECUTIVE')) {
        tables.push({
          title: 'Cenários de Estresse Hipotéticos (A–J)',
          columns: ['Cód.', 'Cenário', 'Impacto %', 'Impacto R$ / 100M', 'Canais de Transmissão'],
          rows: risk.stressScenarios.map((sc) => [
            sc.code,
            sc.namePt,
            `${sc.estimatedPortfolioImpactPct > 0 ? '+' : ''}${sc.estimatedPortfolioImpactPct.toFixed(2)}%`,
            `R$ ${(sc.estimatedBrlImpactPer100M / 1_000_000).toFixed(2)}M`,
            sc.transmissionChannels.join(' · '),
          ]),
        });
      }

      if (activeView === 'ALERTS_CENTER' && triggeredAlerts.length > 0) {
        tables.push({
          title: 'Alertas da Watchlist Disparados',
          columns: ['Código', 'Indicador', 'Var. Observada', 'Limiar', 'Data Ref.', 'Status'],
          rows: triggeredAlerts.map((a) => [
            a.code,
            a.namePt,
            `${a.observedPctChange > 0 ? '+' : ''}${a.observedPctChange}%`,
            `±${a.thresholdPct}%`,
            a.referenceDate,
            a.acknowledged ? 'RECONHECIDO' : 'PENDENTE',
          ]),
        });
      }

      if (activeView === 'SECURITY_AUDIT' && health?.auditEvents?.length) {
        tables.push({
          title: 'Institutional Audit Logs (SHA-256 Merkle Chain)',
          columns: ['Seq', 'Timestamp', 'Serviço', 'Ação', 'Recurso', 'Hash'],
          rows: health.auditEvents.slice(0, 40).map((ev) => [
            ev.seq,
            ev.timestamp.slice(0, 19),
            ev.service,
            ev.action,
            ev.resource,
            ev.hash.slice(0, 16),
          ]),
        });
      }

      if (activeView === 'PROVIDERS' && providers.length > 0) {
        tables.push({
          title: 'Provedores e Conectores de Dados',
          columns: ['ID', 'Provedor', 'Estado', 'Circuito', 'Registros', 'Latência ms'],
          rows: providers.map((p) => [
            p.id,
            p.name,
            p.connectionState,
            p.circuitState,
            p.recordsCollected,
            p.avgLatencyMs,
          ]),
        });
      }

      // Include custom SWOT annotations if user added any in SWOT Dashboard
      let swotMatrix = overrides?.swotMatrix;
      if (!swotMatrix) {
        try {
          const savedRaw = localStorage.getItem(SWOT_CUSTOM_STORAGE_KEY);
          const customNotes = savedRaw ? (JSON.parse(savedRaw) as CustomSwotNote[]) : [];
          if (customNotes.length > 0) {
            const baseSwot = await sygmaClient.fetchJson<ConsolidatedSwotReport>('/api/v1/reports/consolidated-swot');
            swotMatrix = {
              strengths: [
                ...baseSwot.swotMatrix.strengths,
                ...customNotes.filter((n) => n.quadrant === 'strengths').map(({ title, evidence, plainLanguage }) => ({ title, evidence, plainLanguage })),
              ],
              weaknesses: [
                ...baseSwot.swotMatrix.weaknesses,
                ...customNotes.filter((n) => n.quadrant === 'weaknesses').map(({ title, evidence, plainLanguage }) => ({ title, evidence, plainLanguage })),
              ],
              opportunities: [
                ...baseSwot.swotMatrix.opportunities,
                ...customNotes.filter((n) => n.quadrant === 'opportunities').map(({ title, evidence, plainLanguage }) => ({ title, evidence, plainLanguage })),
              ],
              threats: [
                ...baseSwot.swotMatrix.threats,
                ...customNotes.filter((n) => n.quadrant === 'threats').map(({ title, evidence, plainLanguage }) => ({ title, evidence, plainLanguage })),
              ],
            };
          }
        } catch {
          // Fall back to server live SWOT generation
        }
      }

      const resolvedUserIdentification =
        operatorId.trim() ||
        (e2eeTelemetry.keyId
          ? `Operador E2EE (${e2eeTelemetry.keyId})`
          : 'Operador Institucional SYGMA AIS');

      const res = await fetch('/api/v1/export/view-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sygma-user-id': resolvedUserIdentification,
          ...(e2eeTelemetry.keyId ? { 'x-sygma-e2ee-keyid': e2eeTelemetry.keyId } : {}),
        },
        body: JSON.stringify({
          viewTitle: overrides?.viewTitle ?? (language === 'pt' ? activeNavMeta.item.labelPt : activeNavMeta.item.labelEn),
          activeView,
          language,
          userIdentification: resolvedUserIdentification,
          e2eeSessionId: e2eeTelemetry.keyId ?? undefined,
          filters: {
            categoryFilter,
            searchQuery: overrides?.customSearch ?? (searchQuery || undefined),
            selectedIndicatorId,
            watchlistIds: watchlist,
          },
          snapshots: visibleSnaps.map((s) => ({
            code: s.definition.code,
            name: language === 'pt' ? s.definition.namePt : s.definition.nameEn,
            category: s.definition.category,
            value: s.latest?.value ?? null,
            unit: s.definition.unit,
            changePct: s.changePct,
            date: s.latest?.date ?? null,
            status: s.status,
            source: s.latest?.sourceName ?? s.definition.providerId,
          })),
          tables,
          swotMatrix,
          includeSwot: true,
          includeStressScenarios: activeView === 'SWOT_DASHBOARD' || activeView === 'QUANT_RISK' || activeView === 'REPORTS',
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sygma_${activeView.toLowerCase()}_institucional.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportingViewPdf(false);
    }
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-200 dark:border-[#1A334B]">
        <div className="text-[11px] font-mono font-bold tracking-wider text-[#00B4D8]">SYGMA AIS</div>
        <div className="text-xs font-bold text-slate-900 dark:text-[#E6EEF5] truncate">
          BRAZIL ECONOMIC INTELLIGENCE
        </div>
      </div>

      {/* Quick Indicator Search */}
      <div className="p-2.5 border-b border-slate-200 dark:border-[#1A334B] relative">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'pt' ? 'Buscar série (Ctrl+K)...' : 'Search series (Ctrl+K)...'}
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] focus:outline-none focus:border-[#00B4D8]"
          />
        </div>
        {searchResults.length > 0 && (
          <div className="absolute left-2.5 right-2.5 top-11 z-40 rounded border border-slate-300 dark:border-[#1E3A54] bg-white dark:bg-[#061827] shadow-xl max-h-60 overflow-y-auto">
            {searchResults.map((s) => (
              <button
                key={s.definition.id}
                type="button"
                onClick={() => {
                  setSelectedIndicatorId(s.definition.id);
                  setActiveView('MARKETS');
                  setCategoryFilter(undefined);
                  setSearchQuery('');
                  setMobileMenuOpen(false);
                }}
                className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-[#102438] border-b border-slate-100 dark:border-[#1A334B]/50 last:border-0"
              >
                <div className="font-mono font-semibold text-[#00B4D8]">{s.definition.code}</div>
                <div className="text-[11px] text-slate-700 dark:text-[#C5D6E5] truncate">
                  {language === 'pt' ? s.definition.namePt : s.definition.nameEn}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist Quick Access */}
      {watchlist.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-200 dark:border-[#1A334B]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8FA6B9] mb-1">
            Watchlist ({watchlist.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {watchlist.map((id) => {
              const snap = snapshots.find((s) => s.definition.id === id);
              if (!snap) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSelectedIndicatorId(id);
                    setActiveView('MARKETS');
                    setCategoryFilter(undefined);
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-mono rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] hover:border-[#00B4D8] text-slate-700 dark:text-[#C5D6E5]"
                >
                  {snap.definition.code}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Expandable Sections A–H */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {NAVIGATION_GROUPS.map((group) => {
          const isOpen = expandedGroups[group.id];
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-[#8FA6B9] hover:text-slate-900 dark:hover:text-[#E6EEF5] rounded"
              >
                <span className="truncate">
                  {group.code}. {language === 'pt' ? group.titlePt : group.titleEn}
                </span>
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              </button>
              {isOpen && (
                <div className="ml-2 pl-2 border-l border-slate-200 dark:border-[#1A334B] space-y-0.5 my-0.5">
                  {group.items.map((item) => {
                    const active = activeNavId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavClick(item)}
                        className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors truncate ${
                          active
                            ? 'bg-[#00B4D8]/15 text-[#00B4D8] dark:text-[#5CD9F5] font-semibold'
                            : 'text-slate-700 dark:text-[#C5D6E5] hover:bg-slate-100 dark:hover:bg-[#102438]'
                        }`}
                      >
                        {language === 'pt' ? item.labelPt : item.labelEn}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#071521] text-slate-900 dark:text-[#E6EEF5]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#061827] sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 bg-white dark:bg-[#061827] border-r border-slate-200 dark:border-[#1A334B] h-full">
            {renderSidebarContent()}
          </div>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
            className="flex-1 bg-black/60"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean 3-Zone Institutional Header */}
        <header className="sticky top-0 z-30 h-14 px-4 lg:px-6 border-b border-slate-200 dark:border-[#1A334B] bg-white/95 dark:bg-[#061827]/95 backdrop-blur flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-1.5 rounded border border-slate-200 dark:border-[#1A334B]"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-[#E6EEF5] whitespace-nowrap truncate">
              SYGMA BRAZIL ECONOMIC INTELLIGENCE AI
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 dark:text-[#8FA6B9] truncate">
            <span>{language === 'pt' ? activeNavMeta.group.titlePt : activeNavMeta.group.titleEn}</span>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-slate-900 dark:text-[#E6EEF5]">
              {language === 'pt' ? activeNavMeta.item.labelPt : activeNavMeta.item.labelEn}
            </span>
            {lastSyncAt && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[11px]">Sync {lastSyncAt.slice(11, 19)} UTC</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={exportingViewPdf}
              onClick={() => exportCurrentViewPdf()}
              title="Exportar estado atual da visualização (tabelas, snapshots e SWOT) em PDF institucional SYGMA AIS"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono font-semibold rounded border border-[#00B4D8]/50 text-[#00B4D8] dark:text-[#5CD9F5] bg-[#00B4D8]/10 hover:bg-[#00B4D8]/20 disabled:opacity-50 whitespace-nowrap"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>{exportingViewPdf ? 'PDF…' : 'Exportar PDF'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveNavId('mon-alerts');
                setActiveView('ALERTS_CENTER');
              }}
              title="Central de Alertas Watchlist"
              className="relative inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-[#1A334B] text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8] whitespace-nowrap"
            >
              <Bell className={`w-3.5 h-3.5 ${unreadAlertCount > 0 ? 'text-[#F0B94A]' : ''}`} />
              <span>Alertas</span>
              {unreadAlertCount > 0 && (
                <span className="font-bold text-[#F0B94A] tabular-nums">({unreadAlertCount})</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveNavId('adm-sec');
                setActiveView('SECURITY_AUDIT');
              }}
              title="Status de Criptografia Ponta a Ponta"
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded border whitespace-nowrap ${
                e2eeTelemetry.active
                  ? 'border-[#19B779]/40 text-[#19B779] bg-[#19B779]/10'
                  : 'border-[#F0B94A]/40 text-[#F0B94A] bg-[#F0B94A]/10'
              }`}
            >
              <Lock className="w-3 h-3" />
              {e2eeTelemetry.active ? 'E2EE AES-256' : 'E2EE INIT'}
            </button>

            <button
              type="button"
              onClick={() => setLanguage((l) => (l === 'pt' ? 'en' : 'pt'))}
              className="px-2.5 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-[#1A334B] text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8] whitespace-nowrap"
            >
              {language.toUpperCase()}
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Alternar tema"
              className="p-1.5 rounded border border-slate-200 dark:border-[#1A334B] text-slate-700 dark:text-[#C5D6E5] hover:border-[#00B4D8]"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          {bannerAlert && (
            <div className="mb-4 p-3 rounded-lg border border-[#F0B94A]/60 bg-[#F0B94A]/10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#F0B94A] shrink-0" />
                <span>
                  <strong>Alerta Watchlist:</strong> {bannerAlert.code} ({bannerAlert.namePt}) atingiu variação de{' '}
                  <span className="font-mono font-bold">
                    {bannerAlert.observedPctChange > 0 ? '+' : ''}
                    {bannerAlert.observedPctChange}%
                  </span>{' '}
                  (limiar ±{bannerAlert.thresholdPct}%) em {bannerAlert.referenceDate}.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveNavId('mon-alerts');
                    setActiveView('ALERTS_CENTER');
                    setBannerAlert(null);
                  }}
                  className="font-mono font-semibold text-[#00B4D8] hover:underline"
                >
                  Abrir Alertas
                </button>
                <button
                  type="button"
                  onClick={() => setBannerAlert(null)}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  aria-label="Dispensar alerta"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          {bannerDelivery && (
            <div className="mb-4 p-3 rounded-lg border border-[#00B4D8]/60 bg-[#00B4D8]/10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <FileDown className="w-4 h-4 text-[#00B4D8] shrink-0" />
                <span>
                  <strong>Relatório PDF Agendado Disponível:</strong> {bannerDelivery.scheduleName} (
                  <span className="font-mono">{bannerDelivery.pdfFilename}</span>)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={`/api/v1/schedules/deliveries/${bannerDelivery.id}/pdf`}
                  download={bannerDelivery.pdfFilename}
                  className="font-mono font-semibold text-[#19B779] hover:underline"
                >
                  Baixar PDF
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setActiveNavId('adm-sched');
                    setActiveView('SCHEDULES');
                    setBannerDelivery(null);
                  }}
                  className="font-mono font-semibold text-[#00B4D8] hover:underline"
                >
                  Abrir Agendamentos
                </button>
                <button
                  type="button"
                  onClick={() => setBannerDelivery(null)}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  aria-label="Dispensar notificação"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          {activeView === 'EXECUTIVE' && (
            <ExecutiveOverviewView
              snapshots={snapshots}
              focusExpectations={focusExpectations}
              pulse={pulse}
              risk={risk}
              health={health}
              news={news}
              sentiment={sentiment}
              language={language}
              darkMode={darkMode}
              onSelectIndicator={(id, tv) => {
                setSelectedIndicatorId(id);
                setActiveView(tv || 'MARKETS');
              }}
              onSyncNow={handleSyncNow}
              syncing={syncing}
            />
          )}

          {activeView === 'SWOT_DASHBOARD' && (
            <SwotDashboardView
              snapshots={snapshots}
              pulse={pulse}
              risk={risk}
              watchlist={watchlist}
              language={language}
              darkMode={darkMode}
              onSelectIndicator={(id) => {
                setSelectedIndicatorId(id);
                setActiveView('MARKETS');
              }}
              onExportSwotPdf={async (mergedSwot, visibleSnaps, searchTerm) => {
                await exportCurrentViewPdf({
                  viewTitle: 'Dashboard SWOT Brasil — Matriz Estratégica & Snapshots',
                  swotMatrix: mergedSwot,
                  visibleSnapshots: visibleSnaps,
                  customSearch: searchTerm || undefined,
                });
              }}
            />
          )}

          {(activeView === 'MARKETS' ||
            activeView === 'MACRO' ||
            activeView === 'INTERNATIONAL' ||
            activeView === 'INDICATORS_DB') && (
            <MarketAndMacroExplorerView
              mode={activeView}
              snapshots={snapshots}
              selectedIndicatorId={selectedIndicatorId}
              onSelectIndicator={setSelectedIndicatorId}
              categoryFilter={categoryFilter}
              language={language}
              darkMode={darkMode}
              watchlist={watchlist}
              onToggleWatchlist={handleToggleWatchlist}
            />
          )}

          {(activeView === 'QUANT_CORRELATION' ||
            activeView === 'QUANT_FORECAST' ||
            activeView === 'QUANT_RISK' ||
            activeView === 'PULSE') && (
            <QuantitativeLabView
              activeTab={
                activeView === 'QUANT_FORECAST'
                  ? 'FORECAST'
                  : activeView === 'QUANT_RISK'
                  ? 'RISK'
                  : activeView === 'PULSE'
                  ? 'PULSE'
                  : 'CORRELATION'
              }
              onTabChange={(tab) => {
                if (tab === 'CORRELATION') setActiveView('QUANT_CORRELATION');
                if (tab === 'FORECAST') setActiveView('QUANT_FORECAST');
                if (tab === 'RISK') setActiveView('QUANT_RISK');
                if (tab === 'PULSE') setActiveView('PULSE');
              }}
              snapshots={snapshots}
              pulse={pulse}
              risk={risk}
              darkMode={darkMode}
            />
          )}

          {activeView === 'AI_ANALYST' && <AiAnalystView language={language} />}

          {activeView === 'ALERTS_CENTER' && (
            <AlertsCenterView
              snapshots={snapshots}
              watchlist={watchlist}
              rules={alertRules}
              alerts={triggeredAlerts}
              pushEnabled={pushEnabled}
              pushPermission={pushPermission}
              onRequestPushPermission={handleRequestPushPermission}
              onTogglePushEnabled={setPushEnabled}
              onRefreshAlerts={loadAlerts}
              language={language}
            />
          )}

          {activeView === 'SCHEDULES' && (
            <ScheduledReportsView
              schedules={schedules}
              deliveries={scheduledDeliveries}
              unreadCount={unreadDeliveriesCount}
              smtpStatus={smtpStatus}
              onRefresh={loadSchedules}
              language={language}
            />
          )}

          {(activeView === 'QUALITY_FEEDBACK' ||
            activeView === 'PROVIDERS' ||
            activeView === 'SECURITY_AUDIT' ||
            activeView === 'REPORTS' ||
            activeView === 'NEWS_CALENDAR') && (
            <GovernanceAndTechView
              mode={activeView}
              health={health}
              providers={providers}
              news={news}
              e2eeTelemetry={e2eeTelemetry}
              onRefreshAll={loadAllPlatformData}
              snapshots={snapshots}
              alerts={triggeredAlerts}
              watchlist={watchlist}
              onExportViewPdf={() => exportCurrentViewPdf()}
              onOpenSchedules={() => {
                setActiveNavId('adm-sched');
                setActiveView('SCHEDULES');
              }}
              darkMode={darkMode}
              language={language}
              operatorId={operatorId}
              onOperatorIdChange={setOperatorId}
            />
          )}
        </main>
      </div>
    </div>
  );
}
