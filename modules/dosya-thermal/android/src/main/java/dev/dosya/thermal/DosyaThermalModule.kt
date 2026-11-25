package dev.dosya.thermal

import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Thermal + memory signals, same JS surface as ios/DosyaThermalModule.swift. */
class DosyaThermalModule : Module() {
  private var listener: PowerManager.OnThermalStatusChangedListener? = null

  private fun powerManager(): PowerManager? =
    appContext.reactContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager

  override fun definition() = ModuleDefinition {
    Name("DosyaThermal")

    Events("onThermalStateChange")

    Function("getThermalState") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) "nominal"
      else stateString(powerManager()?.currentThermalStatus ?: PowerManager.THERMAL_STATUS_NONE)
    }

    // Process PSS in bytes (iOS returns phys_footprint in bytes), -1 on failure.
    Function("getMemoryFootprint") {
      try {
        val info = Debug.MemoryInfo()
        Debug.getMemoryInfo(info)
        info.totalPss.toDouble() * 1024.0
      } catch (_: Throwable) {
        -1.0
      }
    }

    OnStartObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && listener == null) {
        val l = PowerManager.OnThermalStatusChangedListener { status ->
          sendEvent("onThermalStateChange", mapOf("state" to stateString(status)))
        }
        listener = l
        powerManager()?.addThermalStatusListener(l)
      }
    }

    OnStopObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        listener?.let { powerManager()?.removeThermalStatusListener(it) }
      }
      listener = null
    }
  }

  private fun stateString(status: Int): String = when {
    status >= PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
    status == PowerManager.THERMAL_STATUS_SEVERE -> "serious"
    status == PowerManager.THERMAL_STATUS_MODERATE -> "fair"
    else -> "nominal"
  }
}
