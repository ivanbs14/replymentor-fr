import { beforeEach, describe, expect, it } from 'vitest';
import type { QuestionDetection, SessionSummaryResponse, SuggestedAnswerResponse } from './api';
import { useInterviewStore } from './interview-store';

const initialState = useInterviewStore.getInitialState();
const detection = (id: string, source: QuestionDetection['source'] = 'DETERMINISTIC'): QuestionDetection => ({
  id, status: 'DETECTED', question: `Pergunta ${id}?`, confidence: source === 'MANUAL' ? 1 : 0.92,
  source, evidence: [], detectorVersion: source === 'MANUAL' ? 'manual' : 'detector-v1',
  provider: null, model: null, createdAt: '2026-10-22T12:00:00.000Z',
});
const answer = (id: string): SuggestedAnswerResponse => ({
  id, detectedQuestion: `Pergunta ${id}?`, suggestedAnswer: `Resposta ${id}`,
  shortVersion: 'Resposta curta', keyPoints: ['Ponto principal'],
  strategicNote: 'Explique o contexto.', createdAt: '2026-10-22T12:00:00.000Z',
});
const summary: SessionSummaryResponse = {
  id: 'summary-a', sessionId: 'session-a', status: 'PENDING', content: null,
  fallbackContent: 'Resumo final', provider: null, model: null,
  promptVersion: 'session-summary-v1', startedAt: null, completedAt: null, errorCode: null,
};

beforeEach(() => useInterviewStore.setState(initialState, true));

describe('interview state', () => {
  it('resets all interview data while preserving the authenticated user', () => {
    const user = { id: 'user-a', email: 'a@example.test' };
    const store = useInterviewStore.getState();
    store.setAuthUser(user);
    for (const field of Object.keys(initialState.contextForm)) store.setContextField(field, 'private interview data');
    store.setContextId('context-a');
    store.setSessionId('session-a');
    store.setSessionStatus('closed');
    store.setTranscriptInput('Private transcript');
    store.pushAnswer(detection('detection-a'), answer('answer-a'));
    store.setSummary({ ...summary, fallbackContent: 'Private summary' });
    store.resetInterviewState();

    expect(useInterviewStore.getState()).toMatchObject({
      authUser: user, contextForm: initialState.contextForm, contextId: null,
      sessionId: null, sessionStatus: 'idle', transcriptInput: '',
      currentCycle: { status: 'idle' }, history: [], summary: null,
    });
  });

  it('clears the user independently from interview data', () => {
    const store = useInterviewStore.getState();
    store.setAuthUser({ id: 'user-a', email: 'a@example.test' });
    store.setContextId('context-a');
    store.setAuthUser(null);
    expect(useInterviewStore.getState()).toMatchObject({ authUser: null, contextId: 'context-a' });
  });

  it('updates one context field without losing other fields and supports replacing the form', () => {
    const store = useInterviewStore.getState();
    store.setContextField('companyName', 'Empresa Exemplo');
    expect(useInterviewStore.getState().contextForm).toEqual({ ...initialState.contextForm, companyName: 'Empresa Exemplo' });
    const replacement = { ...initialState.contextForm, resumeText: 'Novo currículo', companyName: 'Outra Empresa' };
    store.setContextForm(replacement);
    expect(useInterviewStore.getState().contextForm).toEqual(replacement);
  });

  it('tracks listening, processing, ready and closed session states with the final summary', () => {
    const store = useInterviewStore.getState();
    store.setContextId('context-a');
    store.setSessionId('session-a');
    store.setSessionStatus('listening');
    store.setTranscriptInput('Qual foi seu maior desafio?');
    expect(useInterviewStore.getState()).toMatchObject({
      contextId: 'context-a', sessionId: 'session-a', sessionStatus: 'listening',
      transcriptInput: 'Qual foi seu maior desafio?',
    });
    store.setSessionStatus('processing');
    expect(useInterviewStore.getState().sessionStatus).toBe('processing');
    const detected = detection('detection-a');
    const response = answer('answer-a');
    store.pushAnswer(detected, response);
    store.setSessionStatus('ready');
    expect(useInterviewStore.getState()).toMatchObject({
      sessionStatus: 'ready', currentCycle: { status: 'answer-ready', detection: detected, answer: response },
    });
    store.setSummary(summary);
    store.setSessionId(null);
    store.setSessionStatus('closed');
    expect(useInterviewStore.getState()).toMatchObject({
      sessionId: null,
      sessionStatus: 'closed',
      summary: {
        id: 'summary-a', sessionId: 'session-a', status: 'PENDING', content: null,
        fallbackContent: 'Resumo final', provider: null, model: null,
        promptVersion: 'session-summary-v1', startedAt: null, completedAt: null, errorCode: null,
      },
      history: [{ detection: detected, answer: response }],
    });
    store.setContextId(null);
    store.setTranscriptInput('');
    expect(useInterviewStore.getState()).toMatchObject({ contextId: null, transcriptInput: '' });
  });
});

describe('current response cycle', () => {
  it('moves through processing and confirmation before storing a corrected answer', () => {
    const automaticDetection = detection('automatic');
    const manualDetection = detection('manual', 'MANUAL');
    const manualAnswer = answer('manual-answer');
    const store = useInterviewStore.getState();
    store.setCycleProcessing();
    expect(useInterviewStore.getState().currentCycle).toEqual({ status: 'processing' });
    store.setNeedsConfirmation(automaticDetection);
    expect(useInterviewStore.getState().currentCycle).toEqual({ status: 'needs-confirmation', detection: automaticDetection });
    store.pushAnswer(manualDetection, manualAnswer);
    expect(useInterviewStore.getState().currentCycle).toEqual({
      status: 'answer-ready', detection: manualDetection, answer: manualAnswer,
    });
    expect(useInterviewStore.getState().history).toEqual([{ detection: manualDetection, answer: manualAnswer }]);
    store.clearCurrentCycle();
    expect(useInterviewStore.getState().currentCycle).toEqual({ status: 'idle' });
  });
});

describe('response history', () => {
  it('keeps the 20 most recent responses in newest-first order', () => {
    const items = Array.from({ length: 21 }, (_, index) => ({
      detection: detection(`detection-${index}`), answer: answer(`answer-${index}`),
    }));
    items.forEach((item) => useInterviewStore.getState().pushAnswer(item.detection, item.answer));
    expect(useInterviewStore.getState().history).toEqual(items.slice(1).reverse());
    expect(useInterviewStore.getState().currentCycle).toEqual({ status: 'answer-ready', ...items[20] });
  });

  it('selects an earlier response with its detection without reordering history', () => {
    const first = { detection: detection('first-detection'), answer: answer('first-answer') };
    const second = { detection: detection('second-detection'), answer: answer('second-answer') };
    const store = useInterviewStore.getState();
    store.pushAnswer(first.detection, first.answer);
    store.pushAnswer(second.detection, second.answer);
    store.selectResponse(first.answer.id);
    expect(useInterviewStore.getState()).toMatchObject({
      currentCycle: { status: 'answer-ready', ...first }, history: [second, first],
    });
    store.selectResponse('missing');
    expect(useInterviewStore.getState().currentCycle).toEqual({ status: 'answer-ready', ...first });
  });

  it('leaves an empty history and idle cycle unchanged when selecting an unknown response', () => {
    useInterviewStore.getState().selectResponse('missing');
    expect(useInterviewStore.getState()).toMatchObject({ currentCycle: { status: 'idle' }, history: [] });
  });
});
