import { act, fireEvent, waitFor } from '@testing-library/react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Alert, type AlertButton } from 'react-native';

import { mockApi } from '@/api/mock';
import { ApiError } from '@/api/types';
import StubScreen from '@/app/stub';
import { usd } from '@/lib/format';

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
let answers: (title: string) => 'confirm' | 'cancel' | 'hold';

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
    const choice = answers(String(title));
    if (choice === 'hold') return; // Left on screen for the test to answer.
    (choice === 'confirm' ? confirm : cancel)?.onPress?.();
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
  /**
   * Wait until the whole email interaction has finished.
   *
   * A tap only starts it: the confirmation, the send and any retry dialogs play
   * out afterwards, and the action re-enables itself at the very end. Waiting
   * for that keeps the interaction's last state update inside the test.
   */
  async function emailFinished(app: Awaited<ReturnType<typeof openStub>>) {
    await waitFor(() =>
      expect(app.getByLabelText('Email a copy').props.accessibilityState).toMatchObject({ disabled: false }),
    );
  }

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
    await emailFinished(app);
  });

  it('confirms once it has gone', async () => {
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(titles()).toContain('Pay stub sent'));
    await emailFinished(app);
  });

  it('does not send when the employee backs out of the confirmation', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    answers = () => 'cancel';
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(titles()).toContain('Email this pay stub?'));
    expect(email).not.toHaveBeenCalled();
    await emailFinished(app);
  });

  /** A failed send used to close the sheet in silence. */
  it('says so when the send fails', async () => {
    jest.spyOn(mockApi, 'emailStub').mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));
    answers = (title) => (title === 'We couldn’t send it' ? 'cancel' : 'confirm');
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(titles()).toContain('We couldn’t send it'));
    expect(titles()).not.toContain('Pay stub sent');
    await emailFinished(app);
  });

  it('offers a retry that actually re-sends', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    email.mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });

    await fireEvent.press(await app.findByLabelText('Email a copy'));

    await waitFor(() => expect(email).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(titles()).toContain('Pay stub sent'));
    await emailFinished(app);
  });

  /**
   * The confirmation itself is the gap: nothing is in flight while it is on
   * screen, so a guard keyed on the request alone let a second tap open a
   * second confirmation and send the stub twice.
   */
  it('does not open a second confirmation while the first is still showing', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    answers = (title) => (title === 'Email this pay stub?' ? 'hold' : 'confirm');
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });
    const button = await app.findByLabelText('Email a copy');

    await fireEvent.press(button);
    await fireEvent.press(button);

    expect(titles().filter((t) => t === 'Email this pay stub?')).toHaveLength(1);

    const send = dialogs[0].buttons.find((b) => b.style !== 'cancel');
    await act(async () => send?.onPress?.());

    await waitFor(() => expect(titles()).toContain('Pay stub sent'));
    await emailFinished(app);
    expect(email).toHaveBeenCalledTimes(1);
  });

  it('ignores repeat taps while a send is still in flight', async () => {
    const email = jest.spyOn(mockApi, 'emailStub');
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID });
    const button = await app.findByLabelText('Email a copy');

    await fireEvent.press(button);
    await fireEvent.press(button);
    await fireEvent.press(button);

    await waitFor(() => expect(titles()).toContain('Pay stub sent'));
    await emailFinished(app);
    expect(email).toHaveBeenCalledTimes(1);
  });
});

describe('downloading a PDF', () => {
  /** Wait for the export to finish: the action re-enables itself at the very end. */
  async function downloadFinished(app: Awaited<ReturnType<typeof openStub>>) {
    await waitFor(() =>
      expect(app.getByLabelText('Download PDF').props.accessibilityState).toMatchObject({ disabled: false }),
    );
  }

  /** Unlike email, saving a copy needs nothing from the payroll service. */
  it('is offered even when there is no delivery to email', async () => {
    const app = await openStub({ id: CHECK_ID });
    await app.findByText('Earnings');

    expect(app.getByLabelText('Download PDF')).toBeTruthy();
    expect(app.queryByLabelText('Email a copy')).toBeNull();
  });

  it('names the PDF for its pay date and hands it to the share sheet', async () => {
    const app = await openStub({ id: CHECK_ID, sentId: SENT_ID, date: '2026-07-18' });

    await fireEvent.press(await app.findByLabelText('Download PDF'));

    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    const [uri, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
    expect(uri).toMatch(/\/Pay-Stub-2026-07-18\.pdf$/);
    expect(options).toMatchObject({ mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    await downloadFinished(app);
  });

  it('prints the same figures the screen shows', async () => {
    const stub = await mockApi.getStub({ companyId: 'CA-1041', paycheckId: CHECK_ID });
    const app = await openStub({ id: CHECK_ID });

    await fireEvent.press(await app.findByLabelText('Download PDF'));

    await waitFor(() => expect(Print.printToFileAsync).toHaveBeenCalled());
    const { html } = (Print.printToFileAsync as jest.Mock).mock.calls[0][0];
    expect(html).toContain('Earnings statement');
    expect(html).toContain('Cascade Coffee Roasters');
    expect(html).toContain('Sarah Mitchell');
    for (const figure of [stub.net, stub.gross, stub.taxTotal, stub.ytd.net]) {
      expect(html).toContain(usd(figure));
    }
    expect(html).toContain('data:image/png;base64,');
    await downloadFinished(app);
  });

  /** A PDF can be emailed and filed long after it leaves the app, so it carries its own warning. */
  it('marks a PDF made from sample data', async () => {
    const app = await openStub({ id: CHECK_ID });

    await fireEvent.press(await app.findByLabelText('Download PDF'));

    await waitFor(() => expect(Print.printToFileAsync).toHaveBeenCalled());
    expect((Print.printToFileAsync as jest.Mock).mock.calls[0][0].html).toContain('SAMPLE DATA');
    await downloadFinished(app);
  });

  it('says so when the PDF cannot be made', async () => {
    (Print.printToFileAsync as jest.Mock).mockRejectedValueOnce(new Error('print engine failed'));
    const app = await openStub({ id: CHECK_ID });

    await fireEvent.press(await app.findByLabelText('Download PDF'));

    await waitFor(() => expect(titles()).toContain('We couldn’t create the PDF'));
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    await downloadFinished(app);
  });

  it('ignores repeat taps while a PDF is still being made', async () => {
    let finish!: () => void;
    (Sharing.shareAsync as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const app = await openStub({ id: CHECK_ID });
    const button = await app.findByLabelText('Download PDF');

    await fireEvent.press(button);
    await fireEvent.press(button);
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));

    await act(async () => finish());
    await downloadFinished(app);
    expect(Print.printToFileAsync).toHaveBeenCalledTimes(1);
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
