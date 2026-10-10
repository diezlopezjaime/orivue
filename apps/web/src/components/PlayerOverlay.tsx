import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAppPlatform, getDevice, getEngine } from '../engine';
import { useBackButton } from '../hooks/useBackButton';
import type { StreamHandle } from '../platform';
import { createNativePlayer } from '../player/native-player';
import type { Player, PlayerTracks } from '../player/types';
import { createWebPlayer } from '../player/web-player';
import { useAppStore } from '../store';
import type { Channel, PlaybackStatus } from '../types';
import { Icon } from './Icon';
import { Logo } from './Logo';

const statusText: Record<PlaybackStatus, string> = {
  idle: '',
  connecting: 'Conectando…',
  buffering: 'Cargando emisión…',
  playing: 'En directo',
  retrying: 'Reconectando…',
  error: 'No se pudo reproducir este canal',
};

const kindLabel: Record<string, string> = {
  hls: 'HLS',
  mpegts: 'MPEG-TS',
  http: 'HTTP',
  acestream: 'Ace Stream',
  unknown: '',
};

export function PlayerOverlay({
  channel,
  channels,
  onClose,
  onChange,
}: {
  channel: Channel;
  channels: Channel[];
  onClose: () => void;
  onChange: (channel: Channel) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | undefined>(undefined);
  const retryRef = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PlaybackStatus>('connecting');
  const [message, setMessage] = useState('');
  const [tracks, setTracks] = useState<PlayerTracks>({ audio: [], text: [] });
  const [paused, setPaused] = useState(false);
  const [backend, setBackend] = useState<'web' | 'native'>('web');
  const [controlsVisible, setControlsVisible] = useState(true);
  const { volume, muted, aspect, setVolume, setMuted, cycleAspect, playerPreference } =
    useAppStore();
  const device = getDevice();

  const changeRelative = useCallback(
    (offset: number) => {
      const index = channels.findIndex((item) => item.id === channel.id);
      if (index < 0 || !channels.length) return;
      const next = channels[(index + offset + channels.length) % channels.length];
      if (next) onChange(next);
    },
    [channel.id, channels, onChange],
  );

  const showControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  useEffect(() => {
    retryRef.current = 0;
  }, [channel.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let handle: StreamHandle | undefined;
    setStatus('connecting');
    setMessage('');
    setPaused(false);

    const fail = (detail?: string) => {
      if (cancelled) return;
      if (retryRef.current < 2 && !detail?.includes('códec')) {
        retryRef.current += 1;
        setStatus('retrying');
        window.setTimeout(() => setAttempt((value) => value + 1), 900 * retryRef.current);
      } else {
        setStatus('error');
        setMessage(detail ?? 'Comprueba la fuente o vuelve a intentarlo.');
      }
    };

    const platform = getAppPlatform();
    const useNative =
      platform.native !== null && (playerPreference === 'native' || playerPreference === 'auto');
    const callbacks = {
      onStatus: (next: PlaybackStatus, detail?: string) => {
        if (cancelled) return;
        if (next === 'error') fail(detail);
        else setStatus(next);
      },
      onTracks: (next: PlayerTracks) => {
        if (!cancelled) setTracks(next);
      },
    };
    const player =
      useNative && platform.native
        ? createNativePlayer(platform.native, callbacks)
        : createWebPlayer(video, callbacks);
    playerRef.current = player;
    setBackend(player.kind);
    player.setVolume(volume, muted);
    player.setAspect(aspect);

    void (async () => {
      try {
        const playable = await getEngine().getPlayable(channel.id);
        if (cancelled) return;
        handle = await platform.playback.open(playable);
        if (cancelled) return;
        await player.load(handle, channel.name);
      } catch (error) {
        fail(error instanceof Error ? error.message : undefined);
      }
    })();

    return () => {
      cancelled = true;
      player.destroy();
      if (playerRef.current === player) playerRef.current = undefined;
      if (handle) void platform.playback.close(handle.id);
    };
    // Volume, mute and aspect are applied through separate effects.
  }, [attempt, channel.id, playerPreference]);

  useEffect(() => {
    playerRef.current?.setVolume(volume, muted);
  }, [muted, volume]);

  useEffect(() => {
    playerRef.current?.setAspect(aspect);
  }, [aspect]);

  const togglePaused = useCallback(() => {
    setPaused((value) => {
      playerRef.current?.setPaused(!value);
      return !value;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      showControls();
      const key = event.key;
      if (key === 'Escape' || key === 'Backspace' || key === 'GoBack' || key === 'BrowserBack') {
        event.preventDefault();
        onClose();
      } else if (key === 'PageUp' || key === 'ChannelUp') {
        event.preventDefault();
        changeRelative(-1);
      } else if (key === 'PageDown' || key === 'ChannelDown') {
        event.preventDefault();
        changeRelative(1);
      } else if (
        key === 'MediaPlayPause' ||
        key === 'MediaPlay' ||
        key === 'MediaPause' ||
        key === ' '
      ) {
        if (event.target instanceof HTMLButtonElement && key === ' ') return;
        event.preventDefault();
        togglePaused();
      } else if (key.toLowerCase() === 'm') setMuted(!muted);
      else if (key.toLowerCase() === 'f') void shellRef.current?.requestFullscreen?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeRelative, muted, onClose, setMuted, showControls, togglePaused]);

  useEffect(() => {
    showControls();
    return () => window.clearTimeout(hideTimer.current);
  }, [showControls]);

  useBackButton(onClose);

  const fullscreen = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : shellRef.current?.requestFullscreen?.();

  const kind = useMemo(
    () => kindLabel[channel.streamKind ?? 'unknown'] ?? '',
    [channel.streamKind],
  );

  return (
    <div
      className={`player-shell ${backend === 'native' ? 'native' : ''}`}
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Reproduciendo ${channel.name}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ objectFit: aspect }}
        onPlaying={() => setStatus('playing')}
        onWaiting={() => setStatus('buffering')}
      />
      <div className={`player-shade ${controlsVisible || status !== 'playing' ? 'visible' : ''}`}>
        <header className="player-top">
          <span className="live-badge">
            <i />
            EN DIRECTO
            {kind && <em>{kind}</em>}
            {backend === 'native' && <em>nativo</em>}
          </span>
          <button
            data-tv-focus
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar reproductor"
          >
            <Icon name="close" />
          </button>
        </header>
        {status !== 'playing' && (
          <div className={`player-state ${status === 'error' ? 'error' : ''}`}>
            <span className="state-spinner">
              <Icon name={status === 'error' ? 'retry' : 'live'} />
            </span>
            <strong>{statusText[status]}</strong>
            {message && <p>{message}</p>}
            {status === 'error' && (
              <button
                data-tv-focus
                className="primary-button"
                onClick={() => {
                  retryRef.current = 0;
                  setAttempt((value) => value + 1);
                }}
              >
                <Icon name="retry" />
                Reintentar
              </button>
            )}
          </div>
        )}
        <div className="player-bottom">
          <div className="playing-channel">
            <Logo src={channel.logoUrl} name={channel.name} />
            <div>
              <small>{channel.groupName ?? 'Canal'}</small>
              <h2>{channel.name}</h2>
              <p>
                <strong>{channel.now?.title ?? 'En directo'}</strong>
                {channel.next && <> · Después: {channel.next.title}</>}
              </p>
            </div>
          </div>
          <div className="player-controls">
            <button
              data-tv-focus
              className="icon-button"
              onClick={() => changeRelative(-1)}
              aria-label="Canal anterior"
            >
              <Icon name="up" />
            </button>
            <button
              data-tv-focus
              className="icon-button"
              onClick={() => changeRelative(1)}
              aria-label="Canal siguiente"
            >
              <Icon name="down" />
            </button>
            <button
              data-tv-focus
              className="icon-button"
              onClick={togglePaused}
              aria-label={paused ? 'Reanudar' : 'Pausar'}
            >
              <Icon name={paused ? 'play' : 'pause'} />
            </button>
            <button
              data-tv-focus
              className="icon-button"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            >
              <Icon name="volume" />
            </button>
            <input
              data-tv-focus
              aria-label="Volumen"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            {tracks.audio.length > 1 && (
              <select
                data-tv-focus
                aria-label="Pista de audio"
                onChange={(event) => playerRef.current?.selectTrack('audio', event.target.value)}
              >
                {tracks.audio.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </select>
            )}
            {tracks.text.length > 0 && (
              <select
                data-tv-focus
                aria-label="Subtítulos"
                defaultValue=""
                onChange={(event) =>
                  playerRef.current?.selectTrack('text', event.target.value || null)
                }
              >
                <option value="">Subtítulos: no</option>
                {tracks.text.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </select>
            )}
            <button data-tv-focus className="text-button" onClick={cycleAspect}>
              Ajuste: {aspect === 'contain' ? 'encajar' : aspect === 'cover' ? 'cubrir' : 'estirar'}
            </button>
            {!device.tv && (
              <button
                data-tv-focus
                className="icon-button"
                onClick={() => void fullscreen()}
                aria-label="Pantalla completa"
              >
                <Icon name="fullscreen" />
              </button>
            )}
          </div>
          <p className="player-hint">
            {device.tv
              ? 'Arriba/Abajo cambia de canal · Atrás cierra · Play/Pausa pausa'
              : 'PgUp / PgDn cambia de canal · Esc cierra · F pantalla completa · Espacio pausa'}
          </p>
        </div>
      </div>
    </div>
  );
}
