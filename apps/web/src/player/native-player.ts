import type { NativePlayerApi } from '../platform';
import type { Player, PlayerCallbacks } from './types';

/**
 * Android / Fire TV backend: Media3/ExoPlayer drawn behind a transparent
 * webview. The React overlay stays in charge of the UI.
 */
export function createNativePlayer(api: NativePlayerApi, callbacks: PlayerCallbacks): Player {
  let unsubscribe: (() => void) | undefined;
  let loaded = false;
  const subscription = api.subscribe((event) => {
    if (event.type === 'tracks') {
      callbacks.onTracks({
        audio: event.audio.map((track) => ({ id: track.id, label: track.label })),
        text: event.text.map((track) => ({ id: track.id, label: track.label })),
      });
      return;
    }
    switch (event.state) {
      case 'buffering':
        callbacks.onStatus('buffering');
        break;
      case 'playing':
      case 'paused':
        callbacks.onStatus('playing');
        break;
      case 'ended':
        callbacks.onStatus('error', 'La emisión ha terminado.');
        break;
      case 'error':
        callbacks.onStatus('error', event.message ?? 'El reproductor nativo no pudo reproducir.');
        break;
    }
  });
  void subscription.then((stop) => {
    unsubscribe = stop;
  });
  document.documentElement.classList.add('native-video');
  return {
    kind: 'native',
    async load(stream, title) {
      callbacks.onStatus('connecting');
      callbacks.onTracks({ audio: [], text: [] });
      loaded = true;
      await api.load({
        url: stream.upstreamUrl,
        headers: stream.headers,
        kind: stream.kind,
        title,
      });
    },
    async stop() {
      if (!loaded) return;
      loaded = false;
      await api.stop().catch(() => undefined);
    },
    setVolume(volume, muted) {
      void api.setVolume(volume, muted).catch(() => undefined);
    },
    setPaused(paused) {
      void api.setPaused(paused).catch(() => undefined);
    },
    setAspect(mode) {
      void api.setAspect(mode).catch(() => undefined);
    },
    selectTrack(kind, id) {
      void api.selectTrack(kind, id).catch(() => undefined);
    },
    destroy() {
      document.documentElement.classList.remove('native-video');
      unsubscribe?.();
      void api.stop().catch(() => undefined);
    },
  };
}
