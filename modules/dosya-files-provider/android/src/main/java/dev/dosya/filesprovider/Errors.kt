package dev.dosya.filesprovider

import android.app.AuthenticationRequiredException
import android.app.PendingIntent
import android.os.Build
import java.io.FileNotFoundException

/**
 * Binder calls may only throw what the framework can parcel back to the
 * caller: FileNotFoundException, IllegalArgumentException, IllegalStateException,
 * UnsupportedOperationException, SecurityException and, on API 26+,
 * AuthenticationRequiredException. Anything else escaping a ContentProvider
 * method kills the app process.
 */
object Errors {
  fun <T> guard(pendingIntent: PendingIntent?, block: () -> T): T = try {
    block()
  } catch (e: NotSignedInException) {
    throw signIn(e, pendingIntent)
  } catch (e: ApiException) {
    when (e.status) {
      401 -> throw signIn(NotSignedInException(), pendingIntent)
      404 -> throw FileNotFoundException(e.message)
      else -> throw IllegalStateException(e.message, e)
    }
  } catch (e: UnreachableException) {
    throw FileNotFoundException(e.message)
  } catch (e: FileNotFoundException) {
    throw e
  } catch (e: IllegalArgumentException) {
    throw e
  } catch (e: IllegalStateException) {
    throw e
  } catch (e: UnsupportedOperationException) {
    throw e
  } catch (e: SecurityException) {
    throw e
  } catch (e: Throwable) {
    throw IllegalStateException(e.message ?: e.javaClass.simpleName, e)
  }

  private fun signIn(cause: NotSignedInException, pendingIntent: PendingIntent?): Throwable {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && pendingIntent != null) {
      // The picker shows a "sign in" affordance that launches the app.
      return AuthenticationRequiredException(cause, pendingIntent)
    }
    return FileNotFoundException(cause.message)
  }
}
