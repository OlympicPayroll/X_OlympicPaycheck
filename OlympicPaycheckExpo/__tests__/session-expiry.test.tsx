import { useQuery } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, Text, type AlertButton } from 'react-native';

import { ApiError, type ApiErrorCode } from '@/api/types';
import { SessionExpiry } from '@/lib/session-expiry';

import { renderSignedIn } from './test-utils';

/**
 * When the payroll service stops accepting a sign-in, the app signs the
 * employee out once and returns to the login screen, rather than leaving every
 * screen with its own error and a Retry that can only fail again.
 */

const replace = router.replace as jest.Mock;

let alerts: string[] = [];

beforeEach(() => {
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    alerts.push(String(title));
    ((buttons ?? []) as AlertButton[])[0]?.onPress?.();
  });
});

afterEach(() => jest.restoreAllMocks());

/** A screen whose data request fails with the given error. */
function Failing({ code, id }: { code: ApiErrorCode; id: string }) {
  useQuery({
    queryKey: ['probe', id],
    queryFn: async () => {
      throw new ApiError(code, 'probe');
    },
  });
  return <Text>probe</Text>;
}

it('signs the employee out and returns to the login screen', async () => {
  await renderSignedIn(
    <>
      <SessionExpiry />
      <Failing code="SESSION_EXPIRED" id="a" />
    </>,
  );

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  expect(alerts).toEqual(['Signed out']);
});

it('does it once, however many requests fail together', async () => {
  await renderSignedIn(
    <>
      <SessionExpiry />
      <Failing code="SESSION_EXPIRED" id="a" />
      <Failing code="SESSION_EXPIRED" id="b" />
    </>,
  );

  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(replace).toHaveBeenCalledTimes(1);
  expect(alerts).toHaveLength(1);
});

it('leaves every other failure to the screen that saw it', async () => {
  const app = await renderSignedIn(
    <>
      <SessionExpiry />
      <Failing code="NETWORK" id="a" />
    </>,
  );

  await app.settle();

  expect(replace).not.toHaveBeenCalled();
  expect(alerts).toHaveLength(0);
});
