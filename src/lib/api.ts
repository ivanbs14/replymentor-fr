const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type AddTranscriptPayload = {
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
};

type GenerateResponsePayload = {
  provider?: 'gemini' | 'ollama' | 'openai';
  model?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    let parsedMessage: string | null = null;

    try {
      const parsed = JSON.parse(raw) as { message?: string | string[] };
      if (Array.isArray(parsed.message) && parsed.message.length > 0) {
        parsedMessage = parsed.message.join(' ');
      }
      if (!parsedMessage && typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
        parsedMessage = parsed.message.trim();
      }
    } catch {
      // Se não for JSON válido, usa o corpo bruto retornado pela API.
    }

    throw new Error(parsedMessage || raw || 'Erro de requisição');
  }

  return response.json() as Promise<T>;
}

export const api = {
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
  createContext: (body: Record<string, unknown>) =>
    request<{ id: string }>('/interview/context', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  startSession: (contextId: string) =>
    request<{ id: string }>('/interview/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ contextId }),
    }),
  addTranscript: (sessionId: string, payload: AddTranscriptPayload) =>
    request<{ id: string }>(`/interview/sessions/${sessionId}/transcripts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateResponse: (sessionId: string, payload?: GenerateResponsePayload) =>
    request<{
      id: string;
      detectedQuestion: string;
      suggestedAnswer: string;
      shortVersion: string;
      keyPoints: string[];
      strategicNote: string;
      createdAt: string;
    }>(`/interview/sessions/${sessionId}/generate-response`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  endSession: (sessionId: string) =>
    request<{ id: string; content: string }>(`/interview/sessions/${sessionId}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
