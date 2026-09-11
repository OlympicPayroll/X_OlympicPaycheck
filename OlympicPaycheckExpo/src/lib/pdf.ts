import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { LOGO_PNG_BASE64 } from '@/lib/logo-data';

import PdfViewer from '../../modules/pdf-viewer';

/**
 * Turning a document into a PDF the employee can keep.
 *
 * The OS print engine renders it on the phone from HTML built in
 * `documents.ts`. Nothing is uploaded anywhere: the file is written to the
 * app's cache and leaves it only through the share sheet, or a folder the
 * employee picks.
 */

/** US Letter at 72 points per inch, the size payroll documents print at. */
const LETTER = { width: 612, height: 792 };

/** No app on the phone can show a PDF. */
export class NoPdfViewerError extends Error {
  constructor() {
    super('No app on this phone can open a PDF');
    this.name = 'NoPdfViewerError';
  }
}

/** A file name that is safe everywhere: letters, digits and hyphens. */
export function pdfFileName(...parts: (string | number)[]): string {
  const stem = parts
    .map(String)
    .join('-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${stem || 'document'}.pdf`;
}

/** Render HTML to a PDF in the cache, named for what it is. */
export async function renderPdf(html: string, fileName: string): Promise<File> {
  const { uri } = await Print.printToFileAsync({
    html,
    ...LETTER,
    // iOS takes page margins here; Android reads the @page rule in the HTML.
    margins: { top: 28, bottom: 28, left: 32, right: 32 },
  });

  // The print engine picks a random name, and a saved "5F2C1A.pdf" tells the
  // employee nothing about what it is.
  const named = new File(Paths.cache, fileName);
  if (named.exists) named.delete();
  new File(uri).move(named);
  return named;
}

/** Hand the PDF to the OS share sheet: Save to Files, Drive, Mail and so on. */
export async function sharePdf(file: File, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
}

/**
 * Write the PDF into a folder the employee picks, usually Downloads.
 *
 * Used on Android, whose share sheet has no dependable "save a copy" target;
 * iOS's always offers Save to Files. Resolves with the saved copy's URI, or
 * null when the employee closes the picker without choosing a folder.
 */
export async function savePdfToFolder(file: File, fileName: string): Promise<string | null> {
  let folder: Awaited<ReturnType<typeof Directory.pickDirectoryAsync>>;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    // The picker reports being dismissed as an error.
    return null;
  }
  const saved = folder.createFile(fileName, 'application/pdf');
  saved.write(await file.bytes());
  return saved.uri;
}

/**
 * Open a saved PDF in whichever app the phone uses for PDFs.
 *
 * Android only, through the app's own module (`modules/pdf-viewer`). It grants
 * the viewer read access to the saved copy and opens it as an app of its own,
 * and nothing waits for the viewer to close, so leaving it open never blocks
 * the next Open. Rejects with NoPdfViewerError when no installed app can show
 * a PDF.
 */
export async function openPdf(uri: string): Promise<void> {
  if (!PdfViewer) throw new Error('Opening a PDF is not available in this build');
  try {
    await PdfViewer.open(uri);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ERR_NO_PDF_VIEWER') throw new NoPdfViewerError();
    throw error;
  }
}

/** The torch logo as a data URI, ready to place in a document's HTML. */
export function logoDataUri(): string {
  return `data:image/png;base64,${LOGO_PNG_BASE64}`;
}
