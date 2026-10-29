import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import SessionSummaryPage from './page';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/interview-contract';

vi.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 'session-a' }) }));
vi.mock('@/lib/api', () => ({
  api: { getSessionSummary: vi.fn(), retrySessionSummary: vi.fn() },
}));

describe('SessionSummaryPage', () => {
  beforeEach(() => vi.resetAllMocks());

  it('renders a structured summary retrieved after the session ended', async () => {
    vi.mocked(api.getSessionSummary).mockResolvedValue({
      id: 'summary-a', sessionId: 'session-a', status: 'READY',
      content: {
        overview: 'A conversa cobriu arquitetura de APIs.',
        questions: [{ question: 'Como projeta APIs?', answerSummary: 'Usa contratos versionados.' }],
        topics: ['APIs'],
        strengths: [{ text: 'Apresentou exemplo concreto.', evidenceResponseId: 'response-a' }],
        improvements: [], nextSteps: ['Revisar observabilidade.'],
      },
      fallbackContent: 'Uma resposta registrada.', provider: 'gemini', model: 'gemini-2.0-flash',
      promptVersion: 'session-summary-v1', startedAt: '2026-10-25T20:00:00Z',
      completedAt: '2026-10-25T20:00:01Z', errorCode: null,
    });
    renderWithProviders(<SessionSummaryPage />);
    expect(await screen.findByRole('heading', { name: 'Resumo da entrevista' })).toBeVisible();
    expect(screen.getByText('A conversa cobriu arquitetura de APIs.')).toBeVisible();
    expect(screen.getByText(/Apresentou exemplo concreto\./)).toBeVisible();
  });

  it('blocks summary retry until Retry-After expires after a 429', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getSessionSummary).mockResolvedValue({
      id: 'summary-a', sessionId: 'session-a', status: 'FAILED', content: null,
      fallbackContent: 'Uma resposta registrada.', provider: 'gemini', model: 'gemini-2.0-flash',
      promptVersion: 'session-summary-v1', startedAt: '2026-10-25T20:00:00Z',
      completedAt: null, errorCode: 'PROVIDER_ERROR',
    });
    vi.mocked(api.retrySessionSummary).mockRejectedValue(
      new ApiError('Muitas tentativas.', 429, 'RATE_LIMIT_EXCEEDED', 2, 'request-a'),
    );

    renderWithProviders(<SessionSummaryPage />);
    const retryButton = await screen.findByRole('button', { name: 'Tentar novamente' });
    fireEvent.click(retryButton);

    expect(await screen.findByText(/Aguarde 2s\./)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2_250));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled());
    vi.useRealTimers();
  });
});
