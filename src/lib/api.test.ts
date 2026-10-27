import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, buildRequestHeaders, setUnauthorizedHandler } from './api';
import { ApiError } from './interview-contract';

const fetchMock = vi.fn<typeof fetch>();
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const expectedHeaders = (extra: Record<string, string> = {}) =>
  expect.objectContaining({
    'content-type': 'application/json',
    'x-request-id': expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
    ...Object.fromEntries(
      Object.entries(extra).map(([key, value]) => [key.toLowerCase(), value]),
    ),
  });

function headersFromCall(call = 0): Record<string, string> {
  const headers = fetchMock.mock.calls[call]?.[1]?.headers;
  return Object.fromEntries(new Headers(headers).entries());
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setUnauthorizedHandler(null);
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe('API request contract', () => {
  it('includes cookies and JSON headers on authenticated GET requests', async () => {
    const user = { id: 'user-a', email: 'a@example.test', createdAt: '2026-10-22', updatedAt: '2026-10-22' };
    fetchMock.mockResolvedValue(jsonResponse(user));
    await expect(api.me()).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/auth\/me$/), {
      credentials: 'include', headers: expect.any(Headers),
    });
    expect(headersFromCall()).toEqual(expectedHeaders());
  });

  it.each(['login', 'register'] as const)('serializes the %s payload with credentials', async (operation) => {
    const credentials = { email: 'a@example.test', password: 'test-only-password' };
    fetchMock.mockResolvedValue(jsonResponse({ user: { id: 'user-a', email: credentials.email } }));
    await api[operation](credentials);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(new RegExp(`/auth/${operation}$`)), {
      method: 'POST', body: JSON.stringify(credentials), credentials: 'include',
      headers: expect.any(Headers),
    });
    expect(headersFromCall()).toEqual(expectedHeaders());
  });

  it('merges the transcript idempotency header with the JSON header', async () => {
    const payload = { transcript: 'Como você trata concorrência?' };
    fetchMock.mockResolvedValue(jsonResponse({ id: 'chunk-a' }));
    await expect(api.addTranscript('session-a', payload, 'transcript-key')).resolves.toEqual({ id: 'chunk-a' });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/interview\/sessions\/session-a\/transcripts$/), {
      method: 'POST', body: JSON.stringify(payload), credentials: 'include',
      headers: expect.any(Headers),
    });
    expect(headersFromCall()).toEqual(expectedHeaders({ 'Idempotency-Key': 'transcript-key' }));
  });

  it.each([undefined, { provider: 'gemini' as const, model: 'test-model' }])
    ('sends generation options and idempotency metadata: %j', async (payload) => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 'response-a' }));
      await api.generateResponse('session-a', payload, 'generation-key');
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/interview\/sessions\/session-a\/generate-response$/), {
        method: 'POST', body: JSON.stringify(payload ?? {}), credentials: 'include',
        headers: expect.any(Headers),
      });
      expect(headersFromCall()).toEqual(expectedHeaders({ 'Idempotency-Key': 'generation-key' }));
    });

  it('sends a forced question with generation options and idempotency metadata', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'response-a' }));

    await api.generateResponse(
      'session-a',
      { forceQuestion: 'Como você lidera incidentes?', provider: 'gemini', model: 'test-model' },
      'manual-generation-key',
    );

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/interview\/sessions\/session-a\/generate-response$/),
      {
        method: 'POST',
        body: JSON.stringify({
          forceQuestion: 'Como você lidera incidentes?',
          provider: 'gemini',
          model: 'test-model',
        }),
        credentials: 'include',
        headers: expect.any(Headers),
      },
    );
    expect(headersFromCall()).toEqual(expectedHeaders({ 'Idempotency-Key': 'manual-generation-key' }));
  });

  it('reads and retries the semantic summary through the session contract', async () => {
    const summary = { id: 'summary-a', sessionId: 'session-a', status: 'PENDING' };
    fetchMock.mockResolvedValueOnce(jsonResponse(summary)).mockResolvedValueOnce(jsonResponse(summary));
    await expect(api.getSessionSummary('session-a')).resolves.toEqual(summary);
    await expect(api.retrySessionSummary('session-a')).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/interview\/sessions\/session-a\/summary$/), {
      credentials: 'include', headers: expect.any(Headers),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/interview\/sessions\/session-a\/summary\/retry$/), {
      method: 'POST', body: JSON.stringify({}), credentials: 'include',
      headers: expect.any(Headers),
    });
    expect(headersFromCall(0)).toEqual(expectedHeaders());
    expect(headersFromCall(1)).toEqual(expectedHeaders());
  });

  it('creates a fresh request ID and preserves an explicit one', () => {
    const first = buildRequestHeaders();
    const second = buildRequestHeaders();
    expect(first.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second.get('X-Request-ID')).not.toBe(first.get('X-Request-ID'));
    const explicit = crypto.randomUUID();
    expect(buildRequestHeaders({ 'X-Request-ID': explicit }).get('X-Request-ID')).toBe(explicit);
  });
});

describe('API failures and unauthorized handler', () => {
  it('converts public error metadata to ApiError without exposing additional fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      message: ' Sessão encerrada. ', statusCode: 409, code: 'SESSION_CLOSED', secret: 'private detail',
    }, 409));
    const error = await api.endSession('session-a').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'ApiError', message: 'Sessão encerrada.', statusCode: 409, code: 'SESSION_CLOSED' });
    expect(error).not.toHaveProperty('secret');
  });

  it('preserves rate-limit wait metadata with a header fallback', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        message: 'Aguarde.',
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: 7,
      }, 429))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: 'Aguarde.',
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      }), { status: 429, headers: { 'Retry-After': '9' } }));

    await expect(api.me()).rejects.toMatchObject({ retryAfterSeconds: 7 });
    await expect(api.me()).rejects.toMatchObject({ retryAfterSeconds: 9 });
  });

  it('uses a safe fallback for non-JSON failures', async () => {
    fetchMock.mockResolvedValue(new Response('private upstream detail', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({
      name: 'ApiError', message: 'Erro de requisição', statusCode: undefined, code: undefined,
    });
  });

  it('invokes the current global handler once on 401 and still rejects with ApiError', async () => {
    const previousHandler = vi.fn();
    const handler = vi.fn();
    setUnauthorizedHandler(previousHandler);
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Não autorizado.', statusCode: 401, code: 'UNAUTHORIZED' }, 401));
    await expect(api.me()).rejects.toMatchObject({ name: 'ApiError', statusCode: 401, code: 'UNAUTHORIZED' });
    expect(handler).toHaveBeenCalledOnce();
    expect(previousHandler).not.toHaveBeenCalled();
  });

  it('supports unregistering the unauthorized handler', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    setUnauthorizedHandler(null);
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Não autorizado.' }, 401));
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([403, 409, 500])('does not invoke the unauthorized handler for HTTP %s', async (status) => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Requisição recusada.', statusCode: status }, status));
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves a transport failure without invoking the unauthorized handler', async () => {
    const handler = vi.fn();
    const failure = new TypeError('Network unavailable');
    setUnauthorizedHandler(handler);
    fetchMock.mockRejectedValue(failure);
    await expect(api.me()).rejects.toBe(failure);
    expect(handler).not.toHaveBeenCalled();
  });
});
