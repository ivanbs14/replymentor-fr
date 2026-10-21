'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useInterviewStore } from '@/lib/interview-store';
import {
  INTERVIEW_TYPES,
  JOB_LEVELS,
  RESPONSE_PREFERENCES,
  validateInterviewContext,
} from '@/lib/interview-contract';

const SELECTED_CONTEXT_STORAGE_KEY = 'replymentor_selected_context_id';

export default function NewContextPage() {
  const router = useRouter();
  const {
    authUser,
    contextForm,
    setAuthUser,
    setContextField,
    setContextId,
    resetInterviewState,
  } = useInterviewStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem('replymentor_token');
      localStorage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
      setAuthUser(null);
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
  }, [resetInterviewState, setAuthUser]);

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
      localStorage.setItem(SELECTED_CONTEXT_STORAGE_KEY, data.id);
      setContextId(data.id);
      router.push('/');
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao criar contexto.');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    const validationError = validateInterviewContext(contextForm);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    createContextMutation.mutate();
  };

  if (!authUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f9ff] px-6 py-10">
        <div className="w-full max-w-md rounded-2xl border border-[#c3c6d7] bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-[#004ac6]">ReplyMentor</h1>
          <p className="mt-2 text-sm text-[#434655]">
            Você precisa estar autenticado para criar contexto.
          </p>
          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#004ac6] text-sm font-semibold text-white hover:opacity-95"
            >
              Ir para login
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0d1c2e]">
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
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-lg border border-[#c3c6d7] px-3 py-1 text-sm font-medium text-[#434655] hover:bg-[#eff4ff]"
            >
              Dashboard
            </Link>
            <Link
              href="/contexts"
              className="rounded-lg border border-[#c3c6d7] px-3 py-1 text-sm font-medium text-[#434655] hover:bg-[#eff4ff]"
            >
              Contextos
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-screen w-full max-w-[1280px] px-6 py-12">
        <div className="mb-12 text-center">
          <h2 className="text-[32px] font-semibold leading-[40px] tracking-[-0.01em]">
            Criar novo contexto
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-[18px] leading-7 text-[#434655]">
            Configure os dados da entrevista para liberar a sessão de escuta no dashboard.
          </p>
        </div>

        <form
          id="context-form"
          onSubmit={handleSubmit}
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
              minLength={50}
              maxLength={12000}
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
                options={[...INTERVIEW_TYPES]}
              />
              <SelectField
                label="Nível da vaga"
                value={contextForm.jobLevel}
                onChange={(value) => setContextField('jobLevel', value)}
                options={[...JOB_LEVELS]}
              />
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-[#0d1c2e]">Descrição da vaga (JD)</label>
                <textarea
                  className="w-full rounded-xl border border-[#c3c6d7] bg-white p-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                  rows={4}
                  required
                  minLength={20}
                  maxLength={8000}
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
                maxLength={120}
              />
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#0d1c2e]">Contexto da empresa</label>
                <textarea
                  className="w-full rounded-xl border border-[#c3c6d7] bg-white p-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
                  rows={3}
                  maxLength={1000}
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
                maxLength={280}
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
                  key: RESPONSE_PREFERENCES[0],
                  title: 'Direta e curta',
                  desc: 'Ideal para entrevistas técnicas rápidas.',
                },
                {
                  key: RESPONSE_PREFERENCES[1],
                  title: 'Equilibrada',
                  desc: 'Tom profissional com contexto suficiente.',
                },
                {
                  key: RESPONSE_PREFERENCES[2],
                  title: 'Detalhada e didática',
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
          <Link
            href="/contexts"
            className="w-full rounded-xl border border-[#c3c6d7] px-8 py-3 text-center text-sm text-[#434655] hover:bg-[#dce9ff] md:w-auto"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            form="context-form"
            disabled={createContextMutation.isPending}
            className="w-full rounded-xl bg-[#004ac6] px-10 py-4 text-[18px] font-semibold text-white shadow-lg shadow-[#004ac6]/20 hover:opacity-95 disabled:opacity-60 md:w-auto"
          >
            Salvar contexto da entrevista
          </button>
        </div>

        {errorMessage ? (
          <Alert className="mt-6" variant="destructive">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <AlertTitle>Erro ao processar solicitação</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </main>
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
    <div className="space-y-1">
      <div className="inline-flex items-center gap-2 rounded-full bg-[#eff4ff] px-3 py-1 text-xs font-semibold text-[#004ac6]">
        <span className="material-symbols-outlined text-[16px]">{icon}</span>
        <span>{title}</span>
      </div>
      <h3 className="text-[22px] font-semibold text-[#0d1c2e]">{title}</h3>
      <p className="text-sm text-[#434655]">{subtitle}</p>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-[#0d1c2e]">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className="h-12 w-full rounded-xl border border-[#c3c6d7] bg-white px-4 text-[16px] outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/30"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
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
