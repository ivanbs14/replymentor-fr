'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  setUnauthorizedHandler,
  type AddTranscriptPayload,
  type GenerateResponsePayload,
  type QuestionDetection,
} from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SessionSummary } from '@/components/session-summary';
import { useInterviewStore } from '@/lib/interview-store';
import {
  AUDIO_ACCEPT,
  ApiError,
  MAX_TRANSCRIPT_CHARS,
  type LlmProvider,
  validateAudioFile,
} from '@/lib/interview-contract';

const SELECTED_CONTEXT_STORAGE_KEY = 'replymentor_selected_context_id';

type AutomaticGenerateOperation = {
  epoch: number;
  sessionId: string;
  transcriptPayload: AddTranscriptPayload;
  transcriptKey: string;
  generationPayload: GenerateResponsePayload;
  generationKey: string;
};

type ManualGenerateOperation = {
  epoch: number;
  sessionId: string;
  payload: GenerateResponsePayload & { forceQuestion: string };
  generationKey: string;
};

const detectionSourceLabel = {
  DETERMINISTIC: 'Automática',
  LLM: 'Automática',
  MANUAL: 'Manual',
  LEGACY: 'Legada',
} satisfies Record<QuestionDetection['source'], string>;

function DetectionMetadata({ detection }: { detection: QuestionDetection }) {
  const isAutomatic = detection.source === 'DETERMINISTIC' || detection.source === 'LLM';
  const isLowConfidence = isAutomatic && detection.confidence !== null && detection.confidence < 0.75;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Metadados da detecção">
      <span className="rounded-full bg-[#e6eeff] px-3 py-1 text-xs font-semibold text-[#004ac6]">
        {detectionSourceLabel[detection.source]}
      </span>
      {detection.confidence !== null ? (
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-[#434655]">
          {Math.round(detection.confidence * 100)}%
        </span>
      ) : null}
      {isLowConfidence ? (
        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">warning</span>
          Confiança baixa
        </span>
      ) : null}
    </div>
  );
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    idle: 'Pronto para iniciar',
    listening: 'Escutando reunião...',
    processing: 'Gerando resposta...',
    ready: 'Pronto para próxima pergunta',
    closed: 'Sessão encerrada',
  };
  return map[status] ?? status;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export default function Home() {
  const {
    authUser,
    contextId,
    sessionId,
    sessionStatus,
    transcriptInput,
    currentCycle,
    history,
    summary,
    setAuthUser,
    resetInterviewState,
    setContextId,
    setSessionId,
    setSessionStatus,
    setTranscriptInput,
    setCycleProcessing,
    setNeedsConfirmation,
    pushAnswer,
    clearCurrentCycle,
    selectResponse,
    setSummary,
  } = useInterviewStore();
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureRequestEpochRef = useRef(0);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingResolverRef = useRef<{
    recorder: MediaRecorder;
    resolve: (file: File | null) => void;
  } | null>(null);
  const recordingStopPromiseRef = useRef<Promise<File | null> | null>(null);
  const canceledRecordersRef = useRef(new WeakSet<MediaRecorder>());
  const restartCaptureRef = useRef<() => void>(() => undefined);
  const openingCorrectionRef = useRef(false);
  const pendingAutomaticOperationRef = useRef<AutomaticGenerateOperation | null>(null);
  const pendingManualOperationRef = useRef<ManualGenerateOperation | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const responseHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousCycleStatusRef = useRef(currentCycle.status);
  const operationEpochRef = useRef(0);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isOpeningCorrection, setIsOpeningCorrection] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LlmProvider>('ollama');
  const [selectedModel, setSelectedModel] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [questionInput, setQuestionInput] = useState(
    currentCycle.status === 'needs-confirmation' ? currentCycle.detection.question ?? '' : '',
  );

  useEffect(() => {
    const previousStatus = previousCycleStatusRef.current;
    previousCycleStatusRef.current = currentCycle.status;

    if (currentCycle.status === 'needs-confirmation') {
      questionInputRef.current?.focus();
      return;
    }
    if (currentCycle.status === 'answer-ready' && previousStatus === 'needs-confirmation') {
      responseHeadingRef.current?.focus();
    }
  }, [currentCycle]);

  const clearPendingOperations = () => {
    operationEpochRef.current += 1;
    pendingAutomaticOperationRef.current = null;
    pendingManualOperationRef.current = null;
  };

  const isCurrentOperation = (operation: { epoch: number; sessionId: string }) =>
    operation.epoch === operationEpochRef.current &&
    useInterviewStore.getState().sessionId === operation.sessionId;

  const cancelCapture = useCallback((): Promise<File | null> => {
    captureRequestEpochRef.current += 1;
    recordedChunksRef.current = [];
    setAudioFile(null);
    setRecordingError(null);
    if (audioInputRef.current) audioInputRef.current.value = '';
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      canceledRecordersRef.current.add(recorder);
      if (recordingStopPromiseRef.current) return recordingStopPromiseRef.current;
      if (recorder.state !== 'inactive') {
        const stopPromise = new Promise<File | null>((resolve) => {
          recordingResolverRef.current = { recorder, resolve };
          recorder.stop();
        });
        recordingStopPromiseRef.current = stopPromise;
        void stopPromise.finally(() => {
          if (recordingStopPromiseRef.current === stopPromise) {
            recordingStopPromiseRef.current = null;
          }
        });
        return stopPromise;
      }
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    return Promise.resolve(null);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem('replymentor_token');
      localStorage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
      setAuthUser(null);
      clearPendingOperations();
      cancelCapture();
      resetInterviewState();
    };

    setUnauthorizedHandler(handleUnauthorized);

    localStorage.removeItem('replymentor_token');

    api
      .me()
      .then((user) => {
        setAuthUser({ id: user.id, email: user.email });
      })
      .catch(() => {
        handleUnauthorized();
      });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [cancelCapture, resetInterviewState, setAuthUser]);

  useEffect(() => {
    if (!authUser) return;

    const selectedContextId = localStorage.getItem(SELECTED_CONTEXT_STORAGE_KEY);
    if (!selectedContextId) {
      setContextId(null);
      return;
    }

    if (selectedContextId === contextId) return;
    setContextId(selectedContextId);
  }, [authUser, contextId, setContextId]);

  const loginMutation = useMutation({
    mutationFn: () =>
      api.login({
        email: authEmail.trim().toLowerCase(),
        password: authPassword,
      }),
    onSuccess: (data) => {
      localStorage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
      clearPendingOperations();
      setAuthUser(data.user);
      setAuthPassword('');
      resetInterviewState();
    },
  });

  const registerMutation = useMutation({
    mutationFn: () =>
      api.register({
        email: authEmail.trim().toLowerCase(),
        password: authPassword,
      }),
    onSuccess: (data) => {
      localStorage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
      clearPendingOperations();
      setAuthUser(data.user);
      setAuthPassword('');
      resetInterviewState();
    },
  });

  const startSessionMutation = useMutation({
    mutationFn: async (operation: { contextId: string; epoch: number }) => {
      return api.startSession(operation.contextId);
    },
    onSuccess: (data, operation) => {
      if (operation.epoch !== operationEpochRef.current || !useInterviewStore.getState().authUser) {
        return;
      }
      clearPendingOperations();
      clearCurrentCycle();
      setSessionId(data.id);
      setSessionStatus('listening');
      void handleStartRecording();
    },
  });

  const handleClosedSession = () => {
    clearPendingOperations();
    clearCurrentCycle();
    cancelCapture();
    setSessionId(null);
    setSessionStatus('closed');
  };

  const handleGenerationSuccess = async (
    data: Awaited<ReturnType<typeof api.generateResponse>>,
    operation: AutomaticGenerateOperation | ManualGenerateOperation,
    operationType: 'automatic' | 'manual',
  ) => {
    if (!isCurrentOperation(operation)) return;
    if (operationType === 'automatic') pendingAutomaticOperationRef.current = null;
    else pendingManualOperationRef.current = null;

    if (data.status === 'NEEDS_CONFIRMATION') {
      await stopRecordingAndWait();
      if (!isCurrentOperation(operation)) return;
      manualGenerateMutation.reset();
      setNeedsConfirmation(data.detection);
      setQuestionInput(data.detection.question ?? '');
      setSessionStatus('ready');
      return;
    }

    pushAnswer(data.detection, data.answer);
    setQuestionInput('');
    setTranscriptInput('');
    setAudioFile(null);
    if (audioInputRef.current) audioInputRef.current.value = '';
    setSessionStatus('listening');
    void handleStartRecording();
  };

  const automaticGenerateMutation = useMutation({
    mutationFn: async ({
      sessionId: operationSessionId,
      transcriptPayload,
      transcriptKey,
      generationPayload,
      generationKey,
    }: AutomaticGenerateOperation) => {
      setSessionStatus('processing');
      setCycleProcessing();
      await api.addTranscript(
        operationSessionId,
        transcriptPayload,
        transcriptKey,
      );
      return api.generateResponse(
        operationSessionId,
        generationPayload,
        generationKey,
      );
    },
    onSuccess: (data, operation) => void handleGenerationSuccess(data, operation, 'automatic'),
    onError: (error, operation) => {
      if (!isCurrentOperation(operation)) return;
      if (error instanceof ApiError && error.code === 'SESSION_CLOSED') {
        handleClosedSession();
        return;
      }
      setSessionStatus('listening');
      const latestHistoryItem = useInterviewStore.getState().history[0];
      if (latestHistoryItem) selectResponse(latestHistoryItem.answer.id);
      else clearCurrentCycle();
    },
  });

  const manualGenerateMutation = useMutation({
    mutationFn: ({ sessionId: operationSessionId, payload, generationKey }: ManualGenerateOperation) => {
      setSessionStatus('processing');
      return api.generateResponse(operationSessionId, payload, generationKey);
    },
    onSuccess: (data, operation) => void handleGenerationSuccess(data, operation, 'manual'),
    onError: (error, operation) => {
      if (!isCurrentOperation(operation)) return;
      if (error instanceof ApiError && error.code === 'SESSION_CLOSED') {
        handleClosedSession();
        return;
      }
      setSessionStatus('ready');
    },
  });

  const endSessionMutation = useMutation({
    mutationFn: async (operation: {
      sessionId: string;
      epoch: number;
      captureFinalization: Promise<File | null>;
    }) => {
      return api.endSession(operation.sessionId);
    },
    onSuccess: (data, operation) => {
      if (!isCurrentOperation(operation)) return;
      clearPendingOperations();
      clearCurrentCycle();
      cancelCapture();
      setSummary(data);
      setSessionId(null);
      setSessionStatus('closed');
    },
    onError: async (_error, operation) => {
      if (!isCurrentOperation(operation)) return;
      await operation.captureFinalization;
      if (!isCurrentOperation(operation)) return;
      setSessionStatus('listening');
      restartCaptureRef.current();
    },
  });

  const summaryQuery = useQuery({
    queryKey: ['session-summary', summary?.sessionId],
    queryFn: () => api.getSessionSummary(summary!.sessionId),
    enabled: summary?.status === 'PENDING',
    refetchInterval: (query) => query.state.data?.status === 'PENDING' ? 1_500 : false,
  });

  useEffect(() => {
    if (summaryQuery.data) setSummary(summaryQuery.data);
  }, [setSummary, summaryQuery.data]);

  const retrySummaryMutation = useMutation({
    mutationFn: (closedSessionId: string) => api.retrySessionSummary(closedSessionId),
    onSuccess: setSummary,
  });

  const mutationError =
    loginMutation.error ||
    registerMutation.error ||
    startSessionMutation.error ||
    automaticGenerateMutation.error ||
    manualGenerateMutation.error ||
    endSessionMutation.error;
  const mutationErrorMessage =
    mutationError instanceof Error ? mutationError.message : 'Erro inesperado na requisição.';
  const normalizedMutationError = mutationErrorMessage.toLowerCase();
  const isOllamaTimeoutError =
    normalizedMutationError.includes('ollama') &&
    (normalizedMutationError.includes('tempo limite') ||
      normalizedMutationError.includes('timeout'));
  const displayedErrorMessage = isOllamaTimeoutError
    ? 'Timeout ao chamar Ollama (90000ms).'
    : mutationErrorMessage;
  const manualMutationErrorMessage =
    manualGenerateMutation.error instanceof Error
      ? manualGenerateMutation.error.message
      : manualGenerateMutation.error
        ? 'Erro inesperado na requisição.'
        : null;

  const isLoading =
    loginMutation.isPending ||
    registerMutation.isPending ||
    startSessionMutation.isPending ||
    automaticGenerateMutation.isPending ||
    manualGenerateMutation.isPending ||
    endSessionMutation.isPending;

  const handleAuthSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (authMode === 'login') {
      loginMutation.mutate();
      return;
    }
    registerMutation.mutate();
  };

  const handleLogout = async () => {
    const captureFinalization = cancelCapture();
    try {
      await api.logout();
      localStorage.removeItem('replymentor_token');
      localStorage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
      setAuthUser(null);
      clearPendingOperations();
      resetInterviewState();
    } catch {
      if (useInterviewStore.getState().authUser && useInterviewStore.getState().sessionId) {
        await captureFinalization;
        setSessionStatus('listening');
        restartCaptureRef.current();
      }
      window.alert(
        'Não foi possível encerrar a sessão. Tente novamente antes de sair.',
      );
    }
  };

  const handleAudioSelection = (event: ChangeEvent<HTMLInputElement>) => {
    pendingAutomaticOperationRef.current = null;
    const selectedFile = event.target.files?.[0] ?? null;
    if (selectedFile) {
      const error = validateAudioFile(selectedFile);
      if (error) {
        setAudioFile(null);
        setRecordingError(error);
        event.target.value = '';
        return;
      }
    }
    setAudioFile(selectedFile);
    setRecordingError(null);
  };

  const handleStartRecording = async () => {
    if (isRecording || recordingStopPromiseRef.current) return;
    const captureRequestEpoch = ++captureRequestEpochRef.current;
    pendingAutomaticOperationRef.current = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError('Seu navegador não suporta captura de áudio por microfone.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (
        captureRequestEpoch !== captureRequestEpochRef.current ||
        useInterviewStore.getState().currentCycle.status === 'needs-confirmation'
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      setRecordingError(null);

      const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined;

      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (canceledRecordersRef.current.has(recorder)) {
          canceledRecordersRef.current.delete(recorder);
          stream.getTracks().forEach((track) => track.stop());
          if (mediaRecorderRef.current === recorder) {
            setIsRecording(false);
            mediaStreamRef.current = null;
            mediaRecorderRef.current = null;
          }
          if (recordingResolverRef.current?.recorder === recorder) {
            recordingResolverRef.current.resolve(null);
            recordingResolverRef.current = null;
          }
          return;
        }
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size === 0) {
          setRecordingError('Áudio vazio. Grave novamente por alguns segundos.');
          stream.getTracks().forEach((track) => track.stop());
          if (mediaRecorderRef.current === recorder) {
            setIsRecording(false);
            mediaStreamRef.current = null;
            mediaRecorderRef.current = null;
          }
          if (recordingResolverRef.current?.recorder === recorder) {
            recordingResolverRef.current.resolve(null);
            recordingResolverRef.current = null;
          }
          return;
        }

        const extension = blob.type.includes('ogg') ? 'ogg' : 'webm';
        const capturedFile = new File([blob], `captura-${Date.now()}.${extension}`, {
          type: blob.type || 'audio/webm',
        });

        const audioError = validateAudioFile(capturedFile);
        if (audioError) {
          setRecordingError(audioError);
          stream.getTracks().forEach((track) => track.stop());
          if (mediaRecorderRef.current === recorder) {
            setIsRecording(false);
            mediaStreamRef.current = null;
            mediaRecorderRef.current = null;
          }
          if (recordingResolverRef.current?.recorder === recorder) {
            recordingResolverRef.current.resolve(null);
            recordingResolverRef.current = null;
          }
          return;
        }

        pendingAutomaticOperationRef.current = null;
        setAudioFile(capturedFile);
        if (mediaRecorderRef.current === recorder) setIsRecording(false);

        if (audioInputRef.current) {
          audioInputRef.current.value = '';
        }

        stream.getTracks().forEach((track) => track.stop());
        if (mediaRecorderRef.current === recorder) {
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
        }
        if (recordingResolverRef.current?.recorder === recorder) {
          recordingResolverRef.current.resolve(capturedFile);
          recordingResolverRef.current = null;
        }
      };

      recorder.onerror = () => {
        setRecordingError('Falha ao gravar áudio. Tente novamente.');
        stream.getTracks().forEach((track) => track.stop());
        if (mediaRecorderRef.current === recorder) {
          setIsRecording(false);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
        }
        if (recordingResolverRef.current?.recorder === recorder) {
          recordingResolverRef.current.resolve(null);
          recordingResolverRef.current = null;
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      if (captureRequestEpoch === captureRequestEpochRef.current) {
        setRecordingError('Permissão de microfone negada ou indisponível.');
        setIsRecording(false);
      }
    }
  };

  useEffect(() => {
    restartCaptureRef.current = () => void handleStartRecording();
    return () => {
      restartCaptureRef.current = () => undefined;
    };
  });

  const stopRecordingAndWait = async (): Promise<File | null> => {
    captureRequestEpochRef.current += 1;
    if (recordingStopPromiseRef.current) return recordingStopPromiseRef.current;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return audioFile;
    }

    const stopPromise = new Promise<File | null>((resolve) => {
      recordingResolverRef.current = {
        recorder,
        resolve: (file) => resolve(file),
      };
      recorder.stop();
    });
    recordingStopPromiseRef.current = stopPromise;
    try {
      return await stopPromise;
    } finally {
      if (recordingStopPromiseRef.current === stopPromise) {
        recordingStopPromiseRef.current = null;
      }
    }
  };

  const handleGenerateResponse = async () => {
    if (pendingAutomaticOperationRef.current) {
      automaticGenerateMutation.mutate(pendingAutomaticOperationRef.current);
      return;
    }
    if (!sessionId) {
      setRecordingError('Inicie a sessão antes de gerar resposta.');
      return;
    }

    let capturedAudioFile = audioFile;
    if (isRecording) {
      capturedAudioFile = await stopRecordingAndWait();
    }
    const manualTranscript = transcriptInput.trim();
    if (!manualTranscript && !capturedAudioFile) {
      setRecordingError(
        'Adicione um transcript manual ou selecione um áudio para análise.',
      );
      return;
    }

    let transcriptPayload: AddTranscriptPayload;
    if (manualTranscript) {
      transcriptPayload = { transcript: manualTranscript };
    } else {
      const selectedAudio = capturedAudioFile!;
      const audioError = validateAudioFile(selectedAudio);
      if (audioError) {
        setRecordingError(audioError);
        return;
      }
      transcriptPayload = {
        audioBase64: await fileToBase64(selectedAudio),
        mimeType: selectedAudio.type || 'audio/webm',
      };
    }

    const operation: AutomaticGenerateOperation = {
      epoch: operationEpochRef.current,
      sessionId,
      transcriptPayload,
      transcriptKey: crypto.randomUUID(),
      generationPayload: {
        provider: selectedProvider,
        model: selectedModel.trim() || undefined,
      },
      generationKey: crypto.randomUUID(),
    };
    pendingAutomaticOperationRef.current = operation;
    automaticGenerateMutation.mutate(operation);
  };

  const handleManualGenerate = (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId) return;
    if (pendingManualOperationRef.current) {
      manualGenerateMutation.mutate(pendingManualOperationRef.current);
      return;
    }
    const forceQuestion = questionInput.trim();
    if (!forceQuestion) return;
    const operation: ManualGenerateOperation = {
      epoch: operationEpochRef.current,
      sessionId,
      payload: {
        forceQuestion,
        provider: selectedProvider,
        model: selectedModel.trim() || undefined,
      },
      generationKey: crypto.randomUUID(),
    };
    pendingManualOperationRef.current = operation;
    manualGenerateMutation.mutate(operation);
  };

  const handleIgnoreConfirmation = () => {
    pendingManualOperationRef.current = null;
    manualGenerateMutation.reset();
    clearCurrentCycle();
    setQuestionInput('');
    setSessionStatus('listening');
    void handleStartRecording();
  };

  const handleCorrectQuestion = async () => {
    if (currentCycle.status !== 'answer-ready' || openingCorrectionRef.current) return;
    openingCorrectionRef.current = true;
    setIsOpeningCorrection(true);
    try {
      const captureFinalization = stopRecordingAndWait();
      const correctionCaptureEpoch = captureRequestEpochRef.current;
      await captureFinalization;
      if (correctionCaptureEpoch !== captureRequestEpochRef.current) return;
      if (useInterviewStore.getState().currentCycle.status !== 'answer-ready') return;
      setQuestionInput(currentCycle.detection.question ?? currentCycle.answer.detectedQuestion);
      setSessionStatus('ready');
      setNeedsConfirmation(currentCycle.detection);
    } finally {
      openingCorrectionRef.current = false;
      setIsOpeningCorrection(false);
    }
  };

  useEffect(() => {
    if (!manualGenerateMutation.error) return;
    retryButtonRef.current?.focus();
  }, [manualGenerateMutation.error]);

  const handleStopRecording = () => {
    void stopRecordingAndWait();
  };

  useEffect(() => {
    return () => {
      captureRequestEpochRef.current += 1;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const providerLabelMap: Record<LlmProvider, string> = {
    gemini: 'Gemini',
    ollama: 'Ollama',
    openai: 'OpenAI',
  };
  const currentAnswer = currentCycle.status === 'answer-ready' ? currentCycle.answer : null;
  const currentDetection =
    currentCycle.status === 'answer-ready' || currentCycle.status === 'needs-confirmation'
      ? currentCycle.detection
      : null;
  const confirmationInstruction =
    currentCycle.status === 'needs-confirmation' && currentCycle.detection.status === 'NOT_FOUND'
      ? 'Não identificamos uma pergunta clara no trecho mais recente. Informe a pergunta do entrevistador para continuar.'
      : 'Não conseguimos confirmar a pergunta com segurança. Revise a pergunta abaixo antes de gerar a resposta.';
  const liveStatus = manualGenerateMutation.isPending
    ? 'Gerando resposta corrigida.'
    : manualMutationErrorMessage
      ? `Erro ao gerar resposta: ${manualMutationErrorMessage}`
      : currentCycle.status === 'needs-confirmation'
        ? confirmationInstruction
        : currentCycle.status === 'answer-ready'
          ? 'Resposta gerada com sucesso.'
          : '';

  if (!authUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f9ff] px-6 py-10">
        <div className="w-full max-w-md rounded-2xl border border-[#c3c6d7] bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-[#004ac6]">ReplyMentor</h1>
          <p className="mt-2 text-sm text-[#434655]">
            Faça login para acessar seu workspace de entrevista.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleAuthSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#0d1c2e]">E-mail</label>
              <input
                type="email"
                required
                minLength={3}
                maxLength={254}
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                className="h-11 w-full rounded-xl border border-[#c3c6d7] px-3 text-sm outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#0d1c2e]">Senha</label>
              <input
                type="password"
                required
                minLength={8}
                maxLength={128}
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                className="h-11 w-full rounded-xl border border-[#c3c6d7] px-3 text-sm outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="h-11 w-full rounded-xl bg-[#004ac6] text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            >
              {authMode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))}
            className="mt-4 text-sm font-medium text-[#004ac6] hover:underline"
          >
            {authMode === 'login'
              ? 'Não tem conta? Criar agora'
              : 'Já tem conta? Fazer login'}
          </button>

          {mutationError ? (
            <Alert className="mt-4" variant="destructive">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <AlertTitle>Erro de autenticação</AlertTitle>
              <AlertDescription>{displayedErrorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0d1c2e]">
      {contextId ? (
        <header className="sticky top-0 z-50 border-b border-[#c3c6d7] bg-white/95 shadow-sm">
          <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <span
                className="material-symbols-outlined text-[28px] text-[#004ac6]"
                style={{ fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24" }}
              >
                psychology
              </span>
              <span className="text-xl font-bold text-[#004ac6]">ReplyMentor</span>
              <div className="h-6 w-px bg-[#c3c6d7]" />
              <div className="flex items-center gap-2 rounded-full bg-[#eff4ff] px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-[#434655]">{statusLabel(sessionStatus)}</span>
              </div>
            </div>
            <nav className="hidden items-center gap-8 md:flex">
              <span className="border-b-2 border-[#004ac6] pb-1 text-sm font-semibold text-[#004ac6]">
                Dashboard
              </span>
              <Link href="/contexts" className="text-sm text-[#434655] hover:text-[#004ac6]">
                Contextos
              </Link>
            </nav>
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-[#434655] md:inline">{authUser.email}</span>
              <Link
                href="/contexts"
                className="rounded-lg border border-[#c3c6d7] px-3 py-1 text-sm font-medium text-[#434655] hover:bg-[#eff4ff]"
              >
                Contextos
              </Link>
              <button
                type="button"
                className="rounded-full p-2 text-[#434655] transition hover:bg-[#eff4ff]"
                aria-label="Notificações"
              >
                <span className="material-symbols-outlined">notifications</span>
              </button>
              <button
                type="button"
                className="rounded-full p-2 text-[#434655] transition hover:bg-[#eff4ff]"
                aria-label="Configurações"
              >
                <span className="material-symbols-outlined">settings</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg border border-[#c3c6d7] px-3 py-1 text-sm font-medium text-[#434655] hover:bg-[#eff4ff]"
              >
                Sair
              </button>
            </div>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-50 border-b border-[#c3c6d7] bg-white/95 shadow-sm">
          <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6">
            <div className="flex items-center gap-2">
              <span
                className="material-symbols-outlined text-[28px] text-[#004ac6]"
                style={{ fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24" }}
              >
                psychology
              </span>
              <h1 className="text-2xl font-bold text-[#004ac6]">ReplyMentor</h1>
            </div>
            <nav className="hidden items-center gap-8 md:flex">
              <span className="border-b-2 border-[#004ac6] pb-1 text-sm font-semibold text-[#004ac6]">
                Dashboard
              </span>
              <Link href="/contexts" className="text-sm text-[#434655] hover:text-[#004ac6]">
                Contextos
              </Link>
            </nav>
            <div className="flex items-center gap-3">
              <Link
                href="/contexts"
                className="rounded-lg border border-[#c3c6d7] px-3 py-1 text-sm font-medium text-[#434655] hover:bg-[#eff4ff]"
              >
                Contextos
              </Link>
              <span className="hidden text-sm text-[#434655] md:inline">{authUser.email}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg border border-[#c3c6d7] px-3 py-1 text-sm font-medium text-[#434655] hover:bg-[#eff4ff]"
              >
                Sair
              </button>
            </div>
          </div>
        </header>
      )}

      {!contextId ? (
        <main className="mx-auto grid w-full max-w-[1280px] grid-cols-12 gap-6 px-6 py-6">
          <aside className="col-span-12 space-y-3 md:col-span-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-[24px] font-semibold">Sessão em andamento</h2>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  type="button"
                  disabled
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#004ac6] font-semibold text-white opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">play_circle</span>
                  Iniciar escuta
                </button>
              </div>
              <div className="mt-4 rounded-xl bg-[#eff4ff] p-4">
                <p className="text-sm text-[#434655]">
                  Crie ou selecione um contexto para liberar a escuta da sessão.
                </p>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href="/contexts/new"
                  className="flex h-11 items-center justify-center rounded-xl bg-[#004ac6] text-sm font-semibold text-white hover:opacity-95"
                >
                  Criar novo contexto
                </Link>
                <Link
                  href="/contexts"
                  className="flex h-11 items-center justify-center rounded-xl border border-[#c3c6d7] bg-white text-sm font-semibold text-[#434655] hover:bg-[#eff4ff]"
                >
                  Selecionar contexto existente
                </Link>
              </div>
            </div>
          </aside>
          <section className="col-span-12 md:col-span-9">
            <div className="rounded-2xl border border-[#c3c6d7] bg-white p-8">
              <h2 className="text-[24px] font-semibold">Dashboard</h2>
              <p className="mt-2 text-sm text-[#434655]">
                Você está no dashboard. Para começar uma sessão, primeiro crie ou selecione um
                contexto.
              </p>
            </div>
          </section>
        </main>
      ) : (
        <main className="mx-auto grid w-full max-w-[1280px] grid-cols-12 gap-6 px-6 py-6">
          <div role="status" aria-live="polite" className="sr-only">
            {liveStatus}
          </div>
          <aside className="col-span-12 space-y-3 md:col-span-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-[24px] font-semibold">Sessão em andamento</h2>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!contextId) return;
                    startSessionMutation.mutate({ contextId, epoch: operationEpochRef.current });
                  }}
                  disabled={Boolean(sessionId) || startSessionMutation.isPending}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#004ac6] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">play_circle</span>
                  Iniciar escuta
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateResponse()}
                  disabled={!sessionId || isLoading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#4b41e1] font-semibold text-white shadow-lg shadow-[#4b41e1]/20 hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">psychology</span>
                  Gerar resposta
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateResponse()}
                  disabled={!sessionId || isLoading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#004ac6]/20 bg-white font-semibold text-[#004ac6] hover:bg-[#eff4ff] disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">refresh</span>
                  Refinar resposta
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!sessionId) return;
                    const captureFinalization = cancelCapture();
                    endSessionMutation.mutate({
                      sessionId,
                      epoch: operationEpochRef.current,
                      captureFinalization,
                    });
                  }}
                  disabled={!sessionId || sessionStatus === 'closed' || isLoading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#ba1a1a] bg-white font-semibold text-[#ba1a1a] hover:bg-[#ffdad6]/40 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">stop_circle</span>
                  Encerrar sessão
                </button>
              </div>
              <div className="mt-4 rounded-xl bg-[#eff4ff] p-4">
                <p className="text-sm text-[#434655]">
                  Cada clique em <strong>Gerar resposta</strong> encerra o ciclo atual e analisa
                  o trecho mais recente da conversa.
                </p>
              </div>
              <div className="mt-4 rounded-xl border border-[#c3c6d7] bg-white p-4">
                <label className="mb-2 block text-sm font-medium text-[#0d1c2e]">
                  Provider de IA
                </label>
                <select
                  value={selectedProvider}
                  onChange={(event) => {
                    pendingManualOperationRef.current = null;
                    manualGenerateMutation.reset();
                    setSelectedProvider(event.target.value as LlmProvider);
                  }}
                  className="h-10 w-full rounded-lg border border-[#c3c6d7] bg-white px-3 text-sm outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                >
                  <option value="gemini">Gemini</option>
                  <option value="ollama">Ollama</option>
                  <option value="openai">OpenAI</option>
                </select>
                <label className="mb-2 mt-3 block text-sm font-medium text-[#0d1c2e]">
                  Modelo (opcional)
                </label>
                <input
                  value={selectedModel}
                  onChange={(event) => {
                    pendingManualOperationRef.current = null;
                    manualGenerateMutation.reset();
                    setSelectedModel(event.target.value);
                  }}
                  placeholder={`Padrão do backend para ${providerLabelMap[selectedProvider]}`}
                  className="h-10 w-full rounded-lg border border-[#c3c6d7] bg-white px-3 text-sm outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                />
              </div>
            </div>
          </aside>

          <section className="col-span-12 space-y-3 md:col-span-6">
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 bg-white p-6">
                <h2
                  ref={responseHeadingRef}
                  tabIndex={-1}
                  className="flex items-center gap-2 text-[24px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2"
                >
                  <span className="material-symbols-outlined text-[#004ac6]" aria-hidden="true">auto_awesome</span>
                  Sugestão de resposta
                </h2>
                <span className="rounded-full bg-[#2563eb] px-3 py-1 text-xs font-bold text-white">
                  IA Ativa
                </span>
              </div>

              {currentCycle.status === 'needs-confirmation' || manualGenerateMutation.isPending ? (
                <form className="space-y-4 p-6" onSubmit={handleManualGenerate}>
                  <p className="text-sm text-[#434655]">
                    {confirmationInstruction}
                  </p>
                  {currentDetection ? <DetectionMetadata detection={currentDetection} /> : null}
                  <label className="block text-sm font-medium" htmlFor="question-correction">
                    Pergunta do entrevistador
                  </label>
                  <textarea
                    ref={questionInputRef}
                    id="question-correction"
                    minLength={1}
                    maxLength={500}
                    required
                    aria-describedby={`question-correction-help${manualMutationErrorMessage ? ' question-correction-error' : ''}`}
                    value={questionInput}
                    onChange={(event) => {
                      pendingManualOperationRef.current = null;
                      manualGenerateMutation.reset();
                      setQuestionInput(event.target.value);
                    }}
                    className="w-full rounded-xl border border-[#c3c6d7] p-3 outline-none focus-visible:border-[#004ac6] focus-visible:ring-2 focus-visible:ring-[#004ac6]/30"
                  />
                  <p id="question-correction-help" className="text-xs text-[#737686]">
                    Revise ou informe a pergunta em até 500 caracteres.
                  </p>
                  {manualMutationErrorMessage ? (
                    <p id="question-correction-error" className="text-sm font-medium text-[#ba1a1a]">
                      {manualMutationErrorMessage}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <button
                      ref={retryButtonRef}
                      type="submit"
                      disabled={!sessionId || manualGenerateMutation.isPending || !questionInput.trim()}
                      className="rounded-xl bg-[#004ac6] px-4 py-2 font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      {manualGenerateMutation.isPending
                        ? 'Gerando resposta…'
                        : manualGenerateMutation.error
                          ? 'Tentar novamente'
                          : 'Confirmar e gerar resposta'}
                    </button>
                    {currentCycle.status === 'needs-confirmation' ? (
                      <button
                        type="button"
                        onClick={handleIgnoreConfirmation}
                        disabled={manualGenerateMutation.isPending}
                        className="rounded-xl border border-[#c3c6d7] bg-white px-4 py-2 font-semibold text-[#434655] outline-none hover:bg-[#eff4ff] focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        Ignorar por enquanto
                      </button>
                    ) : null}
                  </div>
                </form>
              ) : (
              <div className="space-y-6 p-6">
                {currentCycle.status === 'answer-ready' ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <DetectionMetadata detection={currentCycle.detection} />
                    <button
                      type="button"
                      onClick={() => void handleCorrectQuestion()}
                      disabled={isOpeningCorrection}
                      className="rounded-xl border border-[#004ac6] bg-white px-4 py-2 text-sm font-semibold text-[#004ac6] outline-none hover:bg-[#eff4ff] focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2"
                    >
                      {isOpeningCorrection ? 'Pausando captura…' : 'Corrigir pergunta'}
                    </button>
                  </div>
                ) : null}
                <div className="rounded-xl border-l-4 border-[#004ac6] bg-[#eff4ff] p-4">
                  <span className="block text-sm font-medium text-[#004ac6]">Pergunta identificada</span>
                  <p className="mt-1 text-[20px] font-semibold leading-snug">
                    {currentAnswer?.detectedQuestion ??
                      'Aguardando pergunta para gerar sugestão...'}
                  </p>
                </div>

                <div>
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[#737686]">
                    <span className="material-symbols-outlined text-[16px]">article</span>
                    Resposta sugerida
                  </span>
                  <p className="mt-2 whitespace-pre-wrap text-[16px] leading-7 text-[#0d1c2e]">
                    {currentAnswer?.suggestedAnswer ??
                      'Quando você gerar a primeira resposta, ela aparecerá aqui em formato pronto para uso.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-[#c3c6d7]/40 bg-[#e6eeff] p-4">
                    <span className="block text-sm font-bold text-[#434655]">Versão curta</span>
                    <p className="mt-1 text-sm italic text-[#0d1c2e]">
                      {currentAnswer?.shortVersion ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#c3c6d7]/40 bg-[#eff4ff] p-4">
                    <span className="block text-sm font-bold text-[#434655]">Pontos-chave</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(currentAnswer?.keyPoints ?? []).length === 0 ? (
                        <span className="text-sm text-[#737686]">—</span>
                      ) : (
                        currentAnswer?.keyPoints.map((point) => (
                          <span
                            key={point}
                            className="rounded border border-[#c3c6d7] bg-white px-2 py-0.5 text-xs font-medium"
                          >
                            {point}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 rounded-xl bg-[#ffdbcd] p-4 text-[#360f00]">
                  <span className="material-symbols-outlined text-[#943700]">lightbulb</span>
                  <div>
                    <span className="block text-sm font-bold">Observação estratégica</span>
                    <p className="text-sm">
                      {currentAnswer?.strategicNote ??
                        'Conecte sua resposta com um caso real de projeto para aumentar credibilidade.'}
                    </p>
                  </div>
                </div>

                {summary ? (
                  <SessionSummary
                    summary={summary}
                    onRetry={summary.status === 'FAILED' ? () => retrySummaryMutation.mutate(summary.sessionId) : undefined}
                    isRetrying={retrySummaryMutation.isPending}
                    showDetailsLink
                  />
                ) : null}
              </div>
              )}
            </div>
          </section>

          <aside className="col-span-12 space-y-3 md:col-span-3">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-100 p-6">
                <h2 className="text-[18px] font-semibold">Perguntas desta sessão</h2>
              </div>
              <div className="space-y-2 p-4">
                {history.length === 0 ? (
                  <p className="text-sm text-[#737686]">Nenhuma pergunta registrada ainda.</p>
                ) : (
                  history.map((item, index) => {
                    const active = currentAnswer?.id === item.answer.id;
                    return (
                      <button
                        key={item.answer.id}
                        type="button"
                        onClick={() => selectResponse(item.answer.id)}
                        className={`w-full rounded-xl p-4 text-left transition ${
                          active
                            ? 'bg-[#2563eb] text-white shadow-md'
                            : 'bg-[#eff4ff] text-[#0d1c2e] hover:bg-[#dce9ff]'
                        }`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
                          Pergunta {history.length - index}
                        </p>
                        <p className="mt-1 text-sm font-medium">{item.detection.question}</p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <label className="block text-sm font-medium text-[#0d1c2e]">
                Trecho capturado da entrevista
              </label>
              <textarea
                className="mt-2 w-full rounded-xl border border-[#c3c6d7] bg-white p-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                rows={4}
                value={transcriptInput}
                maxLength={MAX_TRANSCRIPT_CHARS}
                onChange={(event) => {
                  pendingAutomaticOperationRef.current = null;
                  setTranscriptInput(event.target.value);
                }}
                placeholder="Cole aqui a última fala/pergunta do entrevistador..."
              />
              <div className="mt-3 rounded-xl border border-[#c3c6d7] bg-[#f8f9ff] p-4">
                <label className="mb-2 block text-sm font-medium text-[#0d1c2e]">
                  Ou envie um áudio para transcrição (Whisper)
                </label>
                <div className="mb-3 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleStartRecording}
                    disabled={isRecording || isLoading}
                    className="w-full rounded-lg bg-[#004ac6] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Iniciar gravação
                  </button>
                  <button
                    type="button"
                    onClick={handleStopRecording}
                    disabled={!isRecording}
                    className="w-full rounded-lg border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] hover:bg-[#eff4ff] disabled:opacity-50"
                  >
                    Parar gravação
                  </button>
                </div>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept={AUDIO_ACCEPT}
                  onChange={handleAudioSelection}
                  className="block w-full text-sm text-[#434655] file:mr-0 file:w-full file:rounded-lg file:border-0 file:bg-[#004ac6] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:opacity-90"
                />
                {isRecording ? (
                  <p className="mt-2 text-sm text-[#004ac6]">Gravando... clique em Parar gravação.</p>
                ) : null}
                {recordingError ? (
                  <p className="mt-2 text-sm text-[#ba1a1a]">{recordingError}</p>
                ) : null}
                {audioFile ? (
                  <p className="mt-2 text-sm text-[#434655]">
                    Arquivo selecionado: <strong>{audioFile.name}</strong>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-[#737686]">
                    Se `transcript` e áudio forem preenchidos, o transcript manual tem prioridade.
                  </p>
                )}
              </div>
            </div>
          </aside>

          {mutationError && !manualGenerateMutation.error ? (
            <div className="col-span-12">
              <Alert variant="destructive">
                <span className="material-symbols-outlined text-[18px]">error</span>
                <AlertTitle>Erro ao processar solicitação</AlertTitle>
                <AlertDescription>{displayedErrorMessage}</AlertDescription>
              </Alert>
            </div>
          ) : null}
        </main>
      )}
    </div>
  );
}
