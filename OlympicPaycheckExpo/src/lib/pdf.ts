import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

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
 * iOS's always offers Save to Files. Resolves false when the employee closes
 * the picker without choosing a folder.
 */
export async function savePdfToFolder(file: File, fileName: string): Promise<boolean> {
  let folder: Awaited<ReturnType<typeof Directory.pickDirectoryAsync>>;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    // The picker reports being dismissed as an error.
    return false;
  }
  folder.createFile(fileName, 'application/pdf').write(await file.bytes());
  return true;
}

/**
 * The torch logo as a data URI.
 *
 * The iOS print engine cannot load bundled assets by URL, so images have to
 * travel inside the HTML. A document is still complete without its logo, so
 * any failure here just leaves it out.
 */
export async function logoDataUri(): Promise<string | undefined> {
  try {
    const asset = await Asset.fromModule(require('../../assets/images/logo-torch.png')).downloadAsync();
    if (!asset.localUri) return undefined;
    return `data:image/png;base64,${await new File(asset.localUri).base64()}`;
  } catch {
    return undefined;
  }
}
