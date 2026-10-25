import { create } from 'zustand';
import { INTERVIEW_TYPES, RESPONSE_PREFERENCES } from './interview-contract';
import type { QuestionDetection, SessionSummaryResponse, SuggestedAnswerResponse } from './api';

export type HistoryItem = {
  detection: QuestionDetection;
  answer: SuggestedAnswerResponse;
};

export type CurrentCycle =
  | { status: 'idle' }
  | { status: 'processing' }
  | { status: 'needs-confirmation'; detection: QuestionDetection }
  | {
      status: 'answer-ready';
      detection: QuestionDetection;
      answer: SuggestedAnswerResponse;
    };

type InterviewState = {
  authUser: { id: string; email: string } | null;
  contextForm: {
    resumeText: string;
    interviewType: string;
    jobLevel: string;
    jobDescription: string;
    companyName: string;
    companySegment: string;
    responsePreference: string;
    aiBehavior: string;
  };
  contextId: string | null;
  sessionId: string | null;
  sessionStatus: 'idle' | 'listening' | 'processing' | 'ready' | 'closed';
  transcriptInput: string;
  currentCycle: CurrentCycle;
  history: HistoryItem[];
  summary: SessionSummaryResponse | null;
  setAuthUser: (authUser: InterviewState['authUser']) => void;
  resetInterviewState: () => void;
  setContextField: (key: string, value: string) => void;
  setContextForm: (form: InterviewState['contextForm']) => void;
  setContextId: (contextId: string | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setSessionStatus: (status: InterviewState['sessionStatus']) => void;
  setTranscriptInput: (value: string) => void;
  setCycleProcessing: () => void;
  setNeedsConfirmation: (detection: QuestionDetection) => void;
  pushAnswer: (detection: QuestionDetection, answer: SuggestedAnswerResponse) => void;
  clearCurrentCycle: () => void;
  selectResponse: (answerId: string) => void;
  setSummary: (summary: SessionSummaryResponse) => void;
};

export const useInterviewStore = create<InterviewState>((set) => ({
  authUser: null,
  contextForm: {
    resumeText: '',
    interviewType: INTERVIEW_TYPES[0],
    jobLevel: 'Pleno',
    jobDescription: '',
    companyName: '',
    companySegment: '',
    responsePreference: RESPONSE_PREFERENCES[1],
    aiBehavior: '',
  },
  contextId: null,
  sessionId: null,
  sessionStatus: 'idle',
  transcriptInput: '',
  currentCycle: { status: 'idle' },
  history: [],
  summary: null,
  setAuthUser: (authUser) => set({ authUser }),
  resetInterviewState: () =>
    set({
      contextForm: {
        resumeText: '',
        interviewType: INTERVIEW_TYPES[0],
        jobLevel: 'Pleno',
        jobDescription: '',
        companyName: '',
        companySegment: '',
        responsePreference: RESPONSE_PREFERENCES[1],
        aiBehavior: '',
      },
      contextId: null,
      sessionId: null,
      sessionStatus: 'idle',
      transcriptInput: '',
      currentCycle: { status: 'idle' },
      history: [],
      summary: null,
    }),
  setContextField: (key, value) =>
    set((state) => ({
      contextForm: { ...state.contextForm, [key]: value },
    })),
  setContextForm: (contextForm) => set({ contextForm }),
  setContextId: (contextId) => set({ contextId }),
  setSessionId: (sessionId) => set({ sessionId }),
  setSessionStatus: (sessionStatus) => set({ sessionStatus }),
  setTranscriptInput: (transcriptInput) => set({ transcriptInput }),
  setCycleProcessing: () => set({ currentCycle: { status: 'processing' } }),
  setNeedsConfirmation: (detection) =>
    set({ currentCycle: { status: 'needs-confirmation', detection } }),
  pushAnswer: (detection, answer) =>
    set((state) => ({
      currentCycle: { status: 'answer-ready', detection, answer },
      history: [{ detection, answer }, ...state.history].slice(0, 20),
    })),
  clearCurrentCycle: () => set({ currentCycle: { status: 'idle' } }),
  selectResponse: (answerId) =>
    set((state) => {
      const item = state.history.find(({ answer }) => answer.id === answerId);
      return item
        ? { currentCycle: { status: 'answer-ready', ...item } }
        : { currentCycle: state.currentCycle };
    }),
  setSummary: (summary) => set({ summary }),
}));
