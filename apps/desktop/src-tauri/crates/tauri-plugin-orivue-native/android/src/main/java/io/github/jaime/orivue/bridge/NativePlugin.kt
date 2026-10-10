package io.github.jaime.orivue.bridge

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class LoadArgs {
  lateinit var url: String
  var live: Boolean? = null
  var headers: Map<String, String> = emptyMap()
  var kind: String? = null
  var title: String? = null
}

@InvokeArg
class PausedArgs {
  var paused: Boolean = false
}

@InvokeArg
class VolumeArgs {
  var volume: Float = 1f
  var muted: Boolean = false
}

@InvokeArg
class AspectArgs {
  lateinit var mode: String
}

@InvokeArg
class SeekArgs {
  var positionSeconds: Double = 0.0
}

@InvokeArg
class TrackArgs {
  lateinit var kind: String
  var id: String? = null
}

@InvokeArg
class BackHandlingArgs {
  var enabled: Boolean = false
}

/**
 * Bridge between the webview and the native pieces Orivue needs on Android
 * and Fire TV: a Media3 player drawn behind the (transparent) webview, the
 * hardware back button and device information.
 */
@TauriPlugin
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class NativePlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null
  private var player: PlayerController? = null

  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      trigger("back", JSObject())
    }
  }

  init {
    (activity as AppCompatActivity).onBackPressedDispatcher.addCallback(activity, backCallback)
  }

  override fun load(webView: WebView) {
    this.webView = webView
    // The page paints its own opaque background; while the native player is
    // active the page makes itself transparent so the video shows through.
    webView.setBackgroundColor(Color.TRANSPARENT)
  }

  private fun controller(): PlayerController {
    val existing = player
    if (existing != null) return existing
    val created = PlayerController(activity as AppCompatActivity, object : PlayerController.Listener {
      override fun onState(state: String, message: String?) {
        val payload = JSObject()
        payload.put("state", state)
        if (message != null) payload.put("message", message)
        trigger("state", payload)
      }

      override fun onPosition(positionSeconds: Double, durationSeconds: Double) {
        val payload = JSObject()
        payload.put("position", positionSeconds)
        payload.put("duration", durationSeconds)
        trigger("position", payload)
      }

      override fun onTracks(audio: List<PlayerController.TrackInfo>, text: List<PlayerController.TrackInfo>) {
        val payload = JSObject()
        payload.put("audio", tracksToJson(audio))
        payload.put("text", tracksToJson(text))
        trigger("tracks", payload)
      }
    })
    player = created
    return created
  }

  private fun tracksToJson(tracks: List<PlayerController.TrackInfo>): JSArray {
    val array = JSArray()
    for (track in tracks) {
      val item = JSObject()
      item.put("id", track.id)
      item.put("label", track.label)
      item.put("language", track.language)
      item.put("selected", track.selected)
      array.put(item)
    }
    return array
  }

  @Command
  fun load(invoke: Invoke) {
    val args = invoke.parseArgs(LoadArgs::class.java)
    activity.runOnUiThread {
      try {
        controller().load(args.url, args.headers, args.kind ?: "unknown", args.live ?: true)
        invoke.resolve()
      } catch (error: Exception) {
        invoke.reject(error.message ?: "The native player could not start")
      }
    }
  }

  @Command
  fun stop(invoke: Invoke) {
    activity.runOnUiThread {
      player?.stop()
      invoke.resolve()
    }
  }

  @Command
  fun setPaused(invoke: Invoke) {
    val args = invoke.parseArgs(PausedArgs::class.java)
    activity.runOnUiThread {
      player?.setPaused(args.paused)
      invoke.resolve()
    }
  }

  @Command
  fun setVolume(invoke: Invoke) {
    val args = invoke.parseArgs(VolumeArgs::class.java)
    activity.runOnUiThread {
      player?.setVolume(args.volume, args.muted)
      invoke.resolve()
    }
  }

  @Command
  fun setAspect(invoke: Invoke) {
    val args = invoke.parseArgs(AspectArgs::class.java)
    activity.runOnUiThread {
      player?.setAspect(args.mode)
      invoke.resolve()
    }
  }

  @Command
  fun seek(invoke: Invoke) {
    val args = invoke.parseArgs(SeekArgs::class.java)
    activity.runOnUiThread {
      player?.seek(args.positionSeconds)
      invoke.resolve()
    }
  }

  @Command
  fun selectTrack(invoke: Invoke) {
    val args = invoke.parseArgs(TrackArgs::class.java)
    activity.runOnUiThread {
      player?.selectTrack(args.kind, args.id)
      invoke.resolve()
    }
  }

  @Command
  fun getTracks(invoke: Invoke) {
    activity.runOnUiThread {
      val result = JSObject()
      val current = player
      result.put("audio", tracksToJson(current?.audioTracks() ?: emptyList()))
      result.put("text", tracksToJson(current?.textTracks() ?: emptyList()))
      invoke.resolve(result)
    }
  }

  @Command
  fun setBackHandling(invoke: Invoke) {
    val args = invoke.parseArgs(BackHandlingArgs::class.java)
    activity.runOnUiThread {
      backCallback.isEnabled = args.enabled
      invoke.resolve()
    }
  }

  /** Leaves the app from the root screen, as TV launchers expect from Back. */
  @Command
  fun exitApp(invoke: Invoke) {
    invoke.resolve()
    activity.runOnUiThread { activity.finishAffinity() }
  }

  @Command
  fun getDeviceInfo(invoke: Invoke) {
    val packageManager = activity.packageManager
    val uiMode = activity.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    val isTelevision =
      uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
        packageManager.hasSystemFeature("amazon.hardware.fire_tv") ||
        packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
        packageManager.hasSystemFeature("android.software.leanback_only")
    val result = JSObject()
    result.put("tv", isTelevision)
    result.put("touchscreen", packageManager.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN))
    result.put("manufacturer", Build.MANUFACTURER ?: "")
    result.put("model", Build.MODEL ?: "")
    result.put("playerAvailable", true)
    invoke.resolve(result)
  }

  override fun onPause() {
    player?.onBackground()
  }

  override fun onResume() {
    player?.onForeground()
  }

  override fun onDestroy(activity: AppCompatActivity) {
    player?.release()
    player = null
  }
}
