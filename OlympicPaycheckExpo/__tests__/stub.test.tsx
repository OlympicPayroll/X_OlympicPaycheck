import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { mockApi } from '@/api/mock';
import { ApiError } from '@/api/types';
import StubScreen from '@/app/stub';

import { renderSignedIn } from './test-utils';

/**
 * The pay stub screen's two side effects: clearing the NEW badge, and emailing
 * a copy. Both act on a *delivery* id, and both used to fail quietly — email
 * swallowed its error entirely, and a payroll with no delivery id had one
 * invented for it out of the pay-period id.
 */

jest.setTimeout(30_000);

const { __setParams } = jest.requireMock('expo-router') as { __setParams: (p: object) => void };

const SENT_ID = 'S-20260718-E-88214';
const CHECK_ID = 'H-20260718-regular-E-88214';
const BONUS_ID = 'H-20260718-bonus-E-88214';

/** Dialogs raised during a test, newest last. */
let dialogs: { title: string; buttons: AlertButton[] }[] = [];
/** How to answer each dialog, by title fragment. Default: press confirm. */
let answers: (title: string) => 'confirm' | 'cancel';

beforeEach(() => {
  dialogs = [];
  answers = () => 'confirm';

  // DialogProvider uses the real UIAlertController path on iOS, which does
  // nothing in a test runner and would leave every `confirm()` pending. Drive
  // it instead of mocking the app's own dialog layer.
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    const list = (buttons ?? []) as AlertButton[];
    dialogs.push({ title: String(title), buttons: list });
    const cancel = list.find((b) => b.style === 'cancel') ?? list[0];
    const confirm = list.find((b) => b.style !== 'cancel') ?? list[list.length - 1];
    (answers(String(title)) === 'confirm' ? confirm : cancel)?.onPress?.();
  });
});

afterEach(() => jest.restoreAllMocks());

const titles = () => dialogs.map((d) => d.title);

async function openStub(params: Record<string, string>) {
  __setParams(params);
  const app = await renderSignedIn(<StubScreen />);
  await app.findByText('Pay Stub');
  await app.settle();
  return app;
}

describe('marking the payroll read', () => {
  it('marks the delivery read once the stub is on screen', async () => {
    const markRead = jest.spyOn(mockApi, 'markPaycheckRead');

    await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await waitFor(() => expect(markRead).toHaveBeenCalledWith({ sentId: SENT_ID }));
  });

  /**
   * A history row with no delivery has nothing to mark. Sending the pay-period
   * id instead — which the screen used to do for email — would address a
   * different record entirely.
   */
  it('marks nothing when the payroll was never delivered', async () => {
    const markRead = jest.spyOn(mockApi, 'markPaycheckRead');

    await openStub({ id: CHECK_ID });

    await waitFor(() => expect(markRead).not.toHaveBeenCalled());
  });
});

describe('emailing a copy', () => {
  it('offers the action when there is a delivery to re-send', async () => {
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    expect(await app.findByLabelText('Email a copy')).toBeTruthy();
  });

  /**
   * Better to withhold the action than to offer it and fail: without a
   * delivery id there is nothing the payroll service can be asked to re-send.
   */
  it('withholds it when the payroll has no delivery id', async () => {
    const app = await openStub({ id: CHECK_ID });
    await app.findByText('Earnings');

    expect(app.queryByLabelText('Email a copy')).toBeNull();
  });

  it('sends the delivery id, never the pay-period id', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(email).toHaveBeenCalledWith({ sentId: SENT_ID }));
    expect(email).not.toHaveBeenCalledWith({ sentId: CHECK_ID });
  });

  it('confirms once it has gone', async () => {
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(titles()).toContain('Pay stub sent'));
  });

  it('does not send when the employee backs out of the confirmation', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    answers = () => 'cancel';
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(titles()).toContain('Email this pay stub?'));
    expect(email).not.toHaveBeenCalled();
  });

  /** A failed send used to close the sheet in silence. */
  it('says so when the send fails', async () => {
    jest.spyOn(mockApi, 'emailStub').mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));
    answers = (title) => (title === 'We couldn’t send it' ? 'cancel' : 'confirm');
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(titles()).toContain('We couldn’t send it'));
    expect(titles()).not.toContain('Pay stub sent');
  });

  it('offers a retry that actually re-sends', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    email.mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(email).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(titles()).toContain('Pay stub sent'));
  });

  it('ignores repeat taps while a send is still in flight', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });
    const button = await app.findByLabelText('Email a copy');

    await fireEvent.press(button);
    await fireEvent.press(button);
    await fireEvent.press(button);

    await waitFor(() => expect(titles()).toContain('Pay stub sent'));
    expect(email).toHaveBeenCalledTimes(1);
  });
});

describe('labelling the headline amount', () => {
  it('says the pay was deposited when it was', async () => {
    const app = await openStub({ id: CHECK_ID });

    expect(await app.findByText('NET PAY DEPOSITED')).toBeTruthy();
  });

  /**
   * Bonus runs are cut on paper in these fixtures, and telling an employee
   * their paper check was deposited is simply false.
   */
  it('does not claim a paper check was deposited', async () => {
    const app = await openStub({ id: BONUS_ID });
    await app.findByText('Earnings');

    expect(app.queryByText('NET PAY DEPOSITED')).toBeNull();
    expect(app.getByText('NET PAY')).toBeTruthy();
  });

  it('still labels the year-to-date total independently', async () => {
    const app = await openStub({ id: BONUS_ID });

    await fireEvent.press(await app.findByText('Year to date'));

    expect(await app.findByText('NET PAY THIS YEAR')).toBeTruthy();
  });
});
