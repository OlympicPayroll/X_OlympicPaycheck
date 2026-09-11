import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApi } from '@/api/client';
import type { Session } from '@/api/types';
import { useSession } from '@/lib/session';

/**
 * Query keys, centralised so cache invalidation stays consistent.
 * Shape: [entity, ...identifiers]
 */
export const queryKeys = {
  latestPaycheck: (employeeId: string) => ['latestPaycheck', employeeId] as const,
  payYears: (employeeId: string) => ['payYears', employeeId] as const,
  paychecks: (employeeId: string, year: number) => ['paychecks', employeeId, year] as const,
  /** Prefix covering every cached year for one employee. */
  paychecksForEmployee: (employeeId: string) => ['paychecks', employeeId] as const,
  stub: (companyId: string, paycheckId: string) => ['stub', companyId, paycheckId] as const,
  checksForDate: (employeeId: string, payDateIso: string) => ['checksForDate', employeeId, payDateIso] as const,
  combinedStub: (employeeId: string, payDateIso: string) => ['combinedStub', employeeId, payDateIso] as const,
  photo: (employeeId: string) => ['photo', employeeId] as const,
  taxDocuments: (employeeId: string) => ['taxDocuments', employeeId] as const,
  w2: (employeeId: string, documentId: string) => ['w2', employeeId, documentId] as const,
};

/** The employee id scoped to the currently selected company. */
function useEmployeeId(): string | undefined {
  const { company } = useSession();
  return company?.employeeId;
}

export function useSignIn(onSuccess?: (session: Session) => void) {
  const { startSession } = useSession();
  return useMutation({
    mutationFn: (params: { email: string; ssnLast4?: string; ssnFull?: string }) => getApi().signIn(params),
    onSuccess: (session) => {
      startSession(session);
      onSuccess?.(session);
    },
  });
}

export function useLatestPaycheck() {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.latestPaycheck(employeeId ?? ''),
    queryFn: () => getApi().getLatestPaycheck({ employeeId: employeeId! }),
    enabled: !!employeeId,
  });
}

export function usePayYears() {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.payYears(employeeId ?? ''),
    queryFn: () => getApi().getPayYears({ employeeId: employeeId! }),
    enabled: !!employeeId,
  });
}

export function usePaychecks(year: number | undefined) {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.paychecks(employeeId ?? '', year ?? 0),
    queryFn: () => getApi().getPaychecks({ employeeId: employeeId!, year: year! }),
    enabled: !!employeeId && !!year,
  });
}

export function useStub(paycheckId: string | undefined) {
  const { company } = useSession();
  const companyId = company?.id;
  return useQuery({
    queryKey: queryKeys.stub(companyId ?? '', paycheckId ?? ''),
    queryFn: () => getApi().getStub({ companyId: companyId!, paycheckId: paycheckId! }),
    enabled: !!companyId && !!paycheckId,
  });
}

export function useChecksForDate(payDateIso: string | undefined) {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.checksForDate(employeeId ?? '', payDateIso ?? ''),
    queryFn: () => getApi().getChecksForDate({ employeeId: employeeId!, payDateIso: payDateIso! }),
    enabled: !!employeeId && !!payDateIso,
  });
}

export function useCombinedStub(payDateIso: string | undefined) {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.combinedStub(employeeId ?? '', payDateIso ?? ''),
    queryFn: () => getApi().getCombinedStub({ employeeId: employeeId!, payDateIso: payDateIso! }),
    enabled: !!employeeId && !!payDateIso,
  });
}

/** Clears the NEW badge, then refreshes every view that renders one. */
export function useMarkPaycheckRead() {
  const employeeId = useEmployeeId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { sentId: string }) => getApi().markPaycheckRead(params),
    onSuccess: () => {
      if (!employeeId) return;
      // History shows the same NEW badge as the Dashboard, so invalidating
      // only the dashboard query left the badge up on the other screen. The
      // year isn't known here, hence the prefix match across every cached
      // year for this employee.
      qc.invalidateQueries({ queryKey: queryKeys.latestPaycheck(employeeId) });
      qc.invalidateQueries({ queryKey: queryKeys.paychecksForEmployee(employeeId) });
    },
  });
}

export function useEmailStub() {
  return useMutation({
    mutationFn: (params: { sentId: string }) => getApi().emailStub(params),
  });
}

export function useTaxDocuments() {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.taxDocuments(employeeId ?? ''),
    queryFn: () => getApi().getTaxDocuments({ employeeId: employeeId! }),
    enabled: !!employeeId,
  });
}

export function useW2(documentId: string | undefined) {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.w2(employeeId ?? '', documentId ?? ''),
    queryFn: () => getApi().getW2({ employeeId: employeeId!, documentId: documentId! }),
    enabled: !!employeeId && !!documentId,
  });
}

export function usePhoto() {
  const employeeId = useEmployeeId();
  return useQuery({
    queryKey: queryKeys.photo(employeeId ?? ''),
    queryFn: () => getApi().getPhoto({ employeeId: employeeId! }),
    enabled: !!employeeId,
  });
}

export function useUploadPhoto() {
  const employeeId = useEmployeeId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { base64: string }) => getApi().uploadPhoto({ employeeId: employeeId!, ...params }),
    onSuccess: () => {
      if (employeeId) qc.invalidateQueries({ queryKey: queryKeys.photo(employeeId) });
    },
  });
}
