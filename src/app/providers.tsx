'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/interview-contract';

const shouldRetry = (failureCount: number, error: unknown) => {
  if (error instanceof ApiError && error.statusCode && error.statusCode < 500) {
    return false;
  }
  return failureCount < 1;
};

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: shouldRetry, refetchOnWindowFocus: false },
          mutations: { retry: shouldRetry },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

