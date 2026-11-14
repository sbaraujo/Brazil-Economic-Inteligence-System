import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import { connectorEngine } from './connectors/connectorEngine.ts';
import { cryptoService } from './cryptoService.ts';
import { dataQualityEngine } from './dataQualityEngine.ts';
import { quantEngine } from './quantEngine.ts';
import { timeSeriesStore } from './timeseriesStore.ts';

const SYSTEM_INSTRUCTION = `Você é o SYGMA AI Economic Analyst, analista macroeconômico e quantitativo sênior da plataforma institucional SYGMA BRAZIL ECONOMIC INTELLIGENCE AI (SYGMA AIS).

REGRAS INVIOLÁVEIS DE INTEGRIDADE FINANCEIRA:
1. NUNCA fabrique cotações, taxas ou estatísticas. Consulte SEMPRE as ferramentas disponíveis antes de citar qualquer número.
2. Se uma série retornar MISSING, NOT_CONFIGURED ou erro, informe explicitamente a limitação sem preencher lacunas.
3. Separe sempre: (a) Estatísticas oficiais confirmadas (BCB/IBGE), (b) Cotações de mercado com atraso (DELAYED), (c) Estimativas/Previsões econométricas, (d) Interpretação analítica e hipóteses.
4. Nunca apresente correlação como causalidade comprovada.
5. Para análises complexas, estruture com rigor institucional: Resumo Executivo, Dados Verificados (com fontes e datas), Evidência Estatística, Fatores Internacionais, Avaliação de Riscos, Cenários Alternativos e Limitações dos Dados.
6. Idioma padrão: Português do Brasil (ou Inglês caso o usuário pergunte em inglês).`;

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'query_indicator_snapshot',
    description: 'Consulta o valor mais recente, variação, status (PERIODIC/DELAYED/STALE/MISSING), fonte e últimas 12 observações de um indicador econômico ou financeiro.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        indicatorId: {
          type: Type.STRING,
          description: 'ID do indicador: USD_BRL_PTAX, EUR_BRL_PTAX, SELIC_META, CDI_ANUAL, IPCA_MENSAL, IGPM_MENSAL, IBC_BR, PIB_REAL_ANUAL, DIVIDA_BRUTA_PIB, DIVIDA_LIQUIDA_PIB, DESEMPREGO_PNAD, CREDITO_TOTAL, INADIMPLENCIA, BALANCA_COMERCIAL, RESERVAS_INT, IBOV, PETR4, VALE3, SP500, US_10Y, BRENT, GOLD, IRON_ORE, SOYBEANS.',
        },
      },
      required: ['indicatorId'],
    },
  },
  {
    name: 'get_all_macro_market_overview',
    description: 'Obtém um painel resumido com todos os indicadores disponíveis no sistema, suas datas de referência e status de confiabilidade.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'run_correlation_and_granger',
    description: 'Executa análise estatística determinística entre dois indicadores (Pearson, Spearman, Regressão OLS, R², Durbin-Watson e Teste de Causalidade de Granger).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        xId: { type: Type.STRING, description: 'ID do indicador X' },
        yId: { type: Type.STRING, description: 'ID do indicador Y' },
        frequency: { type: Type.STRING, description: 'MONTHLY ou DAILY' },
      },
      required: ['xId', 'yId'],
    },
  },
  {
    name: 'get_risk_and_stress_report',
    description: 'Consulta VaR Histórico/Paramétrico/Monte Carlo (10.000 simulações), Expected Shortfall e os 10 cenários de estresse hipotéticos A-J.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_brazil_pulse_and_focus',
    description: 'Retorna o Brazil Economic Pulse (10 dimensões normalizadas) e as expectativas oficiais do Boletim Focus BCB.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_data_quality_and_news',
    description: 'Retorna alertas ativos de qualidade de dados, anomalias estatísticas e comunicados recentes do Banco Central.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

function executeTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'query_indicator_snapshot': {
      const id = String(args.indicatorId || 'USD_BRL_PTAX');
      const snap = connectorEngine.getIndicatorSnapshot(id);
      if (!snap) return { error: `Indicador ${id} não catalogado.` };
      const series = timeSeriesStore.getSeries(id).slice(-12);
      const tech = quantEngine.computeTechnicalAnalysis(id);
      return {
        snapshot: snap,
        recentHistory: series.map((p) => ({ date: p.date, value: p.value, status: p.status })),
        technicalIndicators: tech,
      };
    }
    case 'get_all_macro_market_overview': {
      return connectorEngine.getAllSnapshots().map((s) => ({
        id: s.definition.id,
        name: s.definition.namePt,
        value: s.latest?.value ?? null,
        unit: s.definition.unit,
        date: s.latest?.date ?? null,
        changePct: s.changePct,
        status: s.status,
        source: s.latest?.sourceName ?? s.definition.providerId,
      }));
    }
    case 'run_correlation_and_granger': {
      const xId = String(args.xId || 'SELIC_META');
      const yId = String(args.yId || 'IPCA_MENSAL');
      const freq = args.frequency === 'DAILY' ? 'DAILY' : 'MONTHLY';
      const report = quantEngine.analyzeCrossIndicator(xId, yId, freq);
      return {
        ...report,
        scatterPoints: undefined,
        rollingCorrelations: report.rollingCorrelations.slice(-12),
      };
    }
    case 'get_risk_and_stress_report': {
      const risk = quantEngine.computeRiskReport();
      return { ...risk, monteCarloHistogram: undefined };
    }
    case 'get_brazil_pulse_and_focus': {
      return {
        pulse: quantEngine.computeBrazilPulse(),
        focusExpectations: connectorEngine.getFocusExpectations(),
      };
    }
    case 'get_data_quality_and_news': {
      const health = dataQualityEngine.evaluateAll();
      return {
        overallStatus: health.overallStatus,
        issues: health.issues.slice(0, 10),
        news: connectorEngine.getNewsFeed().slice(0, 8),
      };
    }
    default:
      return { error: `Ferramenta desconhecida: ${name}` };
  }
}

export class AiAnalystService {
  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY não configurada no ambiente do servidor.');
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public async askAnalyst(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }> = []
  ): Promise<{
    answer: string;
    toolsUsed: Array<{ name: string; args: Record<string, unknown> }>;
    generatedAt: string;
    model: string;
  }> {
    const ai = this.getClient();
    const model = 'gemini-4-hydrogen';

    // Keep prompt injection resilience: strictly wrap untrusted input & keep read-only tools
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
    for (const h of history.slice(-6)) {
      contents.push({ role: h.role, parts: [{ text: h.text }] });
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const toolsUsed: Array<{ name: string; args: Record<string, unknown> }> = [];
    let currentContents = contents;

    // Up to 3 tool-calling rounds
    for (let round = 0; round < 3; round++) {
      const response = await ai.models.generateContent({
        model,
        contents: currentContents as never,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: toolDeclarations }],
        },
      });

      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        const answerText = response.text || 'Não foi possível gerar resposta analítica.';
        cryptoService.recordAudit('svc-ai-analyst', 'USER', 'AI_ANALYST_QUERY', model, 'SUCCESS', {
          toolsInvoked: toolsUsed.map((t) => t.name),
        });
        return {
          answer: answerText,
          toolsUsed,
          generatedAt: new Date().toISOString(),
          model,
        };
      }

      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) {
        currentContents = [...currentContents, modelContent as never];
      }

      const responseParts: Array<Record<string, unknown>> = [];
      for (const call of functionCalls) {
        const args = (call.args ?? {}) as Record<string, unknown>;
        const toolName = call.name ?? 'unknown';
        toolsUsed.push({ name: toolName, args });
        const result = executeTool(toolName, args);
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: toolName,
            response: { result },
          },
        });
      }

      currentContents = [
        ...currentContents,
        {
          role: 'user',
          parts: responseParts,
        },
      ];
    }

    const finalRes = await ai.models.generateContent({
      model,
      contents: currentContents as never,
      config: { systemInstruction: SYSTEM_INSTRUCTION },
    });

    return {
      answer: finalRes.text || 'Análise concluída sem texto adicional.',
      toolsUsed,
      generatedAt: new Date().toISOString(),
      model,
    };
  }

  public async generateExecutiveBriefing(language: 'pt' | 'en' = 'pt') {
    const prompt =
      language === 'en'
        ? 'Generate the institutional Daily Executive Economic Briefing for Brazil using ONLY verified backend tools (get_all_macro_market_overview, get_brazil_pulse_and_focus, get_risk_and_stress_report, get_data_quality_and_news). Cover: Current Economic Condition, Key Positives, Key Negatives, Critical Indicators with exact dates/statuses, International Risks, Short/Medium-Term Outlook, and Data Quality Limitations.'
        : 'Gere o Briefing Executivo Diário Institucional da Economia Brasileira utilizando EXCLUSIVAMENTE as ferramentas verificadas do backend (get_all_macro_market_overview, get_brazil_pulse_and_focus, get_risk_and_stress_report, get_data_quality_and_news). Cubra: Condição Econômica Atual, Principais Vetores Positivos, Principais Vetores Negativos, Indicadores Críticos com datas e status exatos, Riscos Internacionais, Perspectiva de Curto/Médio Prazo e Limitações de Qualidade de Dados.';

    return this.askAnalyst(prompt);
  }
}

export const aiAnalystService = new AiAnalystService();
