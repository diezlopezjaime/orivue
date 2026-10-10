import type Hls from 'hls.js';
import type Mpegts from 'mpegts.js';
import type { StreamHandle } from '../platform';
import type { Player, PlayerCallbacks } from './types';

type HlsModule = typeof Hls;
type MpegtsModule = typeof Mpegts;

let hlsModule: Promise<HlsModule> | undefined;
let mpegtsModule: Promise<MpegtsModule> | undefined;

function loadHls(): Promise<HlsModule> {
  hlsModule ??= import('hls.js').then((module) => module.default);
  return hlsModule;
}

function loadMpegts(): Promise<MpegtsModule> {
  mpegtsModule ??= import('mpegts.js').then((module) => module.default);
  return mpegtsModule;
}

const UNSUPPORTED_CODEC =
  'Este stream usa un códec que el reproductor web no puede decodificar. En Android o Fire TV se usa el reproductor nativo.';

/**
 * Web backend: native `<video>` for HLS on WebKit and progressive files,
 * hls.js for HLS elsewhere and mpegts.js for MPEG-TS/FLV over MSE.
 */
export function createWebPlayer(video: HTMLVideoElement, callbacks: PlayerCallbacks): Player {
  let hls: Hls | undefined;
  let mpegts: Mpegts.Player | undefined;
  let generation = 0;

  const teardown = () => {
    generation += 1;
    if (hls) {
      hls.stopLoad();
      hls.destroy();
      hls = undefined;
    }
    if (mpegts) {
      try {
        mpegts.pause();
        mpegts.unload();
        mpegts.detachMediaElement();
        mpegts.destroy();
      } catch {
        /* already destroyed */
      }
      mpegts = undefined;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  const play = () => {
    void video.play().catch(() => callbacks.onStatus('buffering'));
  };

  const attachNative = (url: string) => {
    video.src = url;
    play();
  };

  const attachHls = async (url: string, current: number) => {
    const HlsClass = await loadHls();
    if (current !== generation) return;
    if (!HlsClass.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        attachNative(url);
        return;
      }
      callbacks.onStatus('error', 'Este navegador no admite la reproducción HLS.');
      return;
    }
    hls = new HlsClass({ maxBufferLength: 30, backBufferLength: 10, enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
      callbacks.onTracks({
        audio: (hls?.audioTracks ?? []).map((track, id) => ({
          id: String(id),
          label: track.name || track.lang || `Pista ${id + 1}`,
        })),
        text: (hls?.subtitleTracks ?? []).map((track, id) => ({
          id: String(id),
          label: track.name || track.lang || `Subtítulo ${id + 1}`,
        })),
      });
      play();
    });
    hls.on(HlsClass.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      const type = String(data.type);
      const message =
        type === 'mediaError'
          ? UNSUPPORTED_CODEC
          : type === 'networkError'
            ? 'No se pudo descargar el stream HLS.'
            : String(data.details);
      callbacks.onStatus('error', message);
    });
  };

  const attachMpegts = async (stream: StreamHandle, current: number) => {
    const MpegtsClass = await loadMpegts();
    if (current !== generation) return;
    const features = MpegtsClass.getFeatureList();
    if (!features.mseLivePlayback) {
      callbacks.onStatus('error', 'Este navegador no admite MPEG-TS en directo.');
      return;
    }
    const isFlv =
      /\.flv(?:$|[?#])/i.test(stream.upstreamUrl) || (stream.contentType ?? '').includes('x-flv');
    mpegts = MpegtsClass.createPlayer(
      { type: isFlv ? 'flv' : 'mpegts', isLive: true, url: stream.url, cors: true },
      {
        enableWorker: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 6,
        liveBufferLatencyMinRemain: 1.5,
        autoCleanupSourceBuffer: true,
        lazyLoad: false,
        reuseRedirectedURL: true,
      },
    );
    mpegts.attachMediaElement(video);
    mpegts.on(MpegtsClass.Events.ERROR, (type: string, detail: string) => {
      const message =
        type === MpegtsClass.ErrorTypes.MEDIA_ERROR
          ? UNSUPPORTED_CODEC
          : detail === MpegtsClass.ErrorDetails.NETWORK_STATUS_CODE_INVALID
            ? 'El servidor rechazó la conexión al stream.'
            : 'No se pudo descargar el stream MPEG-TS.';
      callbacks.onStatus('error', message);
    });
    mpegts.on(MpegtsClass.Events.MEDIA_INFO, () => callbacks.onTracks({ audio: [], text: [] }));
    mpegts.load();
    play();
  };

  return {
    kind: 'web',
    async load(stream) {
      teardown();
      const current = generation;
      callbacks.onStatus('connecting');
      callbacks.onTracks({ audio: [], text: [] });
      switch (stream.kind) {
        case 'hls':
          if (video.canPlayType('application/vnd.apple.mpegurl')) attachNative(stream.url);
          else await attachHls(stream.url, current);
          break;
        case 'http':
          attachNative(stream.url);
          break;
        default:
          await attachMpegts(stream, current);
      }
    },
    stop() {
      teardown();
      return Promise.resolve();
    },
    setVolume(volume, muted) {
      video.volume = volume;
      video.muted = muted;
    },
    setPaused(paused) {
      if (paused) video.pause();
      else play();
    },
    setAspect(mode) {
      video.style.objectFit = mode;
    },
    selectTrack(kind, id) {
      const index = id === null ? -1 : Number(id);
      if (kind === 'audio') {
        if (hls) hls.audioTrack = index;
        return;
      }
      if (hls) hls.subtitleTrack = index;
      for (let i = 0; i < video.textTracks.length; i += 1) {
        const track = video.textTracks[i];
        if (track) track.mode = i === index ? 'showing' : 'disabled';
      }
    },
    destroy() {
      teardown();
    },
  };
}
