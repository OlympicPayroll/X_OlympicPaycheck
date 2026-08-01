import * as SecureStore from 'expo-secure-store';

/**
 * Small, non-sensitive preferences that survive app restarts.
 *
 * Only the email address is ever remembered. The SSN is never persisted here —
 * the sole place it can live is the biometric credential vault (see
 * `biometrics.ts`), and only when the employee explicitly opts in.
 */

const EMAIL_KEY = 'olympic.paycheck.rememberedEmail';

export async function getRememberedEmail(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function setRememberedEmail(email: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(EMAIL_KEY, email);
  } catch {
    // Storage unavailable — remembering the email is a convenience, not a
    // requirement, so failing silently is correct here.
  }
}

export async function clearRememberedEmail(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(EMAIL_KEY);
  } catch {
    // Nothing stored.
  }
}
