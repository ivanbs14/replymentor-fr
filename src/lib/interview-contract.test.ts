import { describe, expect, it } from 'vitest';
import {
  AUDIO_MIME_TYPES,
  INTERVIEW_TYPES,
  JOB_LEVELS,
  MAX_AUDIO_BYTES,
  RESPONSE_PREFERENCES,
  parseApiError,
  validateAudioFile,
  validateInterviewContext,
  type InterviewContextInput,
} from './interview-contract';

const validContext: InterviewContextInput = {
  resumeText: 'r'.repeat(50),
  interviewType: INTERVIEW_TYPES[0],
  jobLevel: JOB_LEVELS[1],
  jobDescription: 'v'.repeat(20),
  companyName: 'Empresa Exemplo',
  companySegment: '',
  responsePreference: RESPONSE_PREFERENCES[1],
  aiBehavior: '',
};

describe('parseApiError', () => {
  it('keeps only public fields and trims the message', () => {
    expect(parseApiError(JSON.stringify({
      message: '  Sessão encerrada.  ', statusCode: 409,
      code: 'SESSION_CLOSED', secret: 'private detail',
    }))).toEqual({ message: 'Sessão encerrada.', statusCode: 409, code: 'SESSION_CLOSED' });
  });

  it.each(['invalid JSON', '', 'null', '42', 'true', '"message"', '[]'])
    ('uses a safe fallback for %s', (raw) => {
      expect(parseApiError(raw)).toEqual({ message: 'Erro de requisição' });
    });

  it.each([{}, { message: '  ' }, { message: ['private validation detail'] }, {
    message: false, statusCode: '401', code: 42,
  }])('ignores missing or incorrectly typed fields: %j', (body) => {
    expect(parseApiError(JSON.stringify(body))).toEqual({ message: 'Erro de requisição' });
  });

  it('retains valid public metadata when the message is missing', () => {
    expect(parseApiError('{"statusCode":401,"code":"UNAUTHORIZED"}')).toEqual({
      message: 'Erro de requisição', statusCode: 401, code: 'UNAUTHORIZED',
    });
  });
});

describe('validateInterviewContext', () => {
  const limits = [
    ['resumeText', 'Currículo', 50, 12_000],
    ['jobDescription', 'Descrição da vaga', 20, 8_000],
    ['companyName', 'Nome da empresa', 1, 120],
    ['companySegment', 'Contexto da empresa', 0, 1_000],
    ['aiBehavior', 'Comportamento da IA', 0, 280],
  ] as const;

  it.each(limits)('accepts both boundaries for %s after trimming', (field, _label, min, max) => {
    for (const length of [min, max]) {
      expect(validateInterviewContext({ ...validContext, [field]: `  ${'x'.repeat(length)}  ` })).toBeNull();
    }
  });

  it.each(limits)('rejects oversized %s', (field, label, min, max) => {
    expect(validateInterviewContext({ ...validContext, [field]: 'x'.repeat(max + 1) }))
      .toBe(`${label} deve ter entre ${min} e ${max} caracteres.`);
  });

  it.each(limits.filter(([, , min]) => min > 0))('rejects undersized %s', (field, label, min, max) => {
    expect(validateInterviewContext({ ...validContext, [field]: ` ${'x'.repeat(min - 1)} ` }))
      .toBe(`${label} deve ter entre ${min} e ${max} caracteres.`);
  });

  it.each([
    ['interviewType', INTERVIEW_TYPES, 'Tipo de entrevista inválido.'],
    ['jobLevel', JOB_LEVELS, 'Nível da vaga inválido.'],
    ['responsePreference', RESPONSE_PREFERENCES, 'Preferência de resposta inválida.'],
  ] as const)('accepts the supported values and rejects unknown %s', (field, values, error) => {
    for (const value of values) {
      expect(validateInterviewContext({ ...validContext, [field]: value })).toBeNull();
    }
    expect(validateInterviewContext({ ...validContext, [field]: 'unsupported' })).toBe(error);
  });

  it.each(['\u0000', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f', '\u007f'])
    ('rejects control characters in AI behavior (%j)', (character) => {
      expect(validateInterviewContext({ ...validContext, aiBehavior: `Explique${character}bem` }))
        .toBe('Comportamento da IA contém caracteres inválidos.');
    });

  it('accepts tabs and line breaks in AI behavior', () => {
    expect(validateInterviewContext({ ...validContext, aiBehavior: 'Explique\tcom clareza.\nUse exemplos.\r\n' })).toBeNull();
  });
});

describe('validateAudioFile', () => {
  it.each(AUDIO_MIME_TYPES)('accepts supported MIME type %s', (type) => {
    expect(validateAudioFile(new File(['audio'], 'recording', { type }))).toBeNull();
  });

  it.each(['', 'text/plain', 'video/webm', 'audio/aac'])('rejects unsupported MIME type %s', (type) => {
    expect(validateAudioFile(new File(['audio'], 'recording.mp3', { type })))
      .toBe('Formato de áudio não permitido. Use WebM, OGG, MP4, MP3 ou WAV.');
  });

  it('accepts exactly 8 MiB and rejects one byte over the limit', () => {
    const eightMiB = 8 * 1024 * 1024;
    expect(MAX_AUDIO_BYTES).toBe(eightMiB);
    expect(validateAudioFile(new File([new Uint8Array(eightMiB)], 'recording.webm', { type: 'audio/webm' }))).toBeNull();
    expect(validateAudioFile(new File([new Uint8Array(eightMiB + 1)], 'recording.webm', { type: 'audio/webm' })))
      .toBe('O áudio deve ter no máximo 8 MiB.');
  });
});
