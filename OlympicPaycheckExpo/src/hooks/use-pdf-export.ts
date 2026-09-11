import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useDialog } from '@/lib/dialog';
import { NoPdfViewerError, openPdf, renderPdf, savePdfToFolder, sharePdf } from '@/lib/pdf';
import { useSnackbar } from '@/lib/snackbar';

type ExportRequest = {
  /** Builds the document. Called only once the employee has chosen where it goes. */
  html: () => Promise<string>;
  fileName: string;
  /** Names the document in dialogs and the share sheet, e.g. "Pay stub PDF". */
  title: string;
};

/**
 * Save or share a document as a PDF, one export at a time.
 *
 * The guard is held for the whole interaction (the choice, the render, the
 * share sheet), as it is for emailing a stub, so a second tap cannot start a
 * second export underneath the first.
 */
export function usePdfExport() {
  const { confirm, choose } = useDialog();
  const snackbar = useSnackbar();
  const busyRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  /** Open the copy just saved, so the employee needn't find it in their files. */
  const openSaved = useCallback(
    async (uri: string) => {
      try {
        await openPdf(uri);
      } catch (error) {
        // The file is saved either way. Only blame the phone's apps when that
        // really is the reason.
        await confirm({
          ...(error instanceof NoPdfViewerError
            ? {
                title: 'No app to open PDFs',
                message: 'The PDF is saved in the folder you chose. Install a PDF viewer, such as Google Drive, to open it.',
              }
            : {
                title: 'We couldn’t open the PDF',
                message: 'It is saved in the folder you chose. You can open it from your Files app.',
              }),
          confirmText: 'OK',
          cancelText: 'Close',
        });
      }
    },
    [confirm],
  );

  const exportPdf = useCallback(
    async ({ html, fileName, title }: ExportRequest) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setExporting(true);

      try {
        // iOS's share sheet always offers Save to Files. Android's has no
        // dependable save target, so it gets a folder picker as well.
        let toFolder = false;
        if (Platform.OS === 'android') {
          const pick = await choose({ title, options: ['Save to phone', 'Share'] });
          if (pick === null) return;
          toFolder = pick === 0;
        }

        try {
          const file = await renderPdf(await html(), fileName);
          if (!toFolder) {
            await sharePdf(file, title);
            return;
          }
          const saved = await savePdfToFolder(file, fileName);
          if (saved) {
            // Done, with the obvious next step one tap away: no dialog to
            // dismiss, and no trip to the Files app to find what was just saved.
            snackbar.show({
              message: 'PDF saved to your phone',
              action: { label: 'Open', onPress: () => void openSaved(saved) },
            });
          }
        } catch {
          await confirm({
            title: 'We couldn’t create the PDF',
            message: 'Something went wrong while making the file. Please try again.',
            confirmText: 'OK',
            cancelText: 'Close',
          });
        }
      } finally {
        busyRef.current = false;
        setExporting(false);
      }
    },
    [choose, confirm, snackbar, openSaved],
  );

  return { exporting, exportPdf };
}
