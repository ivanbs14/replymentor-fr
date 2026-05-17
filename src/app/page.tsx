'use client';

import { useMutation } from '@tanstack/react-query';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useInterviewStore } from '@/lib/interview-store';

type LlmProvider = 'gemini' | 'ollama' | 'openai';

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
    contextForm,
    contextId,
    sessionId,
    sessionStatus,
    transcriptInput,
    latestResponse,
    history,
    summary,
    setContextField,
    setContextForm,
    setContextId,
    setSessionId,
    setSessionStatus,
    setTranscriptInput,
    pushResponse,
    selectResponse,
    setSummary,
  } = useInterviewStore();
  const attemptedHydration = useRef(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingResolverRef = useRef<((file: File | null) => void) | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LlmProvider>('ollama');
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    if (contextId || attemptedHydration.current) return;
    attemptedHydration.current = true;

    api
      .getLatestContext()
      .then((context) => {
        setContextId(context.id);
        setContextForm({
          resumeText: context.resumeText,
          interviewType: context.interviewType,
          jobLevel: context.jobLevel,
          jobDescription: context.jobDescription,
          companyName: context.companyName,
          companySegment: context.companySegment ?? '',
          responsePreference: context.responsePreference,
          aiBehavior: context.aiBehavior ?? '',
        });
      })
      .catch(() => {
        // Se não houver contexto no banco, mantém fluxo de criação manual.
      });
  }, [contextId, setContextForm, setContextId]);

  const createContextMutation = useMutation({
    mutationFn: () =>
      api.createContext({
        resumeText: contextForm.resumeText,
        interviewType: contextForm.interviewType,
        jobLevel: contextForm.jobLevel,
        jobDescription: contextForm.jobDescription,
        companyName: contextForm.companyName,
        companySegment: contextForm.companySegment,
        responsePreference: contextForm.responsePreference,
        aiBehavior: contextForm.aiBehavior.trim() || undefined,
      }),
    onSuccess: (data) => {
      setContextId(data.id);
    },
  });

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      if (!contextId) throw new Error('Salve o contexto antes de iniciar a sessão.');
      return api.startSession(contextId);
    },
    onSuccess: (data) => {
      setSessionId(data.id);
      setSessionStatus('listening');
      void handleStartRecording();
    },
  });

  const generateResponseMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('Inicie a sessão antes de gerar resposta.');
      let capturedAudioFile = audioFile;

      if (isRecording) {
        capturedAudioFile = await stopRecordingAndWait();
      }

      const manualTranscript = transcriptInput.trim();
      if (!manualTranscript && !capturedAudioFile) {
        throw new Error('Adicione um transcript manual ou selecione um áudio para análise.');
      }

      setSessionStatus('processing');
      if (manualTranscript) {
        await api.addTranscript(sessionId, { transcript: manualTranscript });
      } else if (capturedAudioFile) {
        const audioBase64 = await fileToBase64(capturedAudioFile);
        await api.addTranscript(sessionId, {
          audioBase64,
          mimeType: capturedAudioFile.type || 'audio/webm',
        });
      }

      return api.generateResponse(sessionId, {
        provider: selectedProvider,
        model: selectedModel.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      pushResponse(data);
      setTranscriptInput('');
      setAudioFile(null);
      if (audioInputRef.current) {
        audioInputRef.current.value = '';
      }
      setSessionStatus('listening');
      // Keep continuous capture cycles until the user explicitly ends the session.
      void handleStartRecording();
    },
    onError: () => setSessionStatus('listening'),
  });

  const endSessionMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('Sessão ainda não iniciada.');
      return api.endSession(sessionId);
    },
    onSuccess: (data) => {
      if (isRecording) {
        void stopRecordingAndWait();
      }
      setSummary(data.content);
      setSessionId(null);
      setSessionStatus('closed');
    },
  });

  const mutationError =
    createContextMutation.error ||
    startSessionMutation.error ||
    generateResponseMutation.error ||
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

  const isLoading =
    createContextMutation.isPending ||
    startSessionMutation.isPending ||
    generateResponseMutation.isPending ||
    endSessionMutation.isPending;

  const handleSaveContext = (event: FormEvent) => {
    event.preventDefault();
    createContextMutation.mutate();
  };

  const handleAudioSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setAudioFile(selectedFile);
    setRecordingError(null);
  };

  const handleStartRecording = async () => {
    if (isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError('Seu navegador não suporta captura de áudio por microfone.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size === 0) {
          setRecordingError('Áudio vazio. Grave novamente por alguns segundos.');
          setIsRecording(false);
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          if (recordingResolverRef.current) {
            recordingResolverRef.current(null);
            recordingResolverRef.current = null;
          }
          return;
        }

        const extension = blob.type.includes('ogg') ? 'ogg' : 'webm';
        const capturedFile = new File([blob], `captura-${Date.now()}.${extension}`, {
          type: blob.type || 'audio/webm',
        });

        setAudioFile(capturedFile);
        setIsRecording(false);

        if (audioInputRef.current) {
          audioInputRef.current.value = '';
        }

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (recordingResolverRef.current) {
          recordingResolverRef.current(capturedFile);
          recordingResolverRef.current = null;
        }
      };

      recorder.onerror = () => {
        setRecordingError('Falha ao gravar áudio. Tente novamente.');
        setIsRecording(false);
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (recordingResolverRef.current) {
          recordingResolverRef.current(null);
          recordingResolverRef.current = null;
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      setRecordingError('Permissão de microfone negada ou indisponível.');
      setIsRecording(false);
    }
  };

  const stopRecordingAndWait = async (): Promise<File | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return audioFile;
    }

    return new Promise<File | null>((resolve) => {
      recordingResolverRef.current = resolve;
      recorder.stop();
    });
  };

  const handleStopRecording = () => {
    void stopRecordingAndWait();
  };

  useEffect(() => {
    return () => {
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
              <span className="text-sm text-[#434655]">Practice</span>
              <span className="text-sm text-[#434655]">Resources</span>
            </nav>
            <div className="hidden items-center gap-2 md:flex">
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
            </nav>
          </div>
        </header>
      )}

      {!contextId ? (
        <main className="mx-auto min-h-screen w-full max-w-[1280px] px-6 py-12">
          <div className="mb-12 text-center">
            <h2 className="text-[32px] font-semibold leading-[40px] tracking-[-0.01em]">
              Configure o contexto da sua entrevista
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-[18px] leading-7 text-[#434655]">
              Quanto mais contexto você fornecer, mais precisas serão as sugestões de resposta
              durante o seu processo seletivo.
            </p>
          </div>

          <form
            id="context-form"
            onSubmit={handleSaveContext}
            className="overflow-hidden rounded-2xl border border-[#c3c6d7] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
          >
            <section className="border-b border-[#c3c6d7] p-8">
              <SectionHeader
                icon="description"
                title="Perfil profissional"
                subtitle="Cole seu currículo ou resumo da sua carreira profissional."
              />
              <textarea
                className="mt-4 w-full rounded-xl border border-[#c3c6d7] bg-white p-4 text-[16px] leading-6 outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                rows={6}
                required
                value={contextForm.resumeText}
                onChange={(event) => setContextField('resumeText', event.target.value)}
                placeholder="Ex: Desenvolvedor Senior com 8 anos de experiência em React, Node.js e arquitetura de sistemas..."
              />
            </section>

            <section className="border-b border-[#c3c6d7] bg-[#eff4ff]/30 p-8">
              <SectionHeader
                icon="work"
                title="Entrevista"
                subtitle="Detalhes sobre a oportunidade e o tipo de avaliação."
              />
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <SelectField
                  label="Tipo de entrevista"
                  value={contextForm.interviewType}
                  onChange={(value) => setContextField('interviewType', value)}
                  options={[
                    'Técnica (Coding/System Design)',
                    'Comportamental (Soft Skills)',
                    'Conversa com RH',
                    'Cultural Fit',
                  ]}
                />
                <SelectField
                  label="Nível da vaga"
                  value={contextForm.jobLevel}
                  onChange={(value) => setContextField('jobLevel', value)}
                  options={['Júnior', 'Pleno', 'Sênior', 'Tech Lead']}
                />
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-[#0d1c2e]">Descrição da vaga (JD)</label>
                  <textarea
                    className="w-full rounded-xl border border-[#c3c6d7] bg-white p-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                    rows={4}
                    required
                    value={contextForm.jobDescription}
                    onChange={(event) => setContextField('jobDescription', event.target.value)}
                    placeholder="Cole aqui os requisitos e responsabilidades descritos na vaga..."
                  />
                </div>
              </div>
            </section>

            <section className="border-b border-[#c3c6d7] p-8">
              <SectionHeader
                icon="business"
                title="Empresa"
                subtitle="Informações sobre onde você está aplicando."
              />
              <div className="mt-6 grid grid-cols-1 gap-6">
                <InputField
                  label="Nome da empresa"
                  value={contextForm.companyName}
                  onChange={(value) => setContextField('companyName', value)}
                  placeholder="Ex: Google, Stripe, Nubank..."
                  required
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#0d1c2e]">Contexto da empresa</label>
                  <textarea
                    className="w-full rounded-xl border border-[#c3c6d7] bg-white p-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                    rows={3}
                    value={contextForm.companySegment}
                    onChange={(event) => setContextField('companySegment', event.target.value)}
                    placeholder="Cultura, produtos principais ou notícias recentes..."
                  />
                </div>
              </div>
            </section>

            <section className="p-8">
              <SectionHeader
                icon="person"
                title="Como a IA deve ser"
                subtitle="Defina a persona/comportamento da IA para responder como se fosse você."
              />
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium text-[#0d1c2e]">Instrução de comportamento</label>
                <textarea
                  className="w-full rounded-xl border border-[#c3c6d7] bg-white p-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                  rows={3}
                  value={contextForm.aiBehavior}
                  onChange={(event) => setContextField('aiBehavior', event.target.value)}
                  placeholder='Ex: "Quero que você aja como se fosse o entrevistado e responda em primeira pessoa com tom confiante e objetivo."'
                />
              </div>
            </section>

            <section className="border-t border-[#c3c6d7] p-8">
              <SectionHeader
                icon="tune"
                title="Estilo de resposta"
                subtitle="Como você prefere que o Copilot sugira suas falas."
              />
              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                {[
                  {
                    key: 'direta e curta',
                    title: 'Direta e curta',
                    desc: 'Ideal para entrevistas técnicas rápidas.',
                  },
                  {
                    key: 'equilibrada',
                    title: 'Equilibrada',
                    desc: 'Tom profissional com contexto suficiente.',
                  },
                  {
                    key: 'mais detalhada',
                    title: 'Mais detalhada',
                    desc: 'Explicações profundas e estruturadas.',
                  },
                ].map((item) => {
                  const active = contextForm.responsePreference.toLowerCase() === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setContextField('responsePreference', item.key)}
                      className={`relative rounded-xl border-2 p-4 text-left transition ${
                        active
                          ? 'border-[#004ac6] bg-[#2563eb]/5'
                          : 'border-[#c3c6d7] bg-white hover:border-[#004ac6]'
                      }`}
                    >
                      <span
                        className={`absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border transition ${
                          active ? 'border-[#004ac6] bg-white' : 'border-[#c3c6d7] bg-white'
                        }`}
                        aria-hidden="true"
                      >
                        <span
                          className={`h-2.5 w-2.5 rounded-full transition ${
                            active ? 'bg-[#004ac6]' : 'bg-transparent'
                          }`}
                        />
                      </span>
                      <p className="text-sm font-bold text-[#0d1c2e]">{item.title}</p>
                      <p className="mt-1 text-sm text-[#434655]">{item.desc}</p>
                    </button>
                  );
                })}
              </div>
            </section>

          </form>

          <div className="mt-8 flex flex-col items-center justify-end gap-4 md:flex-row">
            <button
              type="button"
              className="w-full rounded-xl border border-[#c3c6d7] px-8 py-3 text-sm text-[#434655] hover:bg-[#dce9ff] md:w-auto"
            >
              Preencher depois
            </button>
            <button
              type="submit"
              form="context-form"
              disabled={createContextMutation.isPending}
              className="w-full rounded-xl bg-[#004ac6] px-10 py-4 text-[18px] font-semibold text-white shadow-lg shadow-[#004ac6]/20 hover:opacity-95 disabled:opacity-60 md:w-auto"
            >
              Salvar contexto da entrevista
            </button>
          </div>

          {mutationError ? (
            <Alert className="mt-6" variant="destructive">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <AlertTitle>Erro ao processar solicitação</AlertTitle>
              <AlertDescription>{displayedErrorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </main>
      ) : (
        <main className="mx-auto grid w-full max-w-[1280px] grid-cols-12 gap-6 px-6 py-6">
          <aside className="col-span-12 space-y-3 md:col-span-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-[24px] font-semibold">Sessão em andamento</h2>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => startSessionMutation.mutate()}
                  disabled={Boolean(sessionId) || startSessionMutation.isPending}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#004ac6] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">play_circle</span>
                  Iniciar escuta
                </button>
                <button
                  type="button"
                  onClick={() => generateResponseMutation.mutate()}
                  disabled={!sessionId || isLoading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#4b41e1] font-semibold text-white shadow-lg shadow-[#4b41e1]/20 hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">psychology</span>
                  Gerar resposta
                </button>
                <button
                  type="button"
                  onClick={() => generateResponseMutation.mutate()}
                  disabled={!sessionId || isLoading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#004ac6]/20 bg-white font-semibold text-[#004ac6] hover:bg-[#eff4ff] disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">refresh</span>
                  Refinar resposta
                </button>
                <button
                  type="button"
                  onClick={() => endSessionMutation.mutate()}
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
                  onChange={(event) =>
                    setSelectedProvider(event.target.value as LlmProvider)
                  }
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
                  onChange={(event) => setSelectedModel(event.target.value)}
                  placeholder={`Padrão do backend para ${providerLabelMap[selectedProvider]}`}
                  className="h-10 w-full rounded-lg border border-[#c3c6d7] bg-white px-3 text-sm outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                />
              </div>
            </div>
          </aside>

          <section className="col-span-12 space-y-3 md:col-span-6">
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 bg-white p-6">
                <h2 className="flex items-center gap-2 text-[24px] font-semibold">
                  <span className="material-symbols-outlined text-[#004ac6]">auto_awesome</span>
                  Sugestão de resposta
                </h2>
                <span className="rounded-full bg-[#2563eb] px-3 py-1 text-xs font-bold text-white">
                  IA Ativa
                </span>
              </div>

              <div className="space-y-6 p-6">
                <div className="rounded-xl border-l-4 border-[#004ac6] bg-[#eff4ff] p-4">
                  <span className="block text-sm font-medium text-[#004ac6]">Pergunta identificada</span>
                  <p className="mt-1 text-[20px] font-semibold leading-snug">
                    {latestResponse?.detectedQuestion ??
                      'Aguardando pergunta para gerar sugestão...'}
                  </p>
                </div>

                <div>
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[#737686]">
                    <span className="material-symbols-outlined text-[16px]">article</span>
                    Resposta sugerida
                  </span>
                  <p className="mt-2 whitespace-pre-wrap text-[16px] leading-7 text-[#0d1c2e]">
                    {latestResponse?.suggestedAnswer ??
                      'Quando você gerar a primeira resposta, ela aparecerá aqui em formato pronto para uso.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-[#c3c6d7]/40 bg-[#e6eeff] p-4">
                    <span className="block text-sm font-bold text-[#434655]">Versão curta</span>
                    <p className="mt-1 text-sm italic text-[#0d1c2e]">
                      {latestResponse?.shortVersion ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#c3c6d7]/40 bg-[#eff4ff] p-4">
                    <span className="block text-sm font-bold text-[#434655]">Pontos-chave</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(latestResponse?.keyPoints ?? []).length === 0 ? (
                        <span className="text-sm text-[#737686]">—</span>
                      ) : (
                        latestResponse?.keyPoints.map((point) => (
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
                      {latestResponse?.strategicNote ??
                        'Conecte sua resposta com um caso real de projeto para aumentar credibilidade.'}
                    </p>
                  </div>
                </div>

                {summary ? (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    Resumo final: {summary}
                  </p>
                ) : null}
              </div>
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
                    const active = latestResponse?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectResponse(item.id)}
                        className={`w-full rounded-xl p-4 text-left transition ${
                          active
                            ? 'bg-[#2563eb] text-white shadow-md'
                            : 'bg-[#eff4ff] text-[#0d1c2e] hover:bg-[#dce9ff]'
                        }`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
                          Pergunta {history.length - index}
                        </p>
                        <p className="mt-1 text-sm font-medium">{item.detectedQuestion}</p>
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
                onChange={(event) => setTranscriptInput(event.target.value)}
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
                  accept="audio/*"
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

          {mutationError ? (
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

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="rounded-xl bg-[#2563eb]/10 p-3">
        <span className="material-symbols-outlined text-[#004ac6]">{icon}</span>
      </div>
      <div>
        <h3 className="text-[24px] font-semibold leading-8 text-[#0d1c2e]">{title}</h3>
        <p className="text-[16px] leading-6 text-[#434655]">{subtitle}</p>
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-[#0d1c2e]">{label}</label>
      <input
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-[#c3c6d7] bg-white px-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-[#0d1c2e]">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-xl border border-[#c3c6d7] bg-white px-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
