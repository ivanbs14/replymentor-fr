export const INTERVIEW_TYPES = [
  'Técnica (Coding/System Design)',
  'Comportamental (Soft Skills)',
  'Conversa com RH',
  'Cultural Fit',
] as const;
export const JOB_LEVELS = ['Júnior', 'Pleno', 'Sênior', 'Tech Lead'] as const;
export const RESPONSE_PREFERENCES = [
  'direta e curta',
  'equilibrada',
  'detalhada e didática',
] as const;
export const LLM_PROVIDERS = ['gemini', 'ollama', 'openai'] as const;
export const AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;
export const AUDIO_ACCEPT = AUDIO_MIME_TYPES.join(',');
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSCRIPT_CHARS = 4_000;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type InterviewContextInput = {
  resumeText: string;
  interviewType: string;
  jobLevel: string;
  jobDescription: string;
  companyName: string;
  companySegment: string;
  responsePreference: string;
  aiBehavior: string;
};

export function parseApiErrorMessage(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return 'Erro de requisição';
    const message = Reflect.get(parsed, 'message');
    return typeof message === 'string' && message.trim().length > 0
      ? message.trim()
      : 'Erro de requisição';
  } catch {
    return 'Erro de requisição';
  }
}

export function validateAudioFile(file: File): string | null {
  if (!AUDIO_MIME_TYPES.includes(file.type as (typeof AUDIO_MIME_TYPES)[number])) {
    return 'Formato de áudio não permitido. Use WebM, OGG, MP4, MP3 ou WAV.';
  }
  if (file.size > MAX_AUDIO_BYTES) return 'O áudio deve ter no máximo 8 MiB.';
  return null;
}

export function validateInterviewContext(input: InterviewContextInput): string | null {
  const checks: Array<[string, string, number, number]> = [
    ['Currículo', input.resumeText.trim(), 50, 12_000],
    ['Descrição da vaga', input.jobDescription.trim(), 20, 8_000],
    ['Nome da empresa', input.companyName.trim(), 1, 120],
    ['Contexto da empresa', input.companySegment.trim(), 0, 1_000],
    ['Comportamento da IA', input.aiBehavior.trim(), 0, 280],
  ];
  for (const [label, value, min, max] of checks) {
    if (value.length < min || value.length > max) return `${label} deve ter entre ${min} e ${max} caracteres.`;
  }
  if (!INTERVIEW_TYPES.includes(input.interviewType as (typeof INTERVIEW_TYPES)[number])) return 'Tipo de entrevista inválido.';
  if (!JOB_LEVELS.includes(input.jobLevel as (typeof JOB_LEVELS)[number])) return 'Nível da vaga inválido.';
  if (!RESPONSE_PREFERENCES.includes(input.responsePreference as (typeof RESPONSE_PREFERENCES)[number])) return 'Preferência de resposta inválida.';
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input.aiBehavior)) return 'Comportamento da IA contém caracteres inválidos.';
  return null;
}
