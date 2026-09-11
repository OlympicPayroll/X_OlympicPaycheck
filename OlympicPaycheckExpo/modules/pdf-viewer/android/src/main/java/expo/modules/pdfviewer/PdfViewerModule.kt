package expo.modules.pdfviewer

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** No installed app can show a PDF. Reaches JavaScript with the code ERR_NO_PDF_VIEWER. */
class NoPdfViewerException :
  CodedException("ERR_NO_PDF_VIEWER", "No app on this phone can open a PDF", null)

/**
 * Opens a PDF the employee saved in the phone's PDF viewer.
 *
 * A plain startActivity, deliberately not startActivityForResult: nothing waits
 * for the viewer to report back, so a viewer left open in the background can
 * never block the next Open.
 */
class PdfViewerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfViewer")

    AsyncFunction("open") { uri: String ->
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(uri), "application/pdf")
        // The saved copy sits behind a content:// URI, so the viewer is granted
        // read access to it. It opens as an app of its own rather than inside
        // this one, so Home and then the Olympic Paycheck icon returns to payroll.
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      try {
        appContext.throwingActivity.startActivity(intent)
      } catch (e: ActivityNotFoundException) {
        throw NoPdfViewerException()
      }
    }
  }
}
