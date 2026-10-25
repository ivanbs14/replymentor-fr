import Link from 'next/link';
import type { SessionSummaryResponse } from '@/lib/api';

type Props = {
  summary: SessionSummaryResponse;
  onRetry?: () => void;
  isRetrying?: boolean;
  showDetailsLink?: boolean;
};

export function SessionSummary({ summary, onRetry, isRetrying = false, showDetailsLink = false }: Props) {
  const content = summary.content;
  return (
    <section className="rounded-2xl border border-[#c3c6d7] bg-white p-5 shadow-sm" aria-labelledby="session-summary-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#004ac6]">Entrevista encerrada</p>
          <h2 id="session-summary-title" className="mt-1 text-2xl font-semibold text-[#0d1c2e]">Resumo da entrevista</h2>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          summary.status === 'READY' ? 'bg-emerald-100 text-emerald-800' :
          summary.status === 'FAILED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'
        }`}>
          {summary.status === 'READY' ? 'Resumo pronto' : summary.status === 'FAILED' ? 'Resumo básico disponível' : 'Gerando resumo'}
        </span>
      </div>

      {summary.status === 'PENDING' ? (
        <div className="mt-5 rounded-xl bg-[#eff4ff] p-4" role="status" aria-live="polite">
          <p className="font-medium text-[#0d1c2e]">A análise semântica está sendo preparada.</p>
          <p className="mt-1 text-sm text-[#434655]">Você pode sair desta página. O processamento continuará em segundo plano.</p>
        </div>
      ) : null}

      {summary.status === 'FAILED' ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="font-medium text-rose-900">Não foi possível gerar a análise detalhada.</p>
          <p className="mt-1 text-sm text-rose-800">O encerramento foi salvo com segurança e o resumo básico permanece disponível.</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} disabled={isRetrying}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#004ac6] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2">
              {isRetrying ? 'Solicitando...' : 'Tentar novamente'}
            </button>
          ) : null}
        </div>
      ) : null}

      {content ? (
        <div className="mt-6 space-y-6">
          <p className="max-w-3xl text-base leading-7 text-[#434655]">{content.overview}</p>
          {content.topics.length ? <div className="flex flex-wrap gap-2" aria-label="Tópicos abordados">{content.topics.map((topic) => <span key={topic} className="rounded-full bg-[#e6eeff] px-3 py-1 text-sm font-medium text-[#004ac6]">{topic}</span>)}</div> : null}
          {content.questions.length ? <div><h3 className="text-lg font-semibold">Perguntas e respostas</h3><div className="mt-3 space-y-3">{content.questions.map((item, index) => <article key={`${item.question}-${index}`} className="rounded-xl bg-[#f8f9ff] p-4"><p className="font-semibold">{item.question}</p><p className="mt-2 text-sm leading-6 text-[#434655]">{item.answerSummary}</p></article>)}</div></div> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <EvidenceList title="Pontos fortes" empty="Nenhum ponto forte foi inferido sem evidência." items={content.strengths} tone="success" />
            <EvidenceList title="Pontos de melhoria" empty="Nenhum ponto de melhoria foi inferido sem evidência." items={content.improvements} tone="attention" />
          </div>
          {content.nextSteps.length ? <div><h3 className="text-lg font-semibold">Próximos passos</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-[#434655]">{content.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul></div> : null}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-[#c3c6d7] bg-[#f8f9ff] p-4 text-sm text-[#434655]"><strong>Resumo básico:</strong> {summary.fallbackContent}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-3 border-t border-zinc-100 pt-4">
        {showDetailsLink ? <Link href={`/sessions/${summary.sessionId}/summary`} className="inline-flex min-h-11 items-center rounded-xl border border-[#c3c6d7] px-4 text-sm font-semibold text-[#004ac6] hover:bg-[#eff4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6]">Abrir resumo completo</Link> : null}
        <Link href="/" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-[#434655] hover:bg-[#eff4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6]">Voltar ao dashboard</Link>
      </div>
    </section>
  );
}

function EvidenceList({ title, empty, items, tone }: {
  title: string; empty: string;
  items: Array<{ text: string; evidenceResponseId: string }>;
  tone: 'success' | 'attention';
}) {
  return <div className={`rounded-xl p-4 ${tone === 'success' ? 'bg-emerald-50' : 'bg-amber-50'}`}>
    <h3 className="font-semibold text-[#0d1c2e]">{title}</h3>
    {items.length ? <ul className="mt-3 space-y-2 text-sm leading-6 text-[#434655]">{items.map((item) => <li key={`${item.evidenceResponseId}-${item.text}`}>• {item.text}</li>)}</ul> : <p className="mt-2 text-sm text-[#434655]">{empty}</p>}
  </div>;
}
