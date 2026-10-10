import SwiftRs
import Tauri
import UIKit
import WebKit

/// iOS counterpart of the Orivue native plugin. WebKit already plays HLS and
/// `mpegts.js` handles MPEG-TS through ManagedMediaSource, so this build only
/// reports device information; player commands tell the UI to use the web
/// backend.
class NativePlugin: Plugin {
  @objc public func load(_ invoke: Invoke) throws {
    invoke.reject("the native player is not available on this platform")
  }

  @objc public func stop(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  @objc public func setPaused(_ invoke: Invoke) throws {
    invoke.reject("the native player is not available on this platform")
  }

  @objc public func setVolume(_ invoke: Invoke) throws {
    invoke.reject("the native player is not available on this platform")
  }

  @objc public func setAspect(_ invoke: Invoke) throws {
    invoke.reject("the native player is not available on this platform")
  }

  @objc public func seek(_ invoke: Invoke) throws {
    invoke.reject("the native player is not available on this platform")
  }

  @objc public func selectTrack(_ invoke: Invoke) throws {
    invoke.reject("the native player is not available on this platform")
  }

  @objc public func getTracks(_ invoke: Invoke) throws {
    invoke.resolve(["audio": [String](), "text": [String]()])
  }

  @objc public func setBackHandling(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  @objc public func exitApp(_ invoke: Invoke) throws {
    // iOS applications do not exit programmatically; the home button does that.
    invoke.resolve()
  }

  @objc public func getDeviceInfo(_ invoke: Invoke) throws {
    let device = UIDevice.current
    invoke.resolve([
      "tv": device.userInterfaceIdiom == .tv,
      "touchscreen": device.userInterfaceIdiom != .tv,
      "manufacturer": "Apple",
      "model": device.model,
      "playerAvailable": false,
    ])
  }
}

@_cdecl("init_plugin_orivue_native")
func initPlugin() -> Plugin {
  return NativePlugin()
}
