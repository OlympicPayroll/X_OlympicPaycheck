import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useDialog } from '@/lib/dialog';
import { renderPdf, savePdfToFolder, sharePdf } from '@/lib/pdf';

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
  const busyRef = useRef(false);
  const [exporting, setExporting] = useState(false);

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
          if (await savePdfToFolder(file, fileName)) {
            await confirm({
              title: 'PDF saved',
              message: `${fileName} is in the folder you chose.`,
              confirmText: 'Done',
              cancelText: 'Close',
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
    [choose, confirm],
  );

  return { exporting, exportPdf };
}
