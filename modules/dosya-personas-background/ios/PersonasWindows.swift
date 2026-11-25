import BackgroundTasks
import Foundation

/// The OS windows the Personas runner reads in, shared by the app delegate
/// subscriber (which registers the processing handler at launch, before JS
/// exists) and the module (which talks to JS).
///
/// Window events are buffered until JS listens for them and then flushed in
/// order: a cold background launch delivers the task long before the JS
/// runtime subscribes. A window JS never ended is completed here 5 s after
/// its expiry, and its buffered events are dropped with it so a later
/// listener is never handed a dead window.
final class PersonasWindows {
  static let shared = PersonasWindows()

  static let processingIdentifier = "dev.dosya.personas.read"
  /// Concrete identifiers are this plus a UUID. Info.plist permits the
  /// wildcard `dev.dosya.app.personas.continue.*`; Apple requires a continued
  /// task's wildcard to start with the bundle ID (`dev.dosya.app`).
  static let continuedPrefix = "dev.dosya.app.personas.continue."
  /// iOS gives no deadline for a processing task; it ends it through the
  /// expiration handler, normally well before this.
  static let processingWindow: TimeInterval = 25 * 60
  /// A continued task runs until done or stopped; this only bounds one runner
  /// pass (the runner's own photo cap usually ends it first).
  static let continuedWindow: TimeInterval = 60 * 60
  static let expiryGrace: TimeInterval = 5

  static let windowEvent = "onWindow"
  static let expiredEvent = "onWindowExpired"

  private final class Window {
    let task: BGTask
    let title: String
    init(task: BGTask, title: String) {
      self.task = task
      self.title = title
    }
  }

  private let lock = NSLock()
  private var windows: [String: Window] = [:]
  private var pending: [(name: String, id: String, body: [String: Any])] = []
  private var listening: Set<String> = []
  private var emitter: ((String, [String: Any]) -> Void)?

  // MARK: Launch

  /// Called once from didFinishLaunching. iOS kills the app on a second
  /// registration of the same identifier, so this is guarded.
  private var registered = false
  func registerProcessingHandler() {
    lock.lock()
    let already = registered
    registered = true
    lock.unlock()
    if already { return }
    _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingIdentifier, using: nil) { [weak self] task in
      guard let self else {
        task.setTaskCompleted(success: false)
        return
      }
      self.begin(task, kind: "processing", length: Self.processingWindow, title: "")
    }
  }

  // MARK: Windows

  private func begin(_ task: BGTask, kind: String, length: TimeInterval, title: String) {
    let id = UUID().uuidString
    lock.lock()
    windows[id] = Window(task: task, title: title)
    lock.unlock()
    task.expirationHandler = { [weak self] in self?.expire(id) }
    let deadlineMs = (Date().timeIntervalSince1970 + length) * 1000
    emit(Self.windowEvent, id: id, body: ["id": id, "kind": kind, "deadlineMs": deadlineMs])
  }

  private func expire(_ id: String) {
    // JS never saw this window (its onWindow is still buffered): handing it
    // out now would give the runner a dead window that holds the read lock,
    // and the expiry could even reach JS first (buffers flush per event).
    // End it here instead.
    // Checked and removed under one lock, so a flush cannot hand the window
    // out in between.
    lock.lock()
    if windows[id] == nil {
      // Already ended through windowDone.
      lock.unlock()
      return
    }
    let unseen = pending.contains { $0.name == Self.windowEvent && $0.id == id }
    let dead = unseen ? windows.removeValue(forKey: id) : nil
    if unseen { pending.removeAll { $0.id == id } }
    lock.unlock()
    if unseen {
      dead?.task.setTaskCompleted(success: false)
      return
    }
    emit(Self.expiredEvent, id: id, body: ["id": id])
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + Self.expiryGrace) { [weak self] in
      // A no-op when windowDone arrived in time.
      _ = self?.complete(id, success: false)
    }
  }

  /// Completes the window's task once. False when it was already completed.
  @discardableResult
  func complete(_ id: String, success: Bool) -> Bool {
    lock.lock()
    let window = windows.removeValue(forKey: id)
    if window != nil { pending.removeAll { $0.id == id } }
    lock.unlock()
    guard let window else { return false }
    window.task.setTaskCompleted(success: success)
    return true
  }

  func setProgress(_ id: String, read: Int, total: Int, text: String) {
    lock.lock()
    let window = windows[id]
    lock.unlock()
    guard let window else { return }
    #if compiler(>=6.2)
    if #available(iOS 26, *), let task = window.task as? BGContinuedProcessingTask {
      task.progress.totalUnitCount = Int64(max(total, 0))
      task.progress.completedUnitCount = Int64(min(max(read, 0), max(total, 0)))
      task.updateTitle(window.title, subtitle: text)
    }
    #endif
  }

  // MARK: Scheduling

  func scheduleProcessing(requiresPower: Bool) throws {
    let request = BGProcessingTaskRequest(identifier: Self.processingIdentifier)
    request.requiresNetworkConnectivity = true
    request.requiresExternalPower = requiresPower
    // Submitting replaces a pending request with the same identifier.
    try BGTaskScheduler.shared.submit(request)
  }

  func cancelPending() {
    // Continued requests use strategy .fail, so none is ever left pending.
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingIdentifier)
  }

  /// iOS 26+, and only in a build made with the iOS 26 SDK (Swift 6.2+);
  /// older build images compile the continued-task code out.
  var supportsContinued: Bool {
    #if compiler(>=6.2)
    if #available(iOS 26, *) { return true }
    #endif
    return false
  }

  /// Registers a handler for a fresh concrete identifier (wildcard matching
  /// is unreliable) and submits with strategy .fail. Must be called while the
  /// app is in the foreground. False when iOS refuses it.
  func startContinued(title: String, subtitle: String) -> Bool {
    #if compiler(>=6.2)
    guard #available(iOS 26, *) else { return false }
    let identifier = Self.continuedPrefix + UUID().uuidString
    let ok = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { [weak self] task in
      guard let self, task is BGContinuedProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      self.begin(task, kind: "continued", length: Self.continuedWindow, title: title)
    }
    guard ok else { return false }
    let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: subtitle)
    request.strategy = .fail
    do {
      try BGTaskScheduler.shared.submit(request)
      return true
    } catch {
      return false
    }
    #else
    return false
    #endif
  }

  // MARK: Events

  func attach(_ emitter: @escaping (String, [String: Any]) -> Void) {
    lock.lock()
    self.emitter = emitter
    lock.unlock()
  }

  /// The module went away (JS reload): forget the listeners; events buffer again.
  func detach() {
    lock.lock()
    emitter = nil
    listening.removeAll()
    lock.unlock()
  }

  func startListening(_ name: String) {
    lock.lock()
    listening.insert(name)
    let flush = pending.filter { $0.name == name }
    pending.removeAll { $0.name == name }
    // Sent under the lock, so an emit racing this flush cannot overtake the
    // older buffered events of the same name. The emitter only queues the
    // event for JS and never calls back in here.
    for event in flush { emitter?(event.name, event.body) }
    lock.unlock()
  }

  func stopListening(_ name: String) {
    lock.lock()
    listening.remove(name)
    lock.unlock()
  }

  private func emit(_ name: String, id: String, body: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    if listening.contains(name), let send = emitter {
      send(name, body)
    } else {
      pending.append((name: name, id: id, body: body))
    }
  }
}
