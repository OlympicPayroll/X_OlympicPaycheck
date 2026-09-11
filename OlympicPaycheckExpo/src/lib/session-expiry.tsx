import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { ApiError, messageFor } from '@/api/types';
import { useDialog } from '@/lib/dialog';
import { useSession } from '@/lib/session';

function isExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SESSION_EXPIRED';
}

/**
 * Signs the employee out when the payroll service stops accepting their sign-in.
 *
 * Without it, every screen shows its own "sign-in expired" error with a Retry
 * that can only fail again. One place watches every request instead, ends the
 * session once, and returns to the login screen. A saved biometric sign-in is
 * kept: the credentials are still good, only the session ended.
 */
export function SessionExpiry() {
  const client = useQueryClient();
  const { signedIn, endSession } = useSession();
  const { confirm } = useDialog();

  useEffect(() => {
    if (!signedIn) return;

    let handled = false;
    const onError = (error: unknown) => {
      if (handled || !isExpired(error)) return;
      handled = true;
      endSession();
      router.replace('/');
      void confirm({
        title: 'Signed out',
        message: messageFor(error),
        confirmText: 'OK',
        cancelText: 'Close',
      });
    };

    const stopQueries = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    const stopMutations = client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });

    return () => {
      stopQueries();
      stopMutations();
    };
  }, [client, signedIn, endSession, confirm]);

  return null;
}
