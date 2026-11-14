import { Lock, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { sygmaClient } from '../../lib/e2eeClient';
import type { Language } from '../../types/sygma';

interface ChatTurn {
  role: 'user' | 'model';
  text: string;
  toolsUsed?: Array<{ name: string; args: Record<string, unknown> }>;
  timestamp: string;
  encrypted: boolean;
}

const PRESET_QUESTIONS_PT = [
  'Qual a condição econômica atual do Brasil com base nos dados oficiais do BCB?',
  'O que está acontecendo com a inflação (IPCA) e como a Selic está reagindo?',
  'Analise a relação estatística e causalidade de Granger entre Selic e USD/BRL.',
  'Quais os 5 maiores riscos econômicos e de estresse quantitativo hoje?',
  'Analise a evolução da Dívida Bruta (% PIB) e sustentabilidade fiscal.',
];

const PRESET_QUESTIONS_EN = [
  'What is the current economic condition of Brazil based on verified BCB data?',
  'Analyze the statistical relationship between SELIC, IPCA, and USD/BRL.',
  'Summarize the top 5 macroeconomic and quantitative stress risks.',
];

export function AiAnalystView({ language }: { language: Language }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = language === 'pt' ? PRESET_QUESTIONS_PT : PRESET_QUESTIONS_EN;

  const sendQuery = async (questionText?: string) => {
    const prompt = (questionText ?? input).trim();
    if (!prompt || loading) return;

    const now = new Date().toISOString();
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((prev) => [...prev, { role: 'user', text: prompt, timestamp: now, encrypted: true }]);
    if (!questionText) setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await sygmaClient.postEncryptedAi<{
        answer: string;
        toolsUsed: Array<{ name: string; args: Record<string, unknown> }>;
        generatedAt: string;
        model: string;
      }>(prompt, history);

      setTurns((prev) => [
        ...prev,
        {
          role: 'model',
          text: res.answer,
          toolsUsed: res.toolsUsed,
          timestamp: res.generatedAt,
          encrypted: true,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consultar Analista AI');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left: Presets & Grounding Policy */}
      <div className="lg:col-span-4 space-y-4">
        <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6EEF5]">
              SYGMA AI Economic Analyst
            </h2>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#19B779]">
              <Lock className="w-3 h-3" /> E2EE AES-256-GCM
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-[#8FA6B9] leading-relaxed">
            Consultas trafegam criptografadas de ponta a ponta (ECDH-P256 + AES-256-GCM). O analista acessa exclusivamente ferramentas <strong>read-only</strong> auditadas no backend e nunca altera observações originais.
          </p>

          <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-[#1A334B]">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-[#8FA6B9]">
              Consultas Institucionais Rápidas
            </div>
            {presets.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => sendQuery(q)}
                disabled={loading}
                className="w-full text-left p-2.5 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] hover:border-[#00B4D8] text-slate-800 dark:text-[#D9E5F0] transition-colors disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Encrypted Conversation Thread */}
      <div className="lg:col-span-8 flex flex-col border border-slate-200 dark:border-[#1A334B] bg-white dark:bg-[#102438] rounded-lg h-[700px]">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1A334B] flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-[#C5D6E5]">
            <Sparkles className="w-4 h-4 text-[#00B4D8]" />
            Terminal de Inteligência Econômica Auditada
          </div>
          <span className="font-mono text-[11px] text-slate-500 dark:text-[#8FA6B9]">
            {turns.length} mensagens na sessão
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {turns.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-2 text-xs text-slate-500 dark:text-[#8FA6B9]">
              <p className="font-semibold text-slate-700 dark:text-[#E6EEF5]">
                Pronto para análise macroeconômica e quantitativa fundamentada.
              </p>
              <p>
                Selecione uma consulta ao lado ou faça uma pergunta sobre câmbio, Selic, IPCA, PIB, risco Monte Carlo ou sustentabilidade fiscal.
              </p>
            </div>
          )}

          {turns.map((turn, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-lg border text-xs leading-relaxed ${
                turn.role === 'user'
                  ? 'ml-8 bg-[#0A2540] text-[#E6EEF5] border-[#1E3A54]'
                  : 'mr-4 bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#D9E5F0] border-slate-200 dark:border-[#1A334B]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5 text-[10px] font-mono text-[#8FA6B9]">
                <span>{turn.role === 'user' ? 'ANALISTA (VOCÊ)' : 'SYGMA AI ECONOMIC ANALYST'}</span>
                <span>
                  {turn.encrypted ? 'AES-256-GCM · ' : ''}
                  {turn.timestamp.slice(11, 19)} UTC
                </span>
              </div>
              <div className="whitespace-pre-wrap">{turn.text}</div>
              {turn.toolsUsed && turn.toolsUsed.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-[#1A334B] font-mono text-[10px] text-[#5CD9F5]">
                  Evidências consultadas: {turn.toolsUsed.map((t) => t.name).join(' · ')}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-xs font-mono text-[#5CD9F5]">
              Consultando séries oficiais, modelos quantitativos e gerando síntese auditada...
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg border border-[#E45159]/40 bg-[#E45159]/10 text-xs text-[#E45159]">
              {error}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendQuery();
          }}
          className="p-3 border-t border-slate-200 dark:border-[#1A334B] flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              language === 'pt'
                ? 'Pergunte sobre economia brasileira, câmbio, juros, risco ou projeções...'
                : 'Ask about Brazilian economy, FX, rates, risk or forecasts...'
            }
            className="flex-1 px-3 py-2 text-xs rounded border border-slate-200 dark:border-[#1A334B] bg-slate-50 dark:bg-[#061827] text-slate-900 dark:text-[#E6EEF5] focus:outline-none focus:border-[#00B4D8]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#00B4D8] text-[#061827] rounded hover:bg-[#5CD9F5] transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
