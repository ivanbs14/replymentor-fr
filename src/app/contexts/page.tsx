'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useInterviewStore } from '@/lib/interview-store';

const SELECTED_CONTEXT_STORAGE_KEY = 'replymentor_selected_context_id';

type ContextItem = {
  id: string;
  resumeText: string;
  interviewType: string;
  jobLevel: string;
  jobDescription: string;
  companyName: string;
  companySegment: string | null;
  responsePreference: string;
  aiBehavior: string | null;
  createdAt: string;
  sessionsCount: number;
  latestSessionAt: string | null;
  latestSessionStatus: 'ACTIVE' | 'CLOSED' | null;
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function compactText(text: string, max = 150) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export default function ContextsPage() {
  const { resetInterviewState, setContextId } = useInterviewStore();
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(
    null,
  );
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const handleUnauthorized = () => {
      localStorage.removeItem('replymentor_token');
      localStorage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
      if (active) {
        setAuthUser(null);
        resetInterviewState();
      }
    };

    setUnauthorizedHandler(handleUnauthorized);

    localStorage.removeItem('replymentor_token');

    Promise.all([api.me(), api.getContexts()])
      .then(([user, storedContexts]) => {
        if (!active) return;
        setAuthUser({ id: user.id, email: user.email });
        setContexts(storedContexts);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : 'Falha ao carregar contextos.';
        setErrorMessage(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, [resetInterviewState]);

  const handleLogout = async () => {
    try {
      await api.logout();
      localStorage.removeItem('replymentor_token');
      localStorage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
      setAuthUser(null);
      resetInterviewState();
    } catch {
      setErrorMessage(
        'Não foi possível encerrar a sessão. Tente novamente antes de sair.',
      );
    }
  };

  if (!authUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f9ff] px-6 py-10">
        <div className="w-full max-w-md rounded-2xl border border-[#c3c6d7] bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-[#004ac6]">ReplyMentor</h1>
          <p className="mt-2 text-sm text-[#434655]">
            Você precisa estar autenticado para ver os contextos.
          </p>
          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#004ac6] text-sm font-semibold text-white hover:opacity-95"
            >
              Ir para login
            </Link>
          </div>
          {errorMessage ? (
            <Alert className="mt-4" variant="destructive">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <AlertTitle>Acesso indisponível</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0d1c2e]">
      <header className="sticky top-0 z-50 border-b border-[#c3c6d7] bg-white/95 shadow-sm">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <span
              className="material-symbols-outlined text-[28px] text-[#004ac6]"
              style={{ fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24" }}
            >
              psychology
            </span>
            <span className="text-xl font-bold text-[#004ac6]">ReplyMentor</span>
          </div>
          <nav className="hidden items-center gap-8 md:flex">
            <Link href="/" className="text-sm text-[#434655]">
              Dashboard
            </Link>
            <span className="border-b-2 border-[#004ac6] pb-1 text-sm font-semibold text-[#004ac6]">
              Contextos
            </span>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[#434655] md:inline">{authUser.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-[#c3c6d7] px-3 py-1 text-sm font-medium text-[#434655] hover:bg-[#eff4ff]"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-semibold">Contextos por reunião</h1>
            <p className="mt-1 text-sm text-[#434655]">
              Histórico de contextos usados em simulações de entrevista.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/contexts/new"
              className="rounded-xl bg-[#004ac6] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
            >
              Criar novo contexto
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-[#c3c6d7] bg-white px-4 py-2 text-sm font-semibold text-[#434655] hover:bg-[#eff4ff]"
            >
              Voltar ao dashboard
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[#c3c6d7] bg-white p-8 text-[#434655]">
            Carregando contextos...
          </div>
        ) : null}

        {!loading && contexts.length === 0 ? (
          <div className="rounded-2xl border border-[#c3c6d7] bg-white p-8">
            <p className="text-[#434655]">Nenhum contexto cadastrado para este usuário.</p>
          </div>
        ) : null}

        {!loading && contexts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {contexts.map((context) => (
              <article
                key={context.id}
                className="rounded-2xl border border-[#c3c6d7] bg-white p-5 shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-[#0d1c2e]">
                      {context.companyName}
                    </h2>
                    <p className="text-sm text-[#434655]">
                      {context.interviewType} • {context.jobLevel}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      context.latestSessionStatus === 'ACTIVE'
                        ? 'bg-[#e6f4ea] text-[#137333]'
                        : 'bg-[#eff4ff] text-[#004ac6]'
                    }`}
                  >
                    {context.latestSessionStatus === 'ACTIVE'
                      ? 'Sessão ativa'
                      : context.latestSessionStatus === 'CLOSED'
                        ? 'Sessão encerrada'
                        : 'Sem sessão'}
                  </span>
                </div>

                <div className="space-y-2 text-sm text-[#434655]">
                  <p>
                    <strong>Data do contexto:</strong> {formatDate(context.createdAt)}
                  </p>
                  <p>
                    <strong>Sessões:</strong> {context.sessionsCount}
                  </p>
                  <p>
                    <strong>Última sessão:</strong> {formatDate(context.latestSessionAt)}
                  </p>
                  <p>
                    <strong>Preferência de resposta:</strong> {context.responsePreference}
                  </p>
                </div>

                <div className="mt-4 rounded-xl bg-[#eff4ff]/60 p-3 text-sm text-[#0d1c2e]">
                  <p className="font-semibold">Resumo profissional</p>
                  <p className="mt-1">{compactText(context.resumeText, 180)}</p>
                </div>

                <div className="mt-3 rounded-xl border border-[#c3c6d7]/70 p-3 text-sm text-[#0d1c2e]">
                  <p className="font-semibold">Descrição da vaga</p>
                  <p className="mt-1">{compactText(context.jobDescription, 180)}</p>
                </div>
                <div className="mt-4">
                  <Link
                    href="/"
                    onClick={() => {
                      localStorage.setItem(SELECTED_CONTEXT_STORAGE_KEY, context.id);
                      setContextId(context.id);
                    }}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-[#004ac6] px-4 text-sm font-semibold text-white hover:opacity-95"
                  >
                    Selecionar contexto
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {errorMessage ? (
          <Alert className="mt-6" variant="destructive">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <AlertTitle>Erro ao carregar contextos</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </main>
    </div>
  );
}
