'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { SessionSummary } from '@/components/session-summary';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/interview-contract';
import { rateLimitDeadline, rateLimitSecondsRemaining } from '@/lib/rate-limit-wait';

export default function SessionSummaryPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const queryClient = useQueryClient();
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const rateLimitWaitSeconds = rateLimitSecondsRemaining(rateLimitUntil, clock);
  const applyRateLimitWait = useCallback((error: unknown) => {
    const deadline = rateLimitDeadline(error);
    if (deadline !== null) {
      setRateLimitUntil((current) => Math.max(current ?? 0, deadline));
      setClock(Date.now());
    }
  }, []);

  useEffect(() => {
    if (rateLimitWaitSeconds === 0) return;
    const timeout = window.setTimeout(() => setClock(Date.now()), 250);
    return () => window.clearTimeout(timeout);
  }, [clock, rateLimitWaitSeconds]);
  const summaryQuery = useQuery({
    queryKey: ['session-summary', sessionId],
    queryFn: () => api.getSessionSummary(sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => {
      if (query.state.error instanceof ApiError && query.state.error.statusCode === 429) {
        return Math.max(query.state.error.retryAfterSeconds ?? 1, 1) * 1_000;
      }
      return query.state.data?.status === 'PENDING' ? 1_500 : false;
    },
  });
  const retryMutation = useMutation({
    mutationFn: () => api.retrySessionSummary(sessionId),
    onSuccess: (summary) => queryClient.setQueryData(['session-summary', sessionId], summary),
    onError: applyRateLimitWait,
  });

  return <main className="min-h-dvh bg-[#f8f9ff] px-4 py-8 text-[#0d1c2e] md:px-8">
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <Link href="/" className="text-xl font-bold text-[#004ac6]">ReplyMentor</Link>
        <Link href="/contexts" className="inline-flex min-h-11 items-center rounded-xl border border-[#c3c6d7] bg-white px-4 text-sm font-semibold text-[#434655] hover:bg-[#eff4ff]">Contextos</Link>
      </header>
      {summaryQuery.isPending ? <div className="rounded-2xl border border-[#c3c6d7] bg-white p-8" role="status">Carregando resumo...</div> : null}
      {summaryQuery.error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6" role="alert"><h1 className="text-xl font-semibold text-rose-900">Resumo indisponível</h1><p className="mt-2 text-rose-800">{summaryQuery.error.message}</p><Link href="/" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#004ac6] px-4 text-sm font-semibold text-white">Ir para o dashboard</Link></div> : null}
      {summaryQuery.data ? <SessionSummary summary={summaryQuery.data} onRetry={summaryQuery.data.status === 'FAILED' && rateLimitWaitSeconds === 0 ? () => retryMutation.mutate() : undefined} isRetrying={retryMutation.isPending || rateLimitWaitSeconds > 0} /> : null}
      {retryMutation.error ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">{retryMutation.error instanceof Error ? retryMutation.error.message : 'Não foi possível tentar novamente.'}{rateLimitWaitSeconds > 0 ? ` Aguarde ${rateLimitWaitSeconds}s.` : ''}</p> : null}
    </div>
  </main>;
}
