import { expect, test, type Route } from '@playwright/test';

const apiBase = 'http://localhost:3001';
const user = { id: 'user-e2e', email: 'candidate@example.test' };
const contextId = 'context-e2e';
const sessionId = 'session-e2e';

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test('login, context, answer and session closing use only the simulated API', async ({ page }) => {
  let authenticated = false;
  const providerRequests: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['generativelanguage.googleapis.com', 'api.openai.com'].includes(url.hostname) ||
      ['11434', '8000'].includes(url.port)
    ) {
      providerRequests.push(request.url());
    }
  });

  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === '/auth/me') {
      return authenticated
        ? json(route, { ...user, createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z' })
        : json(route, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Não autenticado.' }, 401);
    }
    if (path === '/auth/login' && request.method() === 'POST') {
      authenticated = true;
      return json(route, { user });
    }
    if (path === '/interview/context' && request.method() === 'POST') {
      return json(route, { id: contextId });
    }
    if (path === '/interview/sessions/start') {
      return json(route, { id: sessionId });
    }
    if (path === `/interview/sessions/${sessionId}/transcripts`) {
      return json(route, { id: 'transcript-e2e' });
    }
    if (path === `/interview/sessions/${sessionId}/generate-response`) {
      return json(route, {
        id: 'response-e2e',
        detectedQuestion: 'Como você garante isolamento entre usuários?',
        suggestedAnswer: 'Eu valido a propriedade do recurso em todas as operações.',
        shortVersion: 'Valido ownership em cada operação.',
        keyPoints: ['ownership', '404'],
        strategicNote: 'Use um exemplo concreto.',
        createdAt: '2026-10-22T00:00:00.000Z',
      });
    }
    if (path === `/interview/sessions/${sessionId}/end`) {
      return json(route, { id: 'summary-e2e', content: 'Resumo simulado e determinístico.' });
    }
    return json(route, { statusCode: 500, message: `Rota não simulada: ${path}` }, 500);
  });

  await page.goto('/');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill('test-password-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(user.email)).toBeVisible();

  await page.getByRole('link', { name: 'Criar novo contexto' }).click();
  await page.getByPlaceholder(/Desenvolvedor Senior/).fill('Experiência fictícia em TypeScript, APIs, testes automatizados e bancos relacionais.'.padEnd(60, '.'));
  await page.getByPlaceholder(/requisitos e responsabilidades/).fill('Construir serviços seguros, observáveis e cobertos por testes automatizados.');
  await page.getByPlaceholder(/Google, Stripe/).fill('Empresa Exemplo');
  await page.getByRole('button', { name: 'Salvar contexto da entrevista' }).click();

  await expect(page.getByRole('button', { name: 'Iniciar escuta' })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar escuta' }).click();
  await page.getByPlaceholder(/última fala\/pergunta/).fill('Como você garante isolamento entre usuários?');
  await page.getByRole('button', { name: /Gerar resposta/ }).click();
  await expect(page.getByText('Como você garante isolamento entre usuários?')).toBeVisible();
  await expect(page.getByText('Eu valido a propriedade do recurso em todas as operações.')).toBeVisible();

  await page.getByRole('button', { name: 'Encerrar sessão' }).click();
  await expect(page.getByText('Resumo final: Resumo simulado e determinístico.')).toBeVisible();
  expect(providerRequests).toEqual([]);
});
