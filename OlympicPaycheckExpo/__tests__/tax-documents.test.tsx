import { fireEvent, waitFor } from '@testing-library/react-native';
import { Directory } from 'expo-file-system';
import { router } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Alert, Platform, type AlertButton } from 'react-native';

import { mockApi } from '@/api/mock';
import { ApiError } from '@/api/types';
import HomeScreen from '@/app/(tabs)/home';
import TaxDocumentsScreen from '@/app/tax-documents';
import W2Screen from '@/app/w2';
import { usd } from '@/lib/format';

import PdfViewer from '../modules/pdf-viewer';
import { renderSignedIn } from './test-utils';

/**
 * Annual Tax Documents: finding a W-2, reading it, and keeping it as a PDF.
 *
 * The PDF is checked through the HTML handed to the print engine, which is the
 * document itself: what goes in there is what the employee files.
 */

jest.setTimeout(30_000);

const push = router.push as jest.Mock;
const { __setParams } = jest.requireMock('expo-router') as { __setParams: (p: object) => void };
const printToFile = Print.printToFileAsync as jest.Mock;
const share = Sharing.shareAsync as jest.Mock;
const pickDirectory = (Directory as unknown as { pickDirectoryAsync: jest.Mock }).pickDirectoryAsync;
const openInViewer = PdfViewer!.open as jest.Mock;

const EMPLOYEE = 'E-88214';

/** `Platform.OS` is a plain property on the RN Platform object. */
function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

/** Native alert titles raised during a test (iOS dialogs). */
let alerts: string[] = [];

beforeEach(() => {
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    alerts.push(String(title));
    const list = (buttons ?? []) as AlertButton[];
    (list.find((b) => b.style === 'cancel') ?? list[0])?.onPress?.();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  setPlatform('ios');
});

/** An issued W-2 straight from the backend, to compare the screen against. */
async function issuedW2(year = 2025) {
  const docs = await mockApi.getTaxDocuments({ employeeId: EMPLOYEE });
  const doc = docs.find((d) => d.taxYear === year)!;
  return mockApi.getW2({ employeeId: EMPLOYEE, documentId: doc.id });
}

async function openList() {
  const app = await renderSignedIn(<TaxDocumentsScreen />);
  await app.findByText('Tax Documents');
  await app.settle();
  return app;
}

async function openW2(id: string, year = 2025) {
  __setParams({ id });
  const app = await renderSignedIn(<W2Screen />);
  await app.findByText(`${year} W-2`);
  await app.settle();
  return app;
}

/** Wait for an export to finish: the action re-enables itself at the very end. */
async function downloadFinished(app: Awaited<ReturnType<typeof openW2>>) {
  await waitFor(() =>
    expect(app.getByLabelText('Download PDF').props.accessibilityState).toMatchObject({ disabled: false }),
  );
}

/** The HTML of the one document printed so far. */
async function printedHtml(): Promise<string> {
  await waitFor(() => expect(printToFile).toHaveBeenCalledTimes(1));
  return printToFile.mock.calls[0][0].html;
}

describe('finding tax documents', () => {
  it('opens from the dashboard', async () => {
    const app = await renderSignedIn(<HomeScreen />);
    await app.findByText('Dashboard');
    await app.settle();

    await fireEvent.press(app.getByText('Annual Tax Documents'));

    expect(push).toHaveBeenCalledWith('/tax-documents');
  });

  it('lists each issued W-2 by year, with the date it was issued', async () => {
    const app = await openList();

    for (const year of [2025, 2024, 2023]) {
      expect(app.getByText(`${year} Form W-2`)).toBeTruthy();
    }
    expect(app.getByText('Issued Feb 2, 2026')).toBeTruthy();
  });

  /** Listed so the employee knows it is coming, and when. */
  it('shows this year’s W-2 as pending, with the date it is due', async () => {
    const app = await openList();

    expect(app.getByText('2026 Form W-2')).toBeTruthy();
    expect(app.getByText('Ready by Feb 1, 2027')).toBeTruthy();
    expect(app.getByText('PENDING')).toBeTruthy();
  });

  it('opens an issued W-2', async () => {
    const app = await openList();

    await fireEvent.press(app.getByText('2025 Form W-2'));

    expect(push).toHaveBeenCalledWith({ pathname: '/w2', params: { id: 'W2-2025-E-88214' } });
  });

  it('does not open one that has not been issued', async () => {
    const app = await openList();

    await fireEvent.press(app.getByText('2026 Form W-2'));

    expect(push).not.toHaveBeenCalled();
  });

  it('offers a retry when the list cannot load', async () => {
    jest.spyOn(mockApi, 'getTaxDocuments').mockRejectedValue(new ApiError('NETWORK', 'offline'));

    const app = await renderSignedIn(<TaxDocumentsScreen />);

    expect(await app.findByText(/no internet connection/i)).toBeTruthy();
  });
});

describe('reading a W-2', () => {
  it('leads with taxable wages and the tax withheld', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    expect(app.getAllByText(usd(w2.wages)).length).toBeGreaterThan(0);
    expect(app.getAllByText(usd(w2.federalIncomeTax)).length).toBeGreaterThan(0);
    expect(app.getByText('NJ tax withheld')).toBeTruthy();
  });

  it('shows every federal box with its official label', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    for (const label of [
      'Wages, tips, other compensation',
      'Federal income tax withheld',
      'Social security wages',
      'Social security tax withheld',
      'Medicare wages and tips',
      'Medicare tax withheld',
    ]) {
      expect(app.getByText(label)).toBeTruthy();
    }
    expect(app.getAllByText(usd(w2.medicareTax)).length).toBeGreaterThan(0);
  });

  /** Codes like "D" and "FLI" mean nothing to most employees on their own. */
  it('explains box 12 and box 14 codes in plain English', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    expect(app.getByText('Elective deferrals to a 401(k) plan')).toBeTruthy();
    expect(app.getByText('Code D')).toBeTruthy();
    expect(app.getByText('NJ family leave insurance')).toBeTruthy();
    expect(app.getByText('FLI')).toBeTruthy();
  });

  it('shows only the last four digits of the Social Security number', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    expect(app.getByText('XXX-XX-4821')).toBeTruthy();
  });

  it('names the employer and its identification numbers', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    expect(app.getByText(w2.employer.ein)).toBeTruthy();
    expect(app.getByText(w2.states[0].employerStateId)).toBeTruthy();
  });
});

describe('downloading a W-2 as a PDF', () => {
  it('hands the form to the share sheet, named for the year and employer', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    await fireEvent.press(app.getByLabelText('Download PDF'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [uri, options] = share.mock.calls[0];
    expect(uri).toMatch(/\/W-2-2025-Cascade-Coffee-Roasters\.pdf$/);
    expect(options).toMatchObject({ mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    await downloadFinished(app);
  });

  it('prints the employee copies of the form, with the figures from the screen', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    await fireEvent.press(app.getByLabelText('Download PDF'));

    const html = await printedHtml();
    expect(html).toContain('Wage and Tax Statement');
    for (const copy of ['Copy B', 'Copy C', 'Copy 2']) {
      expect(html).toContain(copy);
    }
    const formAmount = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const figure of [w2.wages, w2.federalIncomeTax, w2.socialSecurityWages, w2.states[0].incomeTax]) {
      expect(html).toContain(formAmount(figure));
    }
    expect(html).toContain(w2.employer.ein);
    await downloadFinished(app);
  });

  it('never prints a full Social Security number', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    await fireEvent.press(app.getByLabelText('Download PDF'));

    const html = await printedHtml();
    expect(html).toContain('XXX-XX-4821');
    expect(html).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    await downloadFinished(app);
  });

  it('marks a PDF made from sample data', async () => {
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    await fireEvent.press(app.getByLabelText('Download PDF'));

    expect(await printedHtml()).toContain('SAMPLE DATA');
    await downloadFinished(app);
  });

  it('says so when the PDF cannot be made', async () => {
    printToFile.mockRejectedValueOnce(new Error('print engine failed'));
    const w2 = await issuedW2();
    const app = await openW2(w2.id);

    await fireEvent.press(app.getByLabelText('Download PDF'));

    await waitFor(() => expect(alerts).toContain('We couldn’t create the PDF'));
    expect(share).not.toHaveBeenCalled();
    await downloadFinished(app);
  });

  describe('on Android', () => {
    /** Android's share sheet has no dependable save target, so it also offers a folder. */
    it('saves into a folder the employee picks, then offers to open it', async () => {
      const w2 = await issuedW2();
      const app = await openW2(w2.id);
      setPlatform('android');

      await fireEvent.press(app.getByLabelText('Download PDF'));
      await fireEvent.press(await app.findByText('Save to phone'));

      expect(await app.findByText('PDF saved to your phone')).toBeTruthy();
      expect(pickDirectory).toHaveBeenCalledTimes(1);
      expect(share).not.toHaveBeenCalled();
      await downloadFinished(app);

      await fireEvent.press(app.getByText('Open'));

      expect(openInViewer).toHaveBeenCalledWith('content://downloads/W-2-2025-Cascade-Coffee-Roasters.pdf');
      expect(app.queryByText('PDF saved to your phone')).toBeNull();
    });

    it('explains when the phone has no app that can open a PDF', async () => {
      // What the app's Android module reports when nothing installed can show a PDF.
      openInViewer.mockRejectedValueOnce(
        Object.assign(new Error('No app on this phone can open a PDF'), { code: 'ERR_NO_PDF_VIEWER' }),
      );
      const w2 = await issuedW2();
      const app = await openW2(w2.id);
      setPlatform('android');

      await fireEvent.press(app.getByLabelText('Download PDF'));
      await fireEvent.press(await app.findByText('Save to phone'));
      await fireEvent.press(await app.findByText('Open'));

      expect(await app.findByText('No app to open PDFs')).toBeTruthy();
      await fireEvent.press(app.getByText('OK'));
      await downloadFinished(app);
    });

    /** For example a storage provider refusing to hand the saved file over. */
    it('does not blame the phone’s apps when the viewer fails to start for another reason', async () => {
      openInViewer.mockRejectedValueOnce(new Error('Permission Denial: opening provider'));
      const w2 = await issuedW2();
      const app = await openW2(w2.id);
      setPlatform('android');

      await fireEvent.press(app.getByLabelText('Download PDF'));
      await fireEvent.press(await app.findByText('Save to phone'));
      await fireEvent.press(await app.findByText('Open'));

      expect(await app.findByText('We couldn’t open the PDF')).toBeTruthy();
      expect(app.queryByText('No app to open PDFs')).toBeNull();
      await fireEvent.press(app.getByText('OK'));
      await downloadFinished(app);
    });

    it('can still share instead', async () => {
      const w2 = await issuedW2();
      const app = await openW2(w2.id);
      setPlatform('android');

      await fireEvent.press(app.getByLabelText('Download PDF'));
      await fireEvent.press(await app.findByText('Share'));

      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      expect(pickDirectory).not.toHaveBeenCalled();
      await downloadFinished(app);
    });

    it('saves nothing, and says nothing, when the folder picker is closed', async () => {
      pickDirectory.mockRejectedValueOnce(new Error('Picker was cancelled'));
      const w2 = await issuedW2();
      const app = await openW2(w2.id);
      setPlatform('android');

      await fireEvent.press(app.getByLabelText('Download PDF'));
      await fireEvent.press(await app.findByText('Save to phone'));

      await downloadFinished(app);
      expect(pickDirectory).toHaveBeenCalledTimes(1);
      expect(app.queryByText('PDF saved to your phone')).toBeNull();
      expect(app.queryByText('We couldn’t create the PDF')).toBeNull();
    });
  });
});
