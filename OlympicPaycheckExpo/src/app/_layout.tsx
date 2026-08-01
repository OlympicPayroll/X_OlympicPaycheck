import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AutoLogoff } from '@/lib/auto-logoff';
import { DialogProvider } from '@/lib/dialog';
import { SessionProvider } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <DialogProvider>
            <AutoLogoff>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
                <Stack.Screen name="index" options={{ animation: 'fade' }} />
                <Stack.Screen name="unlock" options={{ animation: 'fade' }} />
                <Stack.Screen name="companies" />
                <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                <Stack.Screen name="checks" />
                <Stack.Screen name="stub" />
                <Stack.Screen name="legal" />
              </Stack>
            </AutoLogoff>
          </DialogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
