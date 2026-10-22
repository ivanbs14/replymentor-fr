import { beforeEach, describe, expect, it } from 'vitest';
import { useInterviewStore, type ResponseCard } from './interview-store';

const initialState = useInterviewStore.getInitialState();
const response = (id: string): ResponseCard => ({
  id, detectedQuestion: `Pergunta ${id}?`, suggestedAnswer: `Resposta ${id}`,
  shortVersion: 'Resposta curta', keyPoints: ['Ponto principal'],
  strategicNote: 'Explique o contexto.', createdAt: '2026-10-22T12:00:00.000Z',
});

beforeEach(() => {
  useInterviewStore.setState(initialState, true);
});

describe('interview state', () => {
  it('resets all interview data while preserving the authenticated user', () => {
    const user = { id: 'user-a', email: 'a@example.test' };
    const store = useInterviewStore.getState();
    store.setAuthUser(user);
    for (const field of Object.keys(initialState.contextForm)) {
      store.setContextField(field, 'private interview data');
    }
    store.setContextId('context-a');
    store.setSessionId('session-a');
    store.setSessionStatus('closed');
    store.setTranscriptInput('Private transcript');
    store.pushResponse(response('response-a'));
    store.setSummary('Private summary');
    store.resetInterviewState();

    expect(useInterviewStore.getState()).toMatchObject({
      authUser: user, contextForm: initialState.contextForm,
      contextId: null, sessionId: null, sessionStatus: 'idle', transcriptInput: '',
      latestResponse: null, history: [], summary: null,
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
    const card = response('response-a');
    store.pushResponse(card);
    store.setSessionStatus('ready');
    expect(useInterviewStore.getState()).toMatchObject({ sessionStatus: 'ready', latestResponse: card });
    store.setSummary('Resumo final');
    store.setSessionId(null);
    store.setSessionStatus('closed');
    expect(useInterviewStore.getState()).toMatchObject({
      sessionId: null, sessionStatus: 'closed', summary: 'Resumo final', history: [card],
    });
    store.setContextId(null);
    store.setTranscriptInput('');
    expect(useInterviewStore.getState()).toMatchObject({ contextId: null, transcriptInput: '' });
  });
});

describe('response history', () => {
  it('keeps the 20 most recent responses in newest-first order', () => {
    const cards = Array.from({ length: 21 }, (_, index) => response(`response-${index}`));
    cards.forEach((card) => useInterviewStore.getState().pushResponse(card));
    expect(useInterviewStore.getState().history).toEqual(cards.slice(1).reverse());
    expect(useInterviewStore.getState().latestResponse).toEqual(cards[20]);
  });

  it('selects an earlier response without reordering history', () => {
    const first = response('first');
    const second = response('second');
    const store = useInterviewStore.getState();
    store.pushResponse(first);
    store.pushResponse(second);
    store.selectResponse(first.id);
    expect(useInterviewStore.getState()).toMatchObject({ latestResponse: first, history: [second, first] });
    store.selectResponse('missing');
    expect(useInterviewStore.getState().latestResponse).toEqual(first);
  });

  it('leaves an empty history unchanged when selecting an unknown response', () => {
    useInterviewStore.getState().selectResponse('missing');
    expect(useInterviewStore.getState()).toMatchObject({ latestResponse: null, history: [] });
  });
});
