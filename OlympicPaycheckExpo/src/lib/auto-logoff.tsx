import { router } from 'expo-router';
import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';

import { useSession } from '@/lib/session';

/**
 * Signs the employee out after a period of inactivity, so pay information isn't
 * left on screen on an unattended or borrowed phone. The legacy app did the
 * same thing with a timer on the report screen.
 *
 * Two triggers:
 *   • No touch anywhere in the app for IDLE_MS.
 *   • The app spent longer than IDLE_MS in the background.
 */
const IDLE_MS = 5 * 60 * 1000;

export function AutoLogoff({ children }: { children: ReactNode }) {
  const { signedIn, endSession } = useSession();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftAt = useRef<number | null>(null);

  const signOut = useCallback(() => {
    endSession();
    router.replace('/');
  }, [endSession]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!signedIn) return;
    timer.current = setTimeout(signOut, IDLE_MS);
  }, [signedIn, signOut]);

  // (Re)start the countdown whenever sign-in state changes.
  useEffect(() => {
    reset();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reset]);

  // Time spent in the background counts toward the timeout.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!signedIn) return;

      if (state === 'background' || state === 'inactive') {
        leftAt.current = Date.now();
        if (timer.current) clearTimeout(timer.current);
        return;
      }

      if (state === 'active') {
        const since = leftAt.current;
        leftAt.current = null;
        if (since && Date.now() - since >= IDLE_MS) signOut();
        else reset();
      }
    });
    return () => sub.remove();
  }, [signedIn, signOut, reset]);

  return (
    // Capture-phase handler: notices every touch without consuming it, so
    // buttons and scrolling behave normally.
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        reset();
        return false;
      }}
    >
      {children}
    </View>
  );
}
