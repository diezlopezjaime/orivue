import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAppStore } from '../store';
import type { Channel, PlaybackSession, PlaybackStatus } from '../types';
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
  const hlsRef = useRef<Hls | undefined>(undefined);
  const retryRef = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PlaybackStatus>('connecting');
  const [message, setMessage] = useState('');
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; name: string }>>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ id: number; name: string }>>([]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const { volume, muted, aspect, setVolume, setMuted, cycleAspect } = useAppStore();

  const changeRelative = useCallback(
    (offset: number) => {
      const index = channels.findIndex((item) => item.id === channel.id);
      if (index < 0 || !channels.length) return;
      const next = channels[(index + offset + channels.length) % channels.length];
      if (next) onChange(next);
    },
    [channel.id, channels, onChange],
  );

  useEffect(() => {
    retryRef.current = 0;
  }, [channel.id]);

  useEffect(() => {
    const controller = new AbortController();
    let session: PlaybackSession | undefined;
    let hls: Hls | undefined;
    const video = videoRef.current;
    if (!video) return;
    let failed = false;
    setStatus('connecting');
    setMessage('');
    setAudioTracks([]);
    setSubtitleTracks([]);

    const fail = (detail?: string) => {
      if (controller.signal.aborted || failed) return;
      failed = true;
      if (retryRef.current < 2) {
        retryRef.current += 1;
        setStatus('retrying');
        window.setTimeout(() => setAttempt((value) => value + 1), 900 * retryRef.current);
      } else {
        setStatus('error');
        setMessage(detail ?? 'Comprueba la fuente o vuelve a intentarlo.');
      }
    };

    const attach = (playback: PlaybackSession) => {
      session = playback;
      const source = playback.url;
      if (playback.type === 'http') {
        video.src = source;
        void video.play().catch(() => setStatus('buffering'));
        return;
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = source;
        void video.play().catch(() => setStatus('buffering'));
        return;
      }
      if (Hls.isSupported()) {
        hls = new Hls({ maxBufferLength: 30, backBufferLength: 10, enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(source);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setAudioTracks(
            hls?.audioTracks.map((track, id) => ({
              id,
              name: track.name || track.lang || `Pista ${id + 1}`,
            })) ?? [],
          );
          setSubtitleTracks(
            hls?.subtitleTracks.map((track, id) => ({
              id,
              name: track.name || track.lang || `Subtítulo ${id + 1}`,
            })) ?? [],
          );
          void video.play().catch(() => setStatus('buffering'));
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) fail(data.details);
        });
        return;
      }
      setStatus('error');
      setMessage('Este navegador no admite la reproducción HLS.');
    };

    void api
      .createPlayback(channel.id, controller.signal)
      .then(attach)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) fail(error instanceof Error ? error.message : undefined);
      });
    return () => {
      controller.abort();
      hls?.stopLoad();
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = undefined;
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (session) void api.stopPlayback(session.id).catch(() => undefined);
    };
  }, [attempt, channel.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = muted;
    }
  }, [muted, volume]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      setControlsVisible(true);
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'PageUp' || event.key === 'ChannelUp') {
        event.preventDefault();
        changeRelative(-1);
      }
      if (event.key === 'PageDown' || event.key === 'ChannelDown') {
        event.preventDefault();
        changeRelative(1);
      }
      if (event.key.toLowerCase() === 'm') setMuted(!muted);
      if (event.key.toLowerCase() === 'f') void shellRef.current?.requestFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeRelative, muted, onClose, setMuted]);

  const fullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen();
  const selectAudio = (value: string) => {
    const index = Number(value);
    if (hlsRef.current) hlsRef.current.audioTrack = index;
    const video = videoRef.current;
    const tracks =
      video && 'audioTracks' in video
        ? (
            video as HTMLVideoElement & {
              audioTracks: { length: number; [key: number]: { enabled: boolean } };
            }
          ).audioTracks
        : undefined;
    if (tracks) for (let i = 0; i < tracks.length; i++) tracks[i]!.enabled = i === index;
  };
  const selectSubtitle = (value: string) => {
    const index = Number(value);
    if (hlsRef.current) hlsRef.current.subtitleTrack = index;
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++)
      video.textTracks[i]!.mode = i === index ? 'showing' : 'disabled';
  };

  return (
    <div
      className="player-shell"
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Reproduciendo ${channel.name}`}
      onMouseMove={() => setControlsVisible(true)}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ objectFit: aspect }}
        onPlaying={() => setStatus('playing')}
        onWaiting={() => setStatus('buffering')}
        onError={() => setStatus('error')}
      />
      <div className={`player-shade ${controlsVisible || status !== 'playing' ? 'visible' : ''}`}>
        <header className="player-top">
          <span className="live-badge">
            <i />
            EN DIRECTO
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
            {audioTracks.length > 1 && (
              <select
                data-tv-focus
                aria-label="Pista de audio"
                onChange={(event) => selectAudio(event.target.value)}
              >
                {audioTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            )}
            {subtitleTracks.length > 0 && (
              <select
                data-tv-focus
                aria-label="Subtítulos"
                defaultValue="-1"
                onChange={(event) => selectSubtitle(event.target.value)}
              >
                <option value="-1">Subtítulos: no</option>
                {subtitleTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            )}
            <button data-tv-focus className="text-button" onClick={cycleAspect}>
              Ajuste: {aspect === 'contain' ? 'encajar' : aspect === 'cover' ? 'cubrir' : 'estirar'}
            </button>
            <button
              data-tv-focus
              className="icon-button"
              onClick={() => void fullscreen()}
              aria-label="Pantalla completa"
            >
              <Icon name="fullscreen" />
            </button>
          </div>
          <p className="player-hint">
            PgUp / PgDn cambia de canal · Esc cierra · F pantalla completa
          </p>
        </div>
      </div>
    </div>
  );
}
