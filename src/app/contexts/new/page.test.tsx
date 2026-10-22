import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewContextPage from './page';
import { api } from '@/lib/api';
import { useInterviewStore } from '@/lib/interview-store';
import { renderWithProviders } from '@/test/render';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({
  api: { me: vi.fn(), createContext: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}));

const user = { id: 'user-test', email: 'candidate@example.test' };
const resume = 'Desenvolvedor com experiência em APIs Node.js, transações e sistemas distribuídos.';
const jobDescription = 'Desenvolver APIs seguras e manter serviços de produção.';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useInterviewStore.setState(useInterviewStore.getInitialState(), true);
  vi.mocked(api.me).mockResolvedValue({
    ...user,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  });
});

describe('New interview context', () => {
  it('rejects an invalid context before calling the API', async () => {
    const { container } = renderWithProviders(<NewContextPage />);
    await screen.findByRole('heading', { name: 'Criar novo contexto' });

    // Submit directly to exercise application validation independently of native required fields.
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText('Currículo deve ter entre 50 e 12000 caracteres.')).toBeVisible();
    expect(api.createContext).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(localStorage.getItem('replymentor_selected_context_id')).toBeNull();
    expect(useInterviewStore.getState().contextId).toBeNull();
  });

  it.each([
    ['  Responda em primeira pessoa.  ', 'Responda em primeira pessoa.'],
    ['   ', undefined],
  ])('creates a valid context with normalized AI behavior %j', async (behavior, expectedBehavior) => {
    vi.mocked(api.createContext).mockResolvedValue({ id: 'context-created' });
    const interaction = userEvent.setup();
    renderWithProviders(<NewContextPage />);
    await screen.findByRole('heading', { name: 'Criar novo contexto' });

    await interaction.type(screen.getByPlaceholderText(/Ex: Desenvolvedor Senior/), resume);
    await interaction.type(screen.getByPlaceholderText('Cole aqui os requisitos e responsabilidades descritos na vaga...'), jobDescription);
    await interaction.type(screen.getByPlaceholderText('Ex: Google, Stripe, Nubank...'), 'Empresa Exemplo');
    await interaction.type(screen.getByPlaceholderText('Cultura, produtos principais ou notícias recentes...'), 'Tecnologia');
    await interaction.type(screen.getByPlaceholderText(/Quero que você aja como se fosse o entrevistado/), behavior);
    await interaction.click(screen.getByRole('button', { name: 'Direta e curta Ideal para entrevistas técnicas rápidas.' }));
    await interaction.click(screen.getByRole('button', { name: 'Salvar contexto da entrevista' }));

    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith('/'));
    expect(api.createContext).toHaveBeenCalledExactlyOnceWith({
      resumeText: resume,
      interviewType: 'Técnica (Coding/System Design)',
      jobLevel: 'Pleno',
      jobDescription,
      companyName: 'Empresa Exemplo',
      companySegment: 'Tecnologia',
      responsePreference: 'direta e curta',
      aiBehavior: expectedBehavior,
    });
    expect(localStorage.getItem('replymentor_selected_context_id')).toBe('context-created');
    expect(useInterviewStore.getState().contextId).toBe('context-created');
  });
});
