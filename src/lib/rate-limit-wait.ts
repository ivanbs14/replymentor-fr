import { ApiError } from './interview-contract';

export function rateLimitDeadline(
  error: unknown,
  now = Date.now(),
): number | null {
  if (!(error instanceof ApiError) || error.statusCode !== 429) return null;
  return now + Math.max(error.retryAfterSeconds ?? 1, 1) * 1_000;
}

export function rateLimitSecondsRemaining(
  deadline: number | null,
  now = Date.now(),
): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}
