import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { useState, type ReactElement, type ReactNode } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { DialogProvider } from '@/lib/dialog';
import { SessionProvider } from '@/lib/session';

/** iPhone-shaped insets, so safe-area consumers lay out realistically. */
const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * The same provider stack as `src/app/_layout.tsx`, minus the navigator —
 * screens under test should see the context they see in the real app.
 *
 * Retries are off: a test asserting an error state shouldn't wait out a retry.
 * `gcTime` is zeroed on both caches — the default five-minute collection timer
 * keeps the Node event loop alive and stops Jest exiting after the run.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false, gcTime: 0 },
        },
      }),
  );

  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <DialogProvider>{children}</DialogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * Renders a screen inside the app's providers.
 *
 * Note: React Native Testing Library v14 is promise-based throughout —
 * `render`, `act`, `fireEvent` and `unmount` all have to be awaited.
 */
export function renderApp(ui: ReactElement) {
  return render(ui, { wrapper: AppProviders });
}
