package io.github.jaime.orivue.bridge

import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView

/**
 * Owns an ExoPlayer instance and a [PlayerView] inserted *behind* the
 * webview in the activity content frame. The React overlay provides the UI.
 */
@UnstableApi
class PlayerController(private val activity: AppCompatActivity, private val listener: Listener) {
  interface Listener {
    fun onState(state: String, message: String?)
    fun onTracks(audio: List<TrackInfo>, text: List<TrackInfo>)
  }

  data class TrackInfo(val id: String, val label: String, val language: String?, val selected: Boolean)

  private val trackSelector = DefaultTrackSelector(activity)
  private val view: PlayerView = PlayerView(activity).apply {
    useController = false
    setShutterBackgroundColor(android.graphics.Color.BLACK)
    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    layoutParams = FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    visibility = android.view.View.GONE
    isFocusable = false
  }
  private var player: ExoPlayer? = null
  private var currentTracks: Tracks = Tracks.EMPTY
  private var attached = false

  private val playerListener = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      when (playbackState) {
        Player.STATE_BUFFERING -> listener.onState("buffering", null)
        Player.STATE_READY -> listener.onState(if (player?.playWhenReady == true) "playing" else "paused", null)
        Player.STATE_ENDED -> listener.onState("ended", null)
        Player.STATE_IDLE -> Unit
      }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (player?.playbackState == Player.STATE_READY) {
        listener.onState(if (playWhenReady) "playing" else "paused", null)
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      listener.onState("error", describe(error))
    }

    override fun onTracksChanged(tracks: Tracks) {
      currentTracks = tracks
      listener.onTracks(audioTracks(), textTracks())
    }
  }

  private fun attach() {
    if (attached) return
    val content = activity.findViewById<ViewGroup>(android.R.id.content)
    content.addView(view, 0)
    attached = true
  }

  private fun ensurePlayer(): ExoPlayer {
    player?.let { return it }
    val created = ExoPlayer.Builder(activity)
      .setTrackSelector(trackSelector)
      .setLoadControl(
        DefaultLoadControl.Builder()
          .setBufferDurationsMs(15_000, 50_000, 1_500, 3_000)
          .build(),
      )
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
          .build(),
        true,
      )
      .setHandleAudioBecomingNoisy(true)
      .build()
    created.addListener(playerListener)
    view.player = created
    player = created
    return created
  }

  fun load(url: String, headers: Map<String, String>, kind: String) {
    attach()
    val exo = ensurePlayer()
    val httpFactory = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(20_000)
    val userAgent = headers.entries.firstOrNull { it.key.equals("user-agent", ignoreCase = true) }?.value
    httpFactory.setUserAgent(userAgent ?: "Orivue/0.2 (Android)")
    val extra = headers.filterKeys { !it.equals("user-agent", ignoreCase = true) }
    if (extra.isNotEmpty()) httpFactory.setDefaultRequestProperties(extra)
    val dataSourceFactory = DefaultDataSource.Factory(activity, httpFactory)
    val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)
    val item = MediaItem.Builder().setUri(url)
    when (kind) {
      "hls" -> item.setMimeType(MimeTypes.APPLICATION_M3U8)
      "mpegts" -> item.setMimeType(MimeTypes.VIDEO_MP2T)
    }
    exo.setMediaSource(mediaSourceFactory.createMediaSource(item.build()))
    exo.playWhenReady = true
    exo.prepare()
    view.visibility = android.view.View.VISIBLE
    activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    listener.onState("buffering", null)
  }

  fun stop() {
    player?.stop()
    player?.clearMediaItems()
    view.visibility = android.view.View.GONE
    activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  fun setPaused(paused: Boolean) {
    player?.playWhenReady = !paused
  }

  fun setVolume(volume: Float, muted: Boolean) {
    player?.volume = if (muted) 0f else volume.coerceIn(0f, 1f)
  }

  fun setAspect(mode: String) {
    view.resizeMode = when (mode) {
      "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun selectTrack(kind: String, id: String?) {
    val type = if (kind == "audio") C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
    val builder = trackSelector.parameters.buildUpon().clearOverridesOfType(type)
    if (id == null) {
      builder.setTrackTypeDisabled(type, type == C.TRACK_TYPE_TEXT)
    } else {
      builder.setTrackTypeDisabled(type, false)
      val parts = id.split(":")
      val groupIndex = parts.getOrNull(0)?.toIntOrNull() ?: return
      val trackIndex = parts.getOrNull(1)?.toIntOrNull() ?: return
      val group = currentTracks.groups.filter { it.type == type }.getOrNull(groupIndex) ?: return
      builder.addOverride(TrackSelectionOverride(group.mediaTrackGroup, trackIndex))
    }
    trackSelector.parameters = builder.build()
  }

  fun audioTracks(): List<TrackInfo> = collect(C.TRACK_TYPE_AUDIO)

  fun textTracks(): List<TrackInfo> = collect(C.TRACK_TYPE_TEXT)

  private fun collect(type: Int): List<TrackInfo> {
    val result = mutableListOf<TrackInfo>()
    currentTracks.groups.filter { it.type == type }.forEachIndexed { groupIndex, group ->
      for (trackIndex in 0 until group.length) {
        if (!group.isTrackSupported(trackIndex)) continue
        val format = group.getTrackFormat(trackIndex)
        val label = format.label ?: format.language ?: "${if (type == C.TRACK_TYPE_AUDIO) "Audio" else "Subtítulo"} ${result.size + 1}"
        result.add(TrackInfo("$groupIndex:$trackIndex", label, format.language, group.isTrackSelected(trackIndex)))
      }
    }
    return result
  }

  fun onBackground() {
    player?.playWhenReady = false
  }

  fun onForeground() {
    if (view.visibility == android.view.View.VISIBLE) player?.playWhenReady = true
  }

  fun release() {
    player?.removeListener(playerListener)
    player?.release()
    player = null
    view.player = null
    if (attached) {
      (view.parent as? ViewGroup)?.removeView(view)
      attached = false
    }
  }

  private fun describe(error: PlaybackException): String = when (error.errorCode) {
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "No se pudo conectar con el stream."
    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "El servidor rechazó la conexión al stream."
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "El formato del stream no se reconoce."
    PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "Este dispositivo no puede decodificar el stream."
    else -> error.errorCodeName
  }
}
