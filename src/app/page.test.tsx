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
    getSessionSummary: vi.fn(),
    retrySessionSummary: vi.fn(),
  },
  setUnauthorizedHandler: vi.fn(),
}));

const user = { id: 'user-test', email: 'candidate@example.test' };
const pendingSummary = {
  id: 'summary-test',
  sessionId: 'session-test',
  status: 'PENDING' as const,
  content: null,
  fallbackContent: 'Resumo simulado da entrevista.',
  provider: null,
  model: null,
  promptVersion: 'session-summary-v1',
  startedAt: null,
  completedAt: null,
  errorCode: null,
};
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
const uncertainDetection = {
  ...answerReadyResponse.detection,
  id: 'detection-uncertain',
  source: 'LLM' as const,
  confidence: 0.42,
};
const notFoundDetection = {
  ...uncertainDetection,
  id: 'detection-not-found',
  status: 'NOT_FOUND' as const,
  question: null,
};
const manualDetection = {
  ...answerReadyResponse.detection,
  id: 'detection-manual',
  source: 'MANUAL' as const,
};
const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  static deferStop = false;
  static pendingStop: (() => void) | null = null;
  static stopCalls = 0;
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start() {
    this.state = 'recording';
  }

  stop() {
    FakeMediaRecorder.stopCalls += 1;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['simulated audio'], { type: this.mimeType }) });
    const finish = () => this.onstop?.();
    if (FakeMediaRecorder.deferStop) FakeMediaRecorder.pendingStop = finish;
    else finish();
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
  vi.mocked(api.getSessionSummary).mockResolvedValue(pendingSummary);
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  FakeMediaRecorder.isTypeSupported.mockReturnValue(true);
  FakeMediaRecorder.deferStop = false;
  FakeMediaRecorder.pendingStop = null;
  FakeMediaRecorder.stopCalls = 0;
  vi.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000004');
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
        history: [{ detection: answerReadyResponse.detection, answer: response }],
        currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
        summary: pendingSummary,
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
      currentCycle: { status: 'idle' },
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
        currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
        history: [{ detection: answerReadyResponse.detection, answer: response }],
        summary: pendingSummary,
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
      currentCycle: { status: 'idle' },
      history: [],
      summary: null,
    });
    unmount();
    expect(setUnauthorizedHandler).toHaveBeenLastCalledWith(null);
  });
});

describe('Home interview session', () => {
  it('presents public detection metadata without leaking absent confidence', async () => {
    useInterviewStore.setState({
      currentCycle: {
        status: 'answer-ready',
        detection: { ...answerReadyResponse.detection, source: 'DETERMINISTIC', confidence: 0.74 },
        answer: response,
      },
      history: [
        { detection: { ...answerReadyResponse.detection, source: 'DETERMINISTIC', confidence: 0.74 }, answer: response },
      ],
    });
    await renderAuthenticatedHome();

    expect(screen.getByText('Automática')).toBeVisible();
    expect(screen.getByText('74%')).toBeVisible();
    expect(screen.getByText('Confiança baixa')).toBeVisible();

    act(() => {
      useInterviewStore.setState({
        currentCycle: { status: 'answer-ready', detection: manualDetection, answer: response },
      });
    });
    expect(screen.getByText('Manual')).toBeVisible();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();

    act(() => {
      useInterviewStore.setState({
        currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
      });
    });
    expect(screen.getByText('Legada')).toBeVisible();
  });

  it('announces low confidence, focuses the field, and ignores confirmation by resuming capture', async () => {
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'ready',
      currentCycle: { status: 'needs-confirmation', detection: uncertainDetection },
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    const question = screen.getByRole('textbox', { name: 'Pergunta do entrevistador' });
    expect(question).toHaveFocus();
    expect(screen.getByText('Automática')).toBeVisible();
    expect(screen.getByText('Confiança baixa')).toBeVisible();
    expect(screen.getByText('42%')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/revise a pergunta/i);

    await interaction.click(screen.getByRole('button', { name: 'Ignorar por enquanto' }));

    expect(api.generateResponse).not.toHaveBeenCalled();
    expect(useInterviewStore.getState().currentCycle).toEqual({ status: 'idle' });
    expect(useInterviewStore.getState().sessionStatus).toBe('listening');
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
  });

  it('opens correction from an answer with the keyboard and focuses the response after success', async () => {
    vi.mocked(api.generateResponse).mockResolvedValue({
      ...answerReadyResponse,
      detection: manualDetection,
      answer: { ...response, id: 'response-corrected' },
    });
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    const correction = screen.getByRole('button', { name: 'Corrigir pergunta' });
    correction.focus();
    await interaction.keyboard('{Enter}');
    const question = screen.getByRole('textbox', { name: 'Pergunta do entrevistador' });
    expect(question).toHaveFocus();
    expect(question).toHaveValue(response.detectedQuestion);

    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));
    expect(await screen.findByText(response.suggestedAnswer)).toBeVisible();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sugestão de resposta' })).toHaveFocus());
    expect(useInterviewStore.getState().history).toEqual([
      { detection: manualDetection, answer: { ...response, id: 'response-corrected' } },
      { detection: answerReadyResponse.detection, answer: response },
    ]);

    await interaction.click(screen.getByRole('button', { name: /Pergunta 1/ }));
    expect(useInterviewStore.getState().currentCycle).toEqual({
      status: 'answer-ready',
      detection: answerReadyResponse.detection,
      answer: response,
    });
    expect(screen.getByText('Legada')).toBeVisible();
  });

  it('associates a recoverable manual error with the field and focuses the retry action', async () => {
    vi.mocked(api.generateResponse).mockRejectedValue(new ApiError('Falha temporária.', 503));
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'ready',
      currentCycle: { status: 'needs-confirmation', detection: uncertainDetection },
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));

    const error = await screen.findByText('Falha temporária.');
    const question = screen.getByRole('textbox', { name: 'Pergunta do entrevistador' });
    expect(question).toHaveValue(response.detectedQuestion);
    expect(question).toHaveAttribute('aria-describedby', expect.stringContaining('question-correction-error'));
    expect(error).toHaveAttribute('id', 'question-correction-error');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toHaveFocus();
  });

  it('shows only the current manual error after an earlier automatic failure', async () => {
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.generateResponse)
      .mockRejectedValueOnce(new ApiError('Erro automático antigo.', 503))
      .mockRejectedValueOnce(new ApiError('Erro manual atual.', 503));
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.type(
      screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
      'Novo trecho',
    );
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
    expect(await screen.findByText('Erro automático antigo.')).toBeVisible();

    await interaction.click(screen.getByRole('button', { name: 'Corrigir pergunta' }));
    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));

    const fieldError = await screen.findByText('Erro manual atual.');
    expect(fieldError).toHaveAttribute('id', 'question-correction-error');
    expect(screen.getByRole('status')).toHaveTextContent('Erro manual atual.');
    expect(screen.getByRole('status')).not.toHaveTextContent('Erro automático antigo.');
    expect(screen.queryByText('Erro automático antigo.')).not.toBeInTheDocument();
  });

  it('waits for an asynchronous recorder stop before exposing correction', async () => {
    FakeMediaRecorder.deferStop = true;
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
    await screen.findByText('Gravando... clique em Parar gravação.');
    await interaction.click(screen.getByRole('button', { name: 'Corrigir pergunta' }));

    expect(screen.queryByRole('textbox', { name: 'Pergunta do entrevistador' })).not.toBeInTheDocument();
    expect(FakeMediaRecorder.pendingStop).toBeTypeOf('function');
    act(() => FakeMediaRecorder.pendingStop?.());

    expect(await screen.findByRole('textbox', { name: 'Pergunta do entrevistador' })).toHaveFocus();
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('reuses an in-flight recorder stop across repeated correction attempts', async () => {
    FakeMediaRecorder.deferStop = true;
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
    await screen.findByText('Gravando... clique em Parar gravação.');
    const correction = screen.getByRole('button', { name: 'Corrigir pergunta' });
    act(() => {
      correction.click();
      correction.click();
    });

    expect(FakeMediaRecorder.stopCalls).toBe(1);
    expect(screen.getByRole('button', { name: 'Pausando captura…' })).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: 'Pergunta do entrevistador' })).not.toBeInTheDocument();

    act(() => FakeMediaRecorder.pendingStop?.());

    expect(await screen.findByRole('textbox', { name: 'Pergunta do entrevistador' })).toHaveFocus();
    expect(screen.getAllByRole('textbox', { name: 'Pergunta do entrevistador' })).toHaveLength(1);
  });

  it('invalidates a pending microphone request before opening correction', async () => {
    let resolveMedia!: (stream: { getTracks: () => { stop: typeof stopTrack }[] }) => void;
    getUserMedia.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMedia = resolve;
    }));
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
    await interaction.click(screen.getByRole('button', { name: 'Corrigir pergunta' }));
    expect(await screen.findByRole('textbox', { name: 'Pergunta do entrevistador' })).toBeVisible();

    act(() => resolveMedia({ getTracks: () => [{ stop: stopTrack }] }));
    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
    expect(screen.queryByText('Gravando... clique em Parar gravação.')).not.toBeInTheDocument();
  });

  it.each(['logout', 'unauthorized', 'session-closed', 'end-session'] as const)(
    'stops a late microphone stream after %s',
    async (flow) => {
      let resolveMedia!: (stream: { getTracks: () => { stop: typeof stopTrack }[] }) => void;
      getUserMedia.mockImplementationOnce(() => new Promise((resolve) => {
        resolveMedia = resolve;
      }));
      vi.mocked(api.logout).mockResolvedValue({ success: true });
      vi.mocked(api.endSession).mockResolvedValue({ ...pendingSummary, fallbackContent: 'Resumo.' });
      vi.mocked(api.addTranscript).mockRejectedValue(
        new ApiError('Sessão encerrada.', 409, 'SESSION_CLOSED'),
      );
      useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
      const interaction = userEvent.setup();
      await renderAuthenticatedHome();
      await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

      if (flow === 'logout') {
        await interaction.click(screen.getByRole('button', { name: 'Sair' }));
      } else if (flow === 'unauthorized') {
        const handler = vi.mocked(setUnauthorizedHandler).mock.calls.at(-1)?.[0];
        act(() => handler!());
      } else if (flow === 'session-closed') {
        await interaction.type(
          screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
          'Trecho final',
        );
        await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
        await screen.findByText('Sessão encerrada');
      } else {
        await interaction.click(screen.getByRole('button', { name: /Encerrar sessão/ }));
        await screen.findByText('Sessão encerrada');
      }

      act(() => resolveMedia({ getTracks: () => [{ stop: stopTrack }] }));
      await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
      expect(FakeMediaRecorder.stopCalls).toBe(0);
      expect(screen.queryByText('Gravando... clique em Parar gravação.')).not.toBeInTheDocument();
    },
  );

  it.each(['logout', 'unauthorized', 'session-closed', 'end-session'] as const)(
    'stops active capture during %s',
    async (flow) => {
      vi.mocked(api.logout).mockResolvedValue({ success: true });
      vi.mocked(api.endSession).mockResolvedValue({ ...pendingSummary, fallbackContent: 'Resumo.' });
      vi.mocked(api.addTranscript).mockRejectedValue(
        new ApiError('Sessão encerrada.', 409, 'SESSION_CLOSED'),
      );
      useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
      const interaction = userEvent.setup();
      await renderAuthenticatedHome();
      await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
      await screen.findByText('Gravando... clique em Parar gravação.');

      if (flow === 'logout') {
        await interaction.click(screen.getByRole('button', { name: 'Sair' }));
      } else if (flow === 'unauthorized') {
        const handler = vi.mocked(setUnauthorizedHandler).mock.calls.at(-1)?.[0];
        act(() => handler!());
      } else if (flow === 'session-closed') {
        fireEvent.change(
          screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
          { target: { value: 'Trecho final' } },
        );
        await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
        await screen.findByText('Sessão encerrada');
      } else {
        await interaction.click(screen.getByRole('button', { name: /Encerrar sessão/ }));
        await screen.findByText('Sessão encerrada');
      }

      await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
      expect(FakeMediaRecorder.stopCalls).toBe(1);
      expect(screen.queryByText('Gravando... clique em Parar gravação.')).not.toBeInTheDocument();
    },
  );

  it.each(['logout', 'unauthorized'] as const)(
    'discards recorded and selected audio across %s and re-authentication',
    async (flow) => {
      vi.mocked(api.logout).mockResolvedValue({ success: true });
      useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
      const interaction = userEvent.setup();
      const { container } = await renderAuthenticatedHome();
      const selectedAudio = new File(['previous audio'], 'audio-antigo.webm', {
        type: 'audio/webm',
      });
      await interaction.upload(container.querySelector('input[type="file"]')!, selectedAudio);
      expect(screen.getByText(/audio-antigo\.webm/)).toBeVisible();
      await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
      await screen.findByText('Gravando... clique em Parar gravação.');

      if (flow === 'logout') {
        await interaction.click(screen.getByRole('button', { name: 'Sair' }));
      } else {
        const handler = vi.mocked(setUnauthorizedHandler).mock.calls.at(-1)?.[0];
        act(() => handler!());
      }
      await screen.findByRole('button', { name: 'Entrar' });
      localStorage.setItem('replymentor_selected_context_id', 'context-test');
      act(() => useInterviewStore.setState({
        authUser: user,
        contextId: 'context-test',
        sessionId: 'session-new',
        sessionStatus: 'listening',
      }));

      expect(await screen.findByText(user.email)).toBeVisible();
      expect(screen.queryByText(/audio-antigo\.webm/)).not.toBeInTheDocument();
      await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
      expect(await screen.findByText(
        'Adicione um transcript manual ou selecione um áudio para análise.',
      )).toBeVisible();
      expect(api.addTranscript).not.toHaveBeenCalled();
    },
  );

  it.each(['logout', 'end-session'] as const)(
    'resumes capture when provisional %s cancellation fails',
    async (flow) => {
      vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      vi.mocked(api.logout).mockRejectedValue(new ApiError('Falha ao sair.', 503));
      vi.mocked(api.endSession).mockRejectedValue(new ApiError('Falha ao encerrar.', 503));
      useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
      const interaction = userEvent.setup();
      await renderAuthenticatedHome();
      await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
      await screen.findByText('Gravando... clique em Parar gravação.');

      if (flow === 'logout') {
        await interaction.click(screen.getByRole('button', { name: 'Sair' }));
        await waitFor(() => expect(window.alert).toHaveBeenCalled());
      } else {
        await interaction.click(screen.getByRole('button', { name: /Encerrar sessão/ }));
        expect(await screen.findByText('Falha ao encerrar.')).toBeVisible();
      }

      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      expect(useInterviewStore.getState()).toMatchObject({
        sessionId: 'session-test',
        sessionStatus: 'listening',
      });
      expect(await screen.findByText('Gravando... clique em Parar gravação.')).toBeVisible();
    },
  );

  it('discards a deferred recorder finalization when logout happens after stop begins', async () => {
    FakeMediaRecorder.deferStop = true;
    vi.mocked(api.logout).mockResolvedValue({ success: true });
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();
    await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
    await screen.findByText('Gravando... clique em Parar gravação.');
    await interaction.click(screen.getByRole('button', { name: 'Corrigir pergunta' }));
    expect(FakeMediaRecorder.pendingStop).toBeTypeOf('function');

    await interaction.click(screen.getByRole('button', { name: 'Sair' }));
    await screen.findByRole('button', { name: 'Entrar' });
    localStorage.setItem('replymentor_selected_context_id', 'context-test');
    act(() => useInterviewStore.setState({
      authUser: user,
      contextId: 'context-test',
      sessionId: 'session-new',
      sessionStatus: 'listening',
    }));
    act(() => FakeMediaRecorder.pendingStop?.());

    expect(await screen.findByText(user.email)).toBeVisible();
    expect(screen.queryByText(/captura-\d+\.webm/)).not.toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
    expect(await screen.findByText(
      'Adicione um transcript manual ou selecione um áudio para análise.',
    )).toBeVisible();
    expect(api.addTranscript).not.toHaveBeenCalled();
  });

  it.each(['logout', 'end-session'] as const)(
    'waits for deferred capture finalization before restarting after failed %s',
    async (flow) => {
      FakeMediaRecorder.deferStop = true;
      vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      vi.mocked(api.logout).mockRejectedValue(new ApiError('Falha ao sair.', 503));
      vi.mocked(api.endSession).mockRejectedValue(new ApiError('Falha ao encerrar.', 503));
      useInterviewStore.setState({
        sessionId: 'session-test',
        sessionStatus: 'listening',
        currentCycle: { status: 'answer-ready', detection: answerReadyResponse.detection, answer: response },
        history: [{ detection: answerReadyResponse.detection, answer: response }],
      });
      const interaction = userEvent.setup();
      await renderAuthenticatedHome();
      await interaction.click(screen.getByRole('button', { name: 'Iniciar gravação' }));
      await screen.findByText('Gravando... clique em Parar gravação.');
      await interaction.click(screen.getByRole('button', { name: 'Corrigir pergunta' }));
      expect(FakeMediaRecorder.pendingStop).toBeTypeOf('function');

      if (flow === 'logout') {
        await interaction.click(screen.getByRole('button', { name: 'Sair' }));
      } else {
        await interaction.click(screen.getByRole('button', { name: /Encerrar sessão/ }));
      }
      await waitFor(() => expect(flow === 'logout' ? api.logout : api.endSession).toHaveBeenCalledOnce());
      expect(getUserMedia).toHaveBeenCalledOnce();

      act(() => FakeMediaRecorder.pendingStop?.());
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      if (flow === 'end-session') {
        expect(await screen.findByText('Falha ao encerrar.')).toBeVisible();
      }
      expect(useInterviewStore.getState().sessionStatus).toBe('listening');
    },
  );

  it('clears a manual error on ignore and still shows a later global error', async () => {
    vi.mocked(api.generateResponse).mockRejectedValue(new ApiError('Erro manual antigo.', 503));
    vi.mocked(api.endSession).mockRejectedValue(new ApiError('Falha ao encerrar.', 503));
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'ready',
      currentCycle: { status: 'needs-confirmation', detection: uncertainDetection },
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();
    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));
    expect(await screen.findByText('Erro manual antigo.')).toBeVisible();

    await interaction.click(screen.getByRole('button', { name: 'Ignorar por enquanto' }));
    act(() => useInterviewStore.getState().setNeedsConfirmation(notFoundDetection));

    expect(screen.queryByText('Erro manual antigo.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar e gerar resposta' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/não identificamos uma pergunta clara/i);
    await interaction.click(screen.getByRole('button', { name: /Encerrar sessão/ }));
    expect(await screen.findByText('Falha ao encerrar.')).toBeVisible();
  });

  it('starts capture, generates from the manual transcript and ends with a summary', async () => {
    vi.mocked(api.startSession).mockResolvedValue({ id: 'session-test' });
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.endSession).mockResolvedValue(pendingSummary);
    let resolveGeneration!: (value: Awaited<ReturnType<typeof api.generateResponse>>) => void;
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
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: {
        status: 'answer-ready',
        detection: answerReadyResponse.detection,
        answer: response,
      },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });

    await interaction.click(screen.getByRole('button', { name: /Encerrar sessão/ }));

    expect(api.endSession).toHaveBeenCalledExactlyOnceWith('session-test');
    expect(await screen.findByText(/Resumo simulado da entrevista\./)).toBeVisible();
    expect(screen.getByText('Sessão encerrada')).toBeVisible();
    expect(useInterviewStore.getState()).toMatchObject({
      sessionId: null, sessionStatus: 'closed', summary: pendingSummary,
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

  it('pauses on a detected question that needs confirmation and hides the previous answer', async () => {
    vi.mocked(api.startSession).mockResolvedValue({ id: 'session-test' });
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.generateResponse).mockResolvedValue({
      status: 'NEEDS_CONFIRMATION',
      detection: uncertainDetection,
      answer: null,
    });
    useInterviewStore.setState({
      currentCycle: {
        status: 'answer-ready',
        detection: answerReadyResponse.detection,
        answer: response,
      },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.click(screen.getByRole('button', { name: /Iniciar escuta/ }));
    await interaction.type(
      screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
      'Trecho incerto',
    );
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));

    expect(await screen.findByRole('textbox', { name: 'Pergunta do entrevistador' }))
      .toHaveValue(response.detectedQuestion);
    expect(screen.queryByText(response.suggestedAnswer)).not.toBeInTheDocument();
    expect(useInterviewStore.getState().currentCycle).toEqual({
      status: 'needs-confirmation',
      detection: uncertainDetection,
    });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('shows an empty correction field and the approved instruction when no question was found', async () => {
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.generateResponse).mockResolvedValue({
      status: 'NEEDS_CONFIRMATION',
      detection: notFoundDetection,
      answer: null,
    });
    useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.type(
      screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
      'Trecho sem pergunta',
    );
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não identificamos uma pergunta clara no trecho mais recente. Informe a pergunta do entrevistador para continuar.',
    );
    expect(screen.getByRole('textbox', { name: 'Pergunta do entrevistador' })).toHaveValue('');
  });

  it('generates a manual correction without resending the transcript', async () => {
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.generateResponse)
      .mockResolvedValueOnce({
        status: 'NEEDS_CONFIRMATION',
        detection: uncertainDetection,
        answer: null,
      })
      .mockResolvedValueOnce({
        ...answerReadyResponse,
        detection: manualDetection,
      });
    useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.type(
      screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
      'Trecho incerto',
    );
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
    const question = await screen.findByRole('textbox', { name: 'Pergunta do entrevistador' });
    await interaction.clear(question);
    await interaction.type(question, '  Como você lidera incidentes?  ');
    vi.mocked(api.addTranscript).mockClear();
    vi.mocked(api.generateResponse).mockClear();
    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));

    await waitFor(() => expect(api.generateResponse).toHaveBeenCalledExactlyOnceWith(
      'session-test',
      {
        forceQuestion: 'Como você lidera incidentes?',
        provider: 'ollama',
        model: undefined,
      },
      '00000000-0000-4000-8000-000000000003',
    ));
    expect(api.addTranscript).not.toHaveBeenCalled();
    expect(await screen.findByText(response.suggestedAnswer)).toBeVisible();
    expect(useInterviewStore.getState().currentCycle).toEqual({
      status: 'answer-ready',
      detection: manualDetection,
      answer: response,
    });
    expect(useInterviewStore.getState().history).toEqual([
      { detection: manualDetection, answer: response },
    ]);
  });

  it('closes correction without retry when manual generation returns SESSION_CLOSED', async () => {
    vi.mocked(api.generateResponse).mockRejectedValue(
      new ApiError('Sessão encerrada.', 409, 'SESSION_CLOSED'),
    );
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'ready',
      currentCycle: { status: 'needs-confirmation', detection: uncertainDetection },
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));

    expect(await screen.findByText('Sessão encerrada')).toBeVisible();
    expect(useInterviewStore.getState()).toMatchObject({
      sessionId: null,
      sessionStatus: 'closed',
      currentCycle: { status: 'idle' },
    });
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Pergunta do entrevistador' })).not.toBeInTheDocument();
  });

  it('ignores a late manual callback after authentication reset clears pending state', async () => {
    let resolveGeneration!: (value: Awaited<ReturnType<typeof api.generateResponse>>) => void;
    vi.mocked(api.generateResponse).mockImplementation(() => new Promise((resolve) => {
      resolveGeneration = resolve;
    }));
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'ready',
      currentCycle: { status: 'needs-confirmation', detection: uncertainDetection },
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));
    await waitFor(() => expect(api.generateResponse).toHaveBeenCalledOnce());
    const handler = vi.mocked(setUnauthorizedHandler).mock.calls.at(-1)?.[0];
    act(() => handler!());
    await screen.findByRole('button', { name: 'Entrar' });
    act(() => resolveGeneration({ ...answerReadyResponse, detection: manualDetection }));

    await waitFor(() => expect(useInterviewStore.getState()).toMatchObject({
      authUser: null,
      sessionId: null,
      sessionStatus: 'idle',
      currentCycle: { status: 'idle' },
      history: [],
    }));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('retries a failed manual correction with the same payload and idempotency key', async () => {
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.generateResponse)
      .mockResolvedValueOnce({
        status: 'NEEDS_CONFIRMATION',
        detection: uncertainDetection,
        answer: null,
      })
      .mockRejectedValueOnce(new ApiError('Falha temporária.', 503))
      .mockResolvedValueOnce({ ...answerReadyResponse, detection: manualDetection });
    useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.type(
      screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
      'Trecho incerto',
    );
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
    const question = await screen.findByRole('textbox', { name: 'Pergunta do entrevistador' });
    await interaction.clear(question);
    await interaction.type(question, 'Como você lidera incidentes?');
    vi.mocked(api.generateResponse).mockClear();

    await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));
    expect(await screen.findByText('Falha temporária.')).toBeVisible();
    await interaction.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(api.generateResponse).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.generateResponse).mock.calls[0]).toEqual(
      vi.mocked(api.generateResponse).mock.calls[1],
    );
    expect(api.addTranscript).toHaveBeenCalledOnce();
  });

  it.each(['logout', 'unauthorized'] as const)(
    'ignores a late automatic callback after %s invalidates the operation',
    async (invalidation) => {
      vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
      vi.mocked(api.logout).mockResolvedValue({ success: true });
      let resolveGeneration!: (value: typeof answerReadyResponse) => void;
      vi.mocked(api.generateResponse).mockImplementation(() => new Promise((resolve) => {
        resolveGeneration = resolve;
      }));
      useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
      const interaction = userEvent.setup();
      await renderAuthenticatedHome();

      await interaction.type(
        screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
        'Trecho pendente',
      );
      await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
      await waitFor(() => expect(api.generateResponse).toHaveBeenCalledOnce());

      if (invalidation === 'logout') {
        await interaction.click(screen.getByRole('button', { name: 'Sair' }));
      } else {
        const handler = vi.mocked(setUnauthorizedHandler).mock.calls.at(-1)?.[0];
        act(() => handler!());
      }
      await screen.findByRole('button', { name: 'Entrar' });
      act(() => resolveGeneration(answerReadyResponse));

      await waitFor(() => expect(useInterviewStore.getState()).toMatchObject({
        authUser: null,
        sessionId: null,
        sessionStatus: 'idle',
        currentCycle: { status: 'idle' },
        history: [],
      }));
      expect(getUserMedia).not.toHaveBeenCalled();
    },
  );

  it('retries automatic generation with both original payloads and idempotency keys', async () => {
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.generateResponse)
      .mockRejectedValueOnce(new ApiError('Falha temporária.', 503))
      .mockResolvedValueOnce(answerReadyResponse);
    useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.type(
      screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
      '  Trecho original  ',
    );
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
    expect(await screen.findByText('Falha temporária.')).toBeVisible();
    expect(useInterviewStore.getState().currentCycle).toEqual({ status: 'idle' });
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));

    await screen.findByText(response.suggestedAnswer);
    expect(api.addTranscript).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.addTranscript).mock.calls[0]).toEqual(
      vi.mocked(api.addTranscript).mock.calls[1],
    );
    expect(api.generateResponse).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.generateResponse).mock.calls[0]).toEqual(
      vi.mocked(api.generateResponse).mock.calls[1],
    );
  });

  it('restores the latest history item after a recoverable automatic failure', async () => {
    vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
    vi.mocked(api.generateResponse).mockRejectedValue(new ApiError('Falha temporária.', 503));
    useInterviewStore.setState({
      sessionId: 'session-test',
      sessionStatus: 'listening',
      currentCycle: {
        status: 'answer-ready',
        detection: answerReadyResponse.detection,
        answer: response,
      },
      history: [{ detection: answerReadyResponse.detection, answer: response }],
    });
    const interaction = userEvent.setup();
    await renderAuthenticatedHome();

    await interaction.type(
      screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
      'Novo trecho',
    );
    await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));

    expect(await screen.findByText('Falha temporária.')).toBeVisible();
    expect(useInterviewStore.getState().currentCycle).toEqual({
      status: 'answer-ready',
      detection: answerReadyResponse.detection,
      answer: response,
    });
    expect(screen.getByText(response.suggestedAnswer)).toBeVisible();
  });

  it.each(['question', 'provider', 'model'] as const)(
    'invalidates a failed manual operation when the %s changes',
    async (editedField) => {
      vi.mocked(api.addTranscript).mockResolvedValue({ id: 'transcript-test' });
      vi.mocked(api.generateResponse)
        .mockResolvedValueOnce({
          status: 'NEEDS_CONFIRMATION',
          detection: uncertainDetection,
          answer: null,
        })
        .mockRejectedValueOnce(new ApiError('Falha temporária.', 503))
        .mockResolvedValueOnce({ ...answerReadyResponse, detection: manualDetection });
      useInterviewStore.setState({ sessionId: 'session-test', sessionStatus: 'listening' });
      const interaction = userEvent.setup();
      await renderAuthenticatedHome();

      await interaction.type(
        screen.getByPlaceholderText('Cole aqui a última fala/pergunta do entrevistador...'),
        'Trecho incerto',
      );
      await interaction.click(screen.getByRole('button', { name: /Gerar resposta$/ }));
      const question = await screen.findByRole('textbox', { name: 'Pergunta do entrevistador' });
      await interaction.clear(question);
      await interaction.type(question, 'Como você lidera incidentes?');
      vi.mocked(api.generateResponse).mockClear();
      await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));
      expect(await screen.findByText('Falha temporária.')).toBeVisible();

      if (editedField === 'question') await interaction.type(question, ' Em produção');
      if (editedField === 'provider') await interaction.selectOptions(screen.getByRole('combobox'), 'gemini');
      if (editedField === 'model') {
        await interaction.type(screen.getByPlaceholderText('Padrão do backend para Ollama'), 'modelo-novo');
      }
      await interaction.click(screen.getByRole('button', { name: 'Confirmar e gerar resposta' }));

      await waitFor(() => expect(api.generateResponse).toHaveBeenCalledTimes(2));
      expect(vi.mocked(api.generateResponse).mock.calls[0][2]).toBe(
        '00000000-0000-4000-8000-000000000003',
      );
      expect(vi.mocked(api.generateResponse).mock.calls[1][2]).toBe(
        '00000000-0000-4000-8000-000000000004',
      );
      expect(vi.mocked(api.generateResponse).mock.calls[1][1]).not.toEqual(
        vi.mocked(api.generateResponse).mock.calls[0][1],
      );
    },
  );
});
