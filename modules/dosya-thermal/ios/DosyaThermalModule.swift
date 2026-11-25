import ExpoModulesCore

/// Thermal + memory signals for the JS backup engine's runtime pacing.
/// JS treats this module as optional: absent (Expo Go) it assumes
/// "nominal" and full concurrency.
public class DosyaThermalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DosyaThermal")

    Events("onThermalStateChange")

    Function("getThermalState") { () -> String in
      Self.stateString(ProcessInfo.processInfo.thermalState)
    }

    // Current phys_footprint in bytes (what Xcode's memory gauge shows), -1 on failure.
    Function("getMemoryFootprint") { () -> Double in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
      let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      return result == KERN_SUCCESS ? Double(info.phys_footprint) : -1
    }

    OnStartObserving {
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(self.thermalStateChanged),
        name: ProcessInfo.thermalStateDidChangeNotification,
        object: nil
      )
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(
        self,
        name: ProcessInfo.thermalStateDidChangeNotification,
        object: nil
      )
    }
  }

  @objc private func thermalStateChanged() {
    sendEvent("onThermalStateChange", ["state": Self.stateString(ProcessInfo.processInfo.thermalState)])
  }

  private static func stateString(_ s: ProcessInfo.ThermalState) -> String {
    switch s {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }
}
