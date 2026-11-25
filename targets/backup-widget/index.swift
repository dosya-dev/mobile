import ActivityKit
import SwiftUI
import WidgetKit

let appGroup = "group.dev.dosya.app"
let snapshotKey = "backupStatus"

// MARK: - Snapshot (mirror of src/backup/statusBridge.ts)

struct ThemeColors: Decodable {
  var bg: String
  var ink: String
  var mut: String
  var track: String
  var go: String
  var bad: String
}

struct ThemePair: Decodable {
  var light: ThemeColors
  var dark: ThemeColors
}

struct BackupSnapshot: Decodable {
  var phase: String
  var done: Int
  var total: Int
  var bytesPerSec: Int
  var updatedAt: Int
  var workspaceName: String?
  var storageUsed: Double?
  var storageTotal: Double?
  var lastRunAt: Int?
  var lastRunCount: Int?
  var lastSpeedBps: Double?
  var theme: ThemePair?

  static func load() -> BackupSnapshot? {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey),
          let data = json.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(BackupSnapshot.self, from: data)
  }
}

extension Color {
  init(hex: String) {
    var v: UInt64 = 0
    let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    Scanner(string: s).scanHexInt64(&v)
    self.init(
      .sRGB,
      red: Double((v >> 16) & 0xFF) / 255,
      green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255,
      opacity: 1
    )
  }
}

/// The app theme's palette for the current system scheme; brand-green fallback
/// when an old snapshot (or none) is present.
struct Palette {
  var bg: Color
  var ink: Color
  var mut: Color
  var track: Color
  var go: Color
  var bad: Color

  static func resolve(_ snapshot: BackupSnapshot?, _ scheme: ColorScheme) -> Palette {
    if let t = snapshot?.theme {
      let c = scheme == .dark ? t.dark : t.light
      return Palette(bg: Color(hex: c.bg), ink: Color(hex: c.ink), mut: Color(hex: c.mut),
                     track: Color(hex: c.track), go: Color(hex: c.go), bad: Color(hex: c.bad))
    }
    return scheme == .dark
      ? Palette(bg: Color(hex: "09131a"), ink: Color(hex: "e9f0f5"), mut: Color(hex: "85919a"),
                track: Color(hex: "172128"), go: Color(hex: "2fbc5b"), bad: Color(hex: "f25a63"))
      : Palette(bg: .white, ink: Color(hex: "09131a"), mut: Color(hex: "4c575f"),
                track: Color(hex: "e0edf8"), go: Color(hex: "00a33d"), bad: Color(hex: "f22a36"))
  }
}

// MARK: - Formatting

func gbString(_ bytes: Double) -> String {
  let f = ByteCountFormatter()
  f.countStyle = .binary
  return f.string(fromByteCount: Int64(bytes))
}

func speedString(_ bps: Double) -> String {
  let f = ByteCountFormatter()
  f.countStyle = .binary
  return f.string(fromByteCount: Int64(bps)) + "/s"
}

func whenString(_ unix: Int) -> String {
  let d = Date(timeIntervalSince1970: TimeInterval(unix))
  if Calendar.current.isDateInToday(d) {
    return "Today " + d.formatted(date: .omitted, time: .shortened)
  }
  return d.formatted(.dateTime.month(.abbreviated).day().hour().minute())
}

// MARK: - Timeline

struct BackupEntry: TimelineEntry {
  let date: Date
  let snapshot: BackupSnapshot?
}

struct BackupProvider: TimelineProvider {
  func placeholder(in _: Context) -> BackupEntry { BackupEntry(date: .now, snapshot: nil) }
  func getSnapshot(in _: Context, completion: @escaping (BackupEntry) -> Void) {
    completion(BackupEntry(date: .now, snapshot: BackupSnapshot.load()))
  }
  func getTimeline(in _: Context, completion: @escaping (Timeline<BackupEntry>) -> Void) {
    // One entry; the app reloads the timeline whenever the engine, theme, or
    // workspace changes.
    completion(Timeline(entries: [BackupEntry(date: .now, snapshot: BackupSnapshot.load())], policy: .after(.now + 30 * 60)))
  }
}

// MARK: - Shared pieces (Variant A)

struct StorageRing: View {
  var used: Double?
  var total: Double?
  var center: (String, String) // big text, small caption
  var p: Palette

  private var fraction: Double {
    guard let u = used, let t = total, t > 0 else { return 0 }
    return min(1, u / t)
  }
  private var warning: Bool { fraction >= 0.9 }

  var body: some View {
    ZStack {
      Circle().stroke(p.track, lineWidth: 7)
      Circle()
        .trim(from: 0, to: fraction)
        .stroke(warning ? p.bad : p.go, style: StrokeStyle(lineWidth: 7, lineCap: .round))
        .rotationEffect(.degrees(-90))
      VStack(spacing: 1) {
        Text(center.0).font(.system(size: 15, weight: .bold)).foregroundStyle(p.ink)
          .minimumScaleFactor(0.6).lineLimit(1)
        Text(center.1).font(.system(size: 7, weight: .semibold)).foregroundStyle(p.mut)
          .textCase(.uppercase).kerning(0.5)
      }
    }
  }
}

struct FactCell: View {
  var label: String
  var value: String
  var p: Palette
  var accent: Color? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(label).font(.system(size: 8, weight: .semibold)).foregroundStyle(p.mut)
        .textCase(.uppercase).kerning(0.6)
      Text(value).font(.system(size: 12, weight: .bold)).foregroundStyle(accent ?? p.ink)
        .minimumScaleFactor(0.7).lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct StatusPill: View {
  var running: Bool
  var p: Palette

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: running ? "arrow.triangle.2.circlepath.icloud.fill" : "checkmark.shield.fill")
        .font(.system(size: 9, weight: .bold))
      Text(running ? "Backing up" : "Protected").font(.system(size: 10, weight: .bold))
    }
    .foregroundStyle(p.go)
    .padding(.horizontal, 8).padding(.vertical, 3)
    .background(Capsule().fill(p.go.opacity(0.14)))
  }
}

// MARK: - Widget views

struct BackupWidgetMediumView: View {
  var entry: BackupEntry
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let s = entry.snapshot
    let p = Palette.resolve(s, scheme)
    let running = (s?.phase ?? "idle") != "idle"
    let usedPct = (s?.storageUsed ?? 0) / max(1, s?.storageTotal ?? 1)

    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("dosya.dev" + (s?.workspaceName.map { " · \($0)" } ?? ""))
          .font(.system(size: 10, weight: .bold)).foregroundStyle(p.mut).lineLimit(1)
        Spacer()
        StatusPill(running: running, p: p)
      }
      HStack(spacing: 14) {
        StorageRing(
          used: s?.storageUsed, total: s?.storageTotal,
          center: (s?.storageTotal != nil ? "\(min(100, max(0, Int(usedPct * 100))))%" : "-", "used"),
          p: p
        )
        .frame(width: 72, height: 72)

        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
          GridRow {
            FactCell(
              label: "Free",
              value: s?.storageTotal != nil ? gbString(max(0, (s?.storageTotal ?? 0) - (s?.storageUsed ?? 0))) : "-",
              p: p, accent: usedPct >= 0.9 ? p.bad : nil
            )
            FactCell(
              label: "Used",
              value: s?.storageTotal != nil ? "\(gbString(s?.storageUsed ?? 0)) / \(gbString(s?.storageTotal ?? 0))" : "-",
              p: p
            )
          }
          GridRow {
            if running, let snap = s {
              FactCell(label: "Progress", value: "\(snap.done) / \(snap.total)", p: p, accent: p.go)
              FactCell(label: "Speed now", value: snap.bytesPerSec > 0 ? speedString(Double(snap.bytesPerSec)) : "-", p: p)
            } else {
              FactCell(
                label: "Last backup",
                value: s?.lastRunAt.map { whenString($0) + (s?.lastRunCount.map { c in " · ✓\(c)" } ?? "") } ?? "-",
                p: p
              )
              FactCell(label: "Last speed", value: s?.lastSpeedBps.map { speedString($0) } ?? "-", p: p)
            }
          }
        }
      }
    }
  }
}

struct BackupWidgetSmallView: View {
  var entry: BackupEntry
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let s = entry.snapshot
    let p = Palette.resolve(s, scheme)
    let running = (s?.phase ?? "idle") != "idle"
    let free = max(0, (s?.storageTotal ?? 0) - (s?.storageUsed ?? 0))

    VStack(spacing: 4) {
      HStack {
        Text("dosya.dev").font(.system(size: 9, weight: .bold)).foregroundStyle(p.mut)
        Spacer()
      }
      Spacer(minLength: 0)
      StorageRing(
        used: s?.storageUsed, total: s?.storageTotal,
        center: (s?.storageTotal != nil ? gbString(free) : "-", "free"),
        p: p
      )
      .frame(width: 70, height: 70)
      Spacer(minLength: 0)
      HStack {
        HStack(spacing: 4) {
          Circle().fill(p.go).frame(width: 6, height: 6)
          Text(running ? "Backing up" : "Protected").font(.system(size: 9, weight: .bold)).foregroundStyle(p.ink)
        }
        Spacer()
        Text(s?.lastRunAt.map { Date(timeIntervalSince1970: TimeInterval($0)).formatted(date: .omitted, time: .shortened) } ?? "")
          .font(.system(size: 9)).foregroundStyle(p.mut)
      }
    }
  }
}

struct BackupWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "BackupWidget", provider: BackupProvider()) { entry in
      Group {
        WidgetSizeSwitcher(entry: entry)
      }
      .widgetBackground(entry: entry)
    }
    .configurationDisplayName("Backup status")
    .description("Status, storage, last backup and speed - themed like your app.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct WidgetSizeSwitcher: View {
  var entry: BackupEntry
  @Environment(\.widgetFamily) private var family
  var body: some View {
    switch family {
    case .systemMedium: BackupWidgetMediumView(entry: entry)
    default: BackupWidgetSmallView(entry: entry)
    }
  }
}

extension View {
  @ViewBuilder
  func widgetBackground(entry: BackupEntry) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(for: .widget) { ThemedWidgetBackground(entry: entry) }
    } else {
      ZStack { ThemedWidgetBackground(entry: entry); padding() }
    }
  }
}

struct ThemedWidgetBackground: View {
  var entry: BackupEntry
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    Palette.resolve(entry.snapshot, scheme).bg
  }
}

// MARK: - Live Activity (lock screen + Dynamic Island)

// Must stay identical to the definition in modules/dosya-backup-status -
// ActivityKit matches attributes by type name + shape across the boundary.
struct BackupActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var done: Int
    var total: Int
    var bytesPerSec: Int
  }
  var workspaceName: String
}

struct BackupLiveActivity: Widget {
  private var tint: Color {
    // Live Activities can read the shared snapshot too - same theme as the app.
    if let t = BackupSnapshot.load()?.theme?.light { return Color(hex: t.go) }
    return Color(hex: "00a33d")
  }

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BackupActivityAttributes.self) { context in
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Image(systemName: "arrow.triangle.2.circlepath.icloud.fill").foregroundStyle(tint)
          Text("Backing up to \(context.attributes.workspaceName)").font(.caption).bold()
          Spacer()
          Text("\(context.state.done)/\(context.state.total)").font(.caption).monospacedDigit()
        }
        ProgressView(value: context.state.total > 0 ? Double(context.state.done) / Double(context.state.total) : 0)
          .tint(tint)
        if context.state.bytesPerSec > 0 {
          Text("\(ByteCountFormatter.string(fromByteCount: Int64(context.state.bytesPerSec), countStyle: .binary))/s")
            .font(.caption2).foregroundStyle(.secondary)
        }
      }
      .padding(12)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "arrow.triangle.2.circlepath.icloud.fill").foregroundStyle(tint)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(context.state.done)/\(context.state.total)").monospacedDigit().font(.caption)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ProgressView(value: context.state.total > 0 ? Double(context.state.done) / Double(context.state.total) : 0)
            .tint(tint)
        }
      } compactLeading: {
        Image(systemName: "icloud.and.arrow.up").foregroundStyle(tint)
      } compactTrailing: {
        ProgressView(value: context.state.total > 0 ? Double(context.state.done) / Double(context.state.total) : 0)
          .progressViewStyle(.circular).tint(tint).frame(width: 16, height: 16)
      } minimal: {
        Image(systemName: "icloud.and.arrow.up").foregroundStyle(tint)
      }
    }
  }
}

@main
struct BackupWidgetBundle: WidgetBundle {
  var body: some Widget {
    BackupWidget()
    if #available(iOS 16.2, *) {
      BackupLiveActivity()
    }
  }
}
