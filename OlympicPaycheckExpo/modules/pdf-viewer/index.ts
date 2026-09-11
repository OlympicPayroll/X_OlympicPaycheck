import { requireOptionalNativeModule } from 'expo';

/**
 * The app's own Android module for opening a saved PDF in the phone's viewer
 * (`android/src/main/java/expo/modules/pdfviewer/PdfViewerModule.kt`).
 */
type PdfViewerModule = {
  /** Rejects with the code ERR_NO_PDF_VIEWER when no installed app can show a PDF. */
  open(uri: string): Promise<void>;
};

/** Null where the native side isn't built in: on iOS, and in Expo Go. */
export default requireOptionalNativeModule<PdfViewerModule>('PdfViewer');
