package dev.dosya.personasbg

import android.os.Handler
import android.os.Looper
import java.util.UUID

/**
 * The windows the Personas runner reads in on Android, shared by the service,
 * the worker and the module (the Android twin of ios/PersonasWindows.swift).
 *
 * Window events and Pause presses are buffered until JS listens for that
 * event name and then flushed in order: a worker wakes a cold process long
 * before the JS runtime subscribes. A window that expires while its onWindow
 * is still buffered is ended here and dropped, so a later listener is never
 * handed a dead window. A window JS has seen but not ended is ended here
 * [EXPIRY_GRACE_MS] after its expiry.
 */
object PersonasWindows {
  const val WINDOW_EVENT = "onWindow"
  const val EXPIRED_EVENT = "onWindowExpired"
  const val PAUSE_EVENT = "onPausePressed"
  const val MEMORY_EVENT = "onMemoryWarning"
  /** The service went away (JS's stop, onTimeout, a refused startForeground); JS's "service up" mirror clears on it. */
  const val SERVICE_STOPPED_EVENT = "onServiceStopped"
  const val EXPIRY_GRACE_MS = 5_000L

  /** JS's Number.MAX_SAFE_INTEGER: a service window has no deadline of its own. */
  const val NO_DEADLINE_MS = 9_007_199_254_740_991.0

  /**
   * [onEnd] runs once: with JS's moreLeft from windowDone, or null when the
   * window was ended here (expired unseen, or no windowDone within the grace).
   */
  private class Window(val kind: String, val onEnd: (Boolean?) -> Unit)

  private class Pending(val name: String, val id: String?, val body: Map<String, Any?>)

  enum class Expiry {
    /** Already ended (windowDone arrived first). */
    GONE,
    /** JS never saw it: ended here, never delivered. */
    DROPPED,
    /** onWindowExpired sent; ended here after the grace unless windowDone comes first. */
    DELIVERED,
  }

  private val lock = Any()
  private val windows = HashMap<String, Window>()
  private val pending = ArrayList<Pending>()
  private val listening = HashSet<String>()
  private var emitter: ((String, Map<String, Any?>) -> Unit)? = null
  private val main = Handler(Looper.getMainLooper())

  // Windows

  /** Opens a window and sends (or buffers) its onWindow. Returns its id. */
  fun open(kind: String, deadlineMs: Double, onEnd: (Boolean?) -> Unit): String {
    val id = UUID.randomUUID().toString()
    synchronized(lock) { windows[id] = Window(kind, onEnd) }
    emit(WINDOW_EVENT, id, mapOf("id" to id, "kind" to kind, "deadlineMs" to deadlineMs))
    return id
  }

  /** JS ended the window. False when it had already ended. */
  fun done(id: String, moreLeft: Boolean): Boolean = end(id, moreLeft)

  /** The OS is taking the window back. */
  fun expire(id: String): Expiry {
    val dropped: Window?
    synchronized(lock) {
      if (!windows.containsKey(id)) return Expiry.GONE
      // Checked and removed under one lock, so a flush cannot hand the
      // window out in between.
      val unseen = pending.any { it.name == WINDOW_EVENT && it.id == id }
      dropped = if (unseen) windows.remove(id) else null
      if (unseen) pending.removeAll { it.id == id }
    }
    if (dropped != null) {
      dropped.onEnd(null)
      return Expiry.DROPPED
    }
    emit(EXPIRED_EVENT, id, mapOf("id" to id))
    // A no-op when windowDone arrived in time.
    main.postDelayed({ end(id, null) }, EXPIRY_GRACE_MS)
    return Expiry.DELIVERED
  }

  /** The ids of the open windows of one kind. */
  fun openIds(kind: String): List<String> = synchronized(lock) {
    windows.filterValues { it.kind == kind }.keys.toList()
  }

  private fun end(id: String, moreLeft: Boolean?): Boolean {
    val window = synchronized(lock) {
      val w = windows.remove(id)
      if (w != null) pending.removeAll { it.id == id }
      w
    } ?: return false
    window.onEnd(moreLeft)
    return true
  }

  // Events

  fun attach(send: (String, Map<String, Any?>) -> Unit) {
    synchronized(lock) { emitter = send }
  }

  /** The module went away (JS reload): forget the listeners; events buffer again. */
  fun detach() {
    synchronized(lock) {
      emitter = null
      listening.clear()
    }
  }

  fun startListening(name: String) {
    synchronized(lock) {
      listening.add(name)
      val flush = pending.filter { it.name == name }
      pending.removeAll { it.name == name }
      // Sent under the lock, so an emit racing this flush cannot overtake the
      // older buffered events of the same name. The emitter only queues the
      // event for JS and never calls back in here.
      for (event in flush) emitter?.invoke(event.name, event.body)
    }
  }

  fun stopListening(name: String) {
    synchronized(lock) { listening.remove(name) }
  }

  /** Buffered until JS listens for [name]. */
  fun emit(name: String, id: String?, body: Map<String, Any?>) {
    synchronized(lock) {
      val send = emitter
      if (listening.contains(name) && send != null) {
        send(name, body)
      } else {
        // One buffered "service stopped" says all a later listener needs.
        if (name == SERVICE_STOPPED_EVENT) pending.removeAll { it.name == name }
        pending.add(Pending(name, id, body))
      }
    }
  }
}
