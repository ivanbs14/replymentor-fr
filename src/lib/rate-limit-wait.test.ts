import { describe, expect, it } from 'vitest';
import { ApiError } from './interview-contract';
import {
  rateLimitDeadline,
  rateLimitSecondsRemaining,
} from './rate-limit-wait';

describe('rate limit wait', () => {
  it('creates a minimum one-second deadline only for 429 errors', () => {
    expect(
      rateLimitDeadline(
        new ApiError('Aguarde.', 429, 'RATE_LIMIT_EXCEEDED', 7),
        1_000,
      ),
    ).toBe(8_000);
    expect(rateLimitDeadline(new ApiError('Aguarde.', 429), 1_000)).toBe(
      2_000,
    );
    expect(rateLimitDeadline(new ApiError('Falha.', 503), 1_000)).toBeNull();
  });

  it('rounds remaining time up without returning negative values', () => {
    expect(rateLimitSecondsRemaining(8_000, 1_001)).toBe(7);
    expect(rateLimitSecondsRemaining(8_000, 8_000)).toBe(0);
    expect(rateLimitSecondsRemaining(8_000, 9_000)).toBe(0);
    expect(rateLimitSecondsRemaining(null, 1_000)).toBe(0);
  });
});
