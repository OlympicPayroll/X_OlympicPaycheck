import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import type { Company, Session } from '@/api/types';

/**
 * Who is signed in, and which company's payroll they're currently viewing.
 *
 * Deliberately in-memory: the SSN is never persisted. When biometric sign-in
 * lands, only an opaque credential goes to the OS keychain — never this state.
 */
type SessionValue = {
  session: Session | null;
  /** The company whose payroll is being viewed (employees may have several). */
  company: Company | null;
  signedIn: boolean;
  startSession: (session: Session) => void;
  selectCompany: (company: Company) => void;
  endSession: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [company, setCompany] = useState<Company | null>(null);

  const startSession = useCallback((next: Session) => {
    setSession(next);
    // Single-company employees skip the picker entirely.
    setCompany(next.companies.length === 1 ? next.companies[0] : null);
  }, []);

  const endSession = useCallback(() => {
    setSession(null);
    setCompany(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      company,
      signedIn: session !== null,
      startSession,
      selectCompany: setCompany,
      endSession,
    }),
    [session, company, startSession, endSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
