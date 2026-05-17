import { create } from 'zustand';

export type ResponseCard = {
  id: string;
  detectedQuestion: string;
  suggestedAnswer: string;
  shortVersion: string;
  keyPoints: string[];
  strategicNote: string;
  createdAt: string;
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
  latestResponse: ResponseCard | null;
  history: ResponseCard[];
  summary: string | null;
  setAuthUser: (authUser: InterviewState['authUser']) => void;
  resetInterviewState: () => void;
  setContextField: (key: string, value: string) => void;
  setContextForm: (form: InterviewState['contextForm']) => void;
  setContextId: (contextId: string | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setSessionStatus: (status: InterviewState['sessionStatus']) => void;
  setTranscriptInput: (value: string) => void;
  pushResponse: (response: ResponseCard) => void;
  selectResponse: (responseId: string) => void;
  setSummary: (summary: string) => void;
};

export const useInterviewStore = create<InterviewState>((set) => ({
  authUser: null,
  contextForm: {
    resumeText: '',
    interviewType: 'Técnica',
    jobLevel: 'Pleno',
    jobDescription: '',
    companyName: '',
    companySegment: '',
    responsePreference: 'equilibrada',
    aiBehavior: '',
  },
  contextId: null,
  sessionId: null,
  sessionStatus: 'idle',
  transcriptInput: '',
  latestResponse: null,
  history: [],
  summary: null,
  setAuthUser: (authUser) => set({ authUser }),
  resetInterviewState: () =>
    set({
      contextForm: {
        resumeText: '',
        interviewType: 'Técnica',
        jobLevel: 'Pleno',
        jobDescription: '',
        companyName: '',
        companySegment: '',
        responsePreference: 'equilibrada',
        aiBehavior: '',
      },
      contextId: null,
      sessionId: null,
      sessionStatus: 'idle',
      transcriptInput: '',
      latestResponse: null,
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
  pushResponse: (response) =>
    set((state) => ({
      latestResponse: response,
      history: [response, ...state.history].slice(0, 20),
    })),
  selectResponse: (responseId) =>
    set((state) => ({
      latestResponse:
        state.history.find((item) => item.id === responseId) ?? state.latestResponse,
    })),
  setSummary: (summary) => set({ summary }),
}));
