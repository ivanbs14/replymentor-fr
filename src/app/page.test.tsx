import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './page';
import { api, setUnauthorizedHandler } from '@/lib/api';
import { ApiError } from '@/lib/interview-contract';
import { useInterviewStore } from '@/lib/interview-store';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    startSession: vi.fn(),
    addTranscript: vi.fn(),
    generateResponse: vi.fn(),
    endSession: vi.fn(),
  },
  setUnauthorizedHandler: vi.fn(),
}));

const user = { id: 'user-test', email: 'candidate@example.test' };
const response = {
  id: 'response-test',
  detectedQuestion: 'Como você trata concorrência?',
  suggestedAnswer: 'Uso transações curtas e operações idempotentes.',
  shortVersion: 'Transações curtas e idempotência.',
  keyPoints: ['transações curtas', 'idempotência'],
  strategicNote: 'Explique um caso de projeto.',
  createdAt: '2026-10-22T12:00:00.000Z',
};
const answerReadyResponse = {
  ...response,
  status: 'ANSWER_READY' as const,
  detection: {
    id: 'detection-test',
    status: 'DETECTED' as const,
    question: response.detectedQuestion,
    confidence: null,
    source: 'LEGACY' as const,
    evidence: [],
    detectorVersion: 'legacy-v1',
    provider: null,
    model: null,
    createdAt: response.createdAt,
  },
  answer: response,
};
const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['simulated audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

async function renderAuthenticatedHome() {
  localStorage.setItem('replymentor_selected_context_id', 'context-test');
  useInterviewStore.setState({ authUser: user, contextId: 'context-test' });
  const view = renderWithProviders(<Home />);
  await screen.findByText(user.email);
  await waitFor(() => expect(api.me).toHaveBeenCalledOnce());
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useInterviewStore.setState(useInterviewStore.getInitialState(), true);
  vi.mocked(api.me).mockResolvedValue({
    ...user,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  });
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  FakeMediaRecorder.isTypeSupported.mockReturnValue(true);
  vi.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

describe('Home authentication', () => {
  it('logs in with a normalized email and clears the previous interview', async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError('Não autorizado.', 401));
    vi.mocked(api.login).mockResolvedValue({ user });
    const interaction = userEvent.setup();
    const { container } = renderWithProviders(<Home />);

    await interaction.type(screen.getByRole('textbox'), 'Candidate@Example.Test');
    // The current password input has no associated label.
    await interaction.type(container.querySelector('input[type="password"]')!, 'test-password');
    localStorage.setItem('replymentor_selected_context_id', 'previous-context');
    act(() => {
      useInterviewStore.setState({
        contextId: 'previous-context',
        sessionId: 'previous-session',
        transcriptInput: 'previous private transcript',
        history: [response],
        latestResponse: response,
        summary: 'previous summary',
      });
    });
    await interaction.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(api.login).toHaveBeenCalledExactlyOnceWith({
      email: user.email,
      password: 'test-password',
    });
    await screen.findByText(user.email);
    expect(localStorage.getItem('replymentor_selected_context_id')).toBeNull();
    expect(useInterviewStore.getState()).toMatchObject({
      authUser: user,
      contextId: null,
      sessionId: null,
      transcriptInput: '',
      latestResponse: null,
      history: [],
      summary: null,
    });
  });

  it('shows a rejected login without entering the workspace', async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError('Não autorizado.', 401));
    vi.mocked(api.login).mockRejectedValue(new ApiError('Credenciais inválidas.', 401));
    const interaction = userEvent.setup();
    const { container } = renderWithProviders(<Home />);

    await interaction.type(screen.getByRole('textbox'), user.email);
    await interaction.type(container.querySelector('input[type="password"]')!, 'wrong-password');
    await interaction.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Credenciais inválidas.')).toBeVisible();
    expect(useInterviewStore.getState().authUser).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('clears authentication, storage and private interview data through the global 401 handler', async () => {
    const { unmount } = await renderAuthenticatedHome();
    localStorage.setItem('replymentor_token', 'legacy-test-token');
    act(() => {
      useInterviewStore.setState({
        sessionId: 'session-test',
        sessionStatus: 'listening',
        transcriptInput: 'private transcript',
        contextForm: { ...useInterviewStore.getState().contextForm, resumeText: 'private resume' },
        latestResponse: response,
        history: [response],
        summary: 'private summary',
      });
    });
    const handler = vi.mocked(setUnauthorizedHandler).mock.calls.at(-1)?.[0];
    expect(handler).toBeTypeOf('function');

    act(() => handler!());

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(localStorage.getItem('replymentor_token')).toBeNull();
    expect(localStorage.getItem('replymentor_selected_context_id')).toBeNull();
    expect(useInterviewStore.getState()).toMatchObject({
      authUser: null,
      contextId: null,
      sessionId: null,
      sessionStatus: 'idle',
      transcriptInput: '',
      contextForm: { resumeText: '' },
      latestResponse: null,
      history: [],
      summary: null,
    });
    unmount();
    expect(setUnauthorizedHandler).toHaveBeenLastCalledWith(null);
  });
});

describe('Home interview session', () => {
  it('starts capture, generates from the manual transcript and ends with a summary', async () => {
    vi.mocked(api.startSession).mockResolvedValue({ id: 'session-test' });
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.endSession).mockResolvedValue({ id: 'summary-test', content: 'Resumo simulado da entrevista.' });
    let resolveGeneration!: (value: typeof answerReadyResponse) => void;
    vi.mocked(api.generateResponse).mockImplementation(() => new Promise((resolve) => {
      resolveGeneration = resolve;
    }));
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    expect(screen.getByRole('button', { name: /Gerar resposta/ })).toBeDisabled();
    await interaction.click(screen.getByRole('button', { name: /Iniciar escuta/ }));

    expect(api.startSession).toHaveBeenCalledExactlyOnceWith('context-test');
    expect(await screen.findByText('Escutando reunião...')).toBeVisible();
    await screen.findByText('Gravando... clique em Parar gravação.');
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(screen.getByRole('button', { name: /Iniciar escuta/ })).toBeDisabled();

    const transcript = screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...');
    fireEvent.change(transcript, { target: { value: '  Como você trata concorrência?  ' } });
    await interaction.type(screen.getByPlaceholderText('Padrão do backend para Ollama'), '  model-test  ');
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta/ }));

    expect(await screen.findByText('Gerando resposta...')).toBeVisible();
    expect(api.addTranscript).toHaveBeenCalledExactlyOnceWith(
      'session-test',
      { transcript: response.detectedQuestion },
      '00000000-0000-4000-8000-000000000001',
    );
    expect(api.generateResponse).toHaveBeenCalledExactlyOnceWith(
      'session-test',
      { provider: 'ollama', model: 'model-test' },
      '00000000-0000-4000-8000-000000000002',
    );
    expect(screen.getByRole('button', { name: /Gerar resposta/ })).toBeDisabled();
    act(() => resolveGeneration(answerReadyResponse));

    expect(await screen.findByText(response.suggestedAnswer)).toBeVisible();
    expect(screen.getByText(response.shortVersion)).toBeVisible();
    expect(screen.getByText(response.strategicNote)).toBeVisible();
    expect(screen.getByRole('button', { name: /Pergunta 1/ })).toHaveTextContent(response.detectedQuestion);
    expect(transcript).toHaveValue('');
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(useInterviewStore.getState()).toMatchObject({
      sessionId: 'session-test', sessionStatus: 'listening', history: [response],
    });

    await interaction.click(screen.getByRole('button', { name: /Encerrar sessão/ }));

    expect(api.endSession).toHaveBeenCalledExactlyOnceWith('session-test');
    expect(await screen.findByText('Resumo final: Resumo simulado da entrevista.')).toBeVisible();
    expect(screen.getByText('Sessão encerrada')).toBeVisible();
    expect(useInterviewStore.getState()).toMatchObject({
      sessionId: null, sessionStatus: 'closed', summary: 'Resumo simulado da entrevista.',
    });
    expect(stopTrack).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /Gerar resposta/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Encerrar sessão/ })).toBeDisabled();
  });

  it.each(['transcript', 'generation'] as const)(
    'closes the local session when %s returns SESSION_CLOSED',
    async (failureAt) => {
      vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
      const closedError = new ApiError('Sessão encerrada.', 409, 'SESSION_CLOSED');
      if (failureAt === 'transcript') {
        vi.mocked(api.addTranscript).mockRejectedValue(closedError);
      } else {
        vi.mocked(api.generateResponse).mockRejectedValue(closedError);
      }
      useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
      const interaction = userEvent.setup();
      await renderAuthenticatedHome();

      await interaction.type(
        screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
        response.detectedQuestion,
      );
      await interaction.click(screen.getByRole('button', { name: /Gerar resposta/ }));

      expect(await screen.findByText('Sessão encerrada.')).toBeVisible();
      expect(screen.getByText('Sessão encerrada')).toBeVisible();
      expect(useInterviewStore.getState()).toMatchObject({ sessionId: null, sessionStatus: 'closed' });
      expect(screen.getByRole('button', { name: /Gerar resposta/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Iniciar escuta/ })).toBeEnabled();
      if (failureAt === 'transcript') expect(api.generateResponse).not.toHaveBeenCalled();
      expect(api.endSession).not.toHaveBeenCalled();
    },
  );
});
