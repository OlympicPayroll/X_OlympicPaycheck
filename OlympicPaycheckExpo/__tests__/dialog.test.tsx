import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { DialogProvider, useDialog } from '@/lib/dialog';

/**
 * Android dialogs are a single in-app modal, so a request that arrives while
 * one is showing must retire the earlier one rather than strand whoever is
 * still awaiting its answer.
 */

/** `Platform.OS` is a plain property on the RN Platform object. */
function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

afterEach(() => setPlatform('ios'));

async function renderDialogs() {
  let api!: ReturnType<typeof useDialog>;
  function Capture() {
    api = useDialog();
    return null;
  }

  const view = await render(
    <DialogProvider>
      <Capture />
    </DialogProvider>,
  );
  return { view, dialogs: () => api };
}

it('settles an earlier confirmation as dismissed when a newer one replaces it', async () => {
  setPlatform('android');
  const { view, dialogs } = await renderDialogs();

  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  await act(async () => {
    first = dialogs().confirm({ title: 'First' });
  });
  await act(async () => {
    second = dialogs().confirm({ title: 'Second', confirmText: 'Send' });
  });

  await expect(first).resolves.toBe(false);
  expect(view.getByText('Second')).toBeTruthy();

  await fireEvent.press(view.getByText('Send'));
  await expect(second).resolves.toBe(true);
});

it('settles an earlier choice as dismissed too', async () => {
  setPlatform('android');
  const { dialogs } = await renderDialogs();

  let first!: Promise<number | null>;
  await act(async () => {
    first = dialogs().choose({ title: 'Pick one', options: ['Camera', 'Library'] });
  });
  await act(async () => {
    void dialogs().confirm({ title: 'Something else' });
  });

  await expect(first).resolves.toBeNull();
});
