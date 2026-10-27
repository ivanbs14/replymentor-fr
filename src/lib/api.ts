import {
  ApiError,
  parseApiError,
  type InterviewContextInput,
  type LlmProvider,
} from './interview-contract';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

let unauthorizedHandler: (() => void) | null = null;

export function buildRequestHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (!result.has('Content-Type')) result.set('Content-Type', 'application/json');
  if (!result.has('X-Request-ID')) result.set('X-Request-ID', crypto.randomUUID());
  return result;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export type AddTranscriptPayload = {
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
};

export type GenerateResponsePayload = {
  forceQuestion?: string;
  provider?: LlmProvider;
  model?: string;
};

export type QuestionDetection = {
  id: string;
  status: 'DETECTED' | 'NOT_FOUND';
  question: string | null;
  confidence: number | null;
  source: 'LEGACY' | 'DETERMINISTIC' | 'LLM' | 'MANUAL';
  evidence: Array<{ chunkId: string; sequence: number; excerpt: string }>;
  detectorVersion: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
};

export type SuggestedAnswerResponse = {
  id: string;
  detectedQuestion: string;
  suggestedAnswer: string;
  shortVersion: string;
  keyPoints: string[];
  strategicNote: string;
  createdAt: string;
};

export type GenerateResponseResult =
  | (SuggestedAnswerResponse & {
      status: 'ANSWER_READY';
      detection: QuestionDetection;
      answer: SuggestedAnswerResponse;
    })
  | {
      status: 'NEEDS_CONFIRMATION';
      detection: QuestionDetection;
      answer: null;
    };

export type SessionSummaryContent = {
  overview: string;
  questions: Array<{ question: string; answerSummary: string }>;
  topics: string[];
  strengths: Array<{ text: string; evidenceResponseId: string }>;
  improvements: Array<{ text: string; evidenceResponseId: string }>;
  nextSteps: string[];
};

export type SessionSummaryResponse = {
  id: string;
  sessionId: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  content: SessionSummaryContent | null;
  fallbackContent: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: buildRequestHeaders(init?.headers),
  });

  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (!response.ok) {
    const raw = await response.text();
    const parsed = parseApiError(raw);
    const retryAfterHeader = Number(response.headers.get('Retry-After'));
    const retryAfterSeconds =
      parsed.retryAfterSeconds ??
      (Number.isSafeInteger(retryAfterHeader) && retryAfterHeader >= 0
        ? retryAfterHeader
        : undefined);
    throw new ApiError(
      parsed.message,
      parsed.statusCode,
      parsed.code,
      retryAfterSeconds,
      parsed.requestId,
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  register: (body: { email: string; password: string }) =>
    request<{
      user: { id: string; email: string };
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{
      user: { id: string; email: string };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () =>
    request<{ success: true }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  me: () =>
    request<{
      id: string;
      email: string;
      createdAt: string;
      updatedAt: string;
    }>('/auth/me'),
  getLatestContext: () =>
    request<{
      id: string;
      resumeText: string;
      interviewType: string;
      jobLevel: string;
      jobDescription: string;
      companyName: string;
      companySegment: string | null;
      responsePreference: string;
      aiBehavior: string | null;
    }>('/interview/context/latest'),
  getContexts: () =>
    request<
      Array<{
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
        updatedAt: string;
        sessionsCount: number;
        latestSessionAt: string | null;
        latestSessionStatus: 'ACTIVE' | 'CLOSED' | null;
      }>
    >('/interview/contexts'),
  createContext: (body: Omit<InterviewContextInput, 'aiBehavior'> & { aiBehavior?: string }) =>
    request<{ id: string }>('/interview/context', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  startSession: (contextId: string) =>
    request<{ id: string }>('/interview/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ contextId }),
    }),
  addTranscript: (
    sessionId: string,
    payload: AddTranscriptPayload,
    idempotencyKey: string,
  ) =>
    request<{ id: string }>(`/interview/sessions/${sessionId}/transcripts`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    }),
  generateResponse: (
    sessionId: string,
    payload: GenerateResponsePayload | undefined,
    idempotencyKey: string,
  ) =>
    request<GenerateResponseResult>(`/interview/sessions/${sessionId}/generate-response`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload ?? {}),
    }),
  endSession: (sessionId: string) =>
    request<SessionSummaryResponse>(`/interview/sessions/${sessionId}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getSessionSummary: (sessionId: string) =>
    request<SessionSummaryResponse>(`/interview/sessions/${sessionId}/summary`),
  retrySessionSummary: (sessionId: string) =>
    request<SessionSummaryResponse>(`/interview/sessions/${sessionId}/summary/retry`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
