import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { getAppPlatform, getDevice } from '../engine';
import { useBackButton } from '../hooks/useBackButton';
import { useNumericZap } from '../hooks/useNumericZap';
import { useT } from '../i18n';
import type { StreamHandle } from '../platform';
import { createNativePlayer } from '../player/native-player';
import type { Player, PlayerTracks } from '../player/types';
import { createWebPlayer } from '../player/web-player';
import { useAppStore } from '../store';
import type { Channel, PlaybackStatus, VodTarget } from '../types';
import { Icon } from './Icon';
import { Logo } from './Logo';

export type PlayTarget =
  { kind: 'channel'; channel: Channel; channels: Channel[] } | { kind: 'vod'; vod: VodTarget };

const kindLabel: Record<string, string> = {
  hls: 'HLS',
  mpegts: 'MPEG-TS',
  http: 'HTTP',
  acestream: 'Ace Stream',
  unknown: '',
};

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

export function PlayerOverlay({
  target,
  onClose,
  onChange,
}: {
  target: PlayTarget;
  onClose: () => void;
  onChange: (channel: Channel) => void;
}) {
  const t = useT();
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
  const [position, setPosition] = useState<{ position: number; duration: number }>();
  const [streamKind, setStreamKind] = useState<string>('unknown');
  const { volume, muted, aspect, setVolume, setMuted, cycleAspect, playerPreference, lastChannel } =
    useAppStore();
  const device = getDevice();

  const channel = target.kind === 'channel' ? target.channel : undefined;
  const channels = target.kind === 'channel' ? target.channels : [];
  const playKey =
    target.kind === 'channel'
      ? `channel:${target.channel.id}`
      : `vod:${target.vod.item.id}:${target.vod.episode?.id ?? ''}`;
  const title =
    target.kind === 'channel'
      ? target.channel.name
      : target.vod.episode
        ? `${target.vod.item.name} · ${target.vod.episode.season}x${String(target.vod.episode.number).padStart(2, '0')} ${target.vod.episode.title}`
        : target.vod.item.name;
  const subtitle =
    target.kind === 'channel'
      ? (target.channel.groupName ?? t('player.channelLabel'))
      : (target.vod.item.categoryName ?? t('video.title'));
  const logo = target.kind === 'channel' ? target.channel.logoUrl : target.vod.item.poster;
  const live = target.kind === 'channel';

  const changeRelative = useCallback(
    (offset: number) => {
      if (!channel || !channels.length) return;
      const index = channels.findIndex((item) => item.id === channel.id);
      if (index < 0) return;
      const next = channels[(index + offset + channels.length) % channels.length];
      if (next) onChange(next);
    },
    [channel, channels, onChange],
  );
  const goToNumber = useCallback(
    (number: number) => {
      const next = channels.find((item) => item.number === number);
      if (next) onChange(next);
    },
    [channels, onChange],
  );
  const digits = useNumericZap(goToNumber, live);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  useEffect(() => {
    retryRef.current = 0;
  }, [playKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let handle: StreamHandle | undefined;
    setStatus('connecting');
    setMessage('');
    setPaused(false);
    setPosition(undefined);

    const fail = (detail?: string) => {
      if (cancelled) return;
      if (
        retryRef.current < 2 &&
        live &&
        !detail?.includes('códec') &&
        !detail?.includes('codec')
      ) {
        retryRef.current += 1;
        setStatus('retrying');
        window.setTimeout(() => setAttempt((value) => value + 1), 900 * retryRef.current);
      } else {
        setStatus('error');
        setMessage(detail ?? t('player.errorHint'));
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
      onPosition: (current: number, duration: number) => {
        if (!cancelled) setPosition({ position: current, duration });
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
        const playable =
          target.kind === 'channel'
            ? await api.playable(target.channel.id)
            : await api.playableVod(target.vod.item.id, target.vod.episode?.id);
        if (cancelled) return;
        handle = await platform.playback.open(playable);
        if (cancelled) return;
        setStreamKind(handle.kind);
        await player.load(handle, playable.title);
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
  }, [attempt, playKey, playerPreference]);

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

  const seekBy = useCallback(
    (delta: number) => {
      if (!position) return;
      playerRef.current?.seek(position.position + delta);
    },
    [position],
  );

  const goLast = useCallback(() => {
    if (lastChannel && (!channel || lastChannel.id !== channel.id)) onChange(lastChannel);
  }, [channel, lastChannel, onChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      showControls();
      const key = event.key;
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (key === 'Escape' || key === 'Backspace' || key === 'GoBack' || key === 'BrowserBack') {
        if (typing && key === 'Backspace') return;
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
      } else if (key === 'MediaRewind' || key === 'MediaTrackPrevious' || key === ',') {
        if (!live) seekBy(-10);
      } else if (key === 'MediaFastForward' || key === 'MediaTrackNext' || key === '.') {
        if (!live) seekBy(30);
      } else if (key.toLowerCase() === 'm' && !typing) setMuted(!muted);
      else if (key.toLowerCase() === 'f' && !typing) void shellRef.current?.requestFullscreen?.();
      else if (key.toLowerCase() === 'r' && !typing) goLast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeRelative, goLast, live, muted, onClose, seekBy, setMuted, showControls, togglePaused]);

  useEffect(() => {
    showControls();
    return () => window.clearTimeout(hideTimer.current);
  }, [showControls]);

  useBackButton(onClose);

  const fullscreen = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : shellRef.current?.requestFullscreen?.();

  const statusText: Record<PlaybackStatus, string> = {
    idle: '',
    connecting: t('player.connecting'),
    buffering: t('player.buffering'),
    playing: t('player.playing'),
    retrying: t('player.retrying'),
    error: t('player.error'),
  };
  const aspectLabel =
    aspect === 'contain'
      ? t('player.aspectContain')
      : aspect === 'cover'
        ? t('player.aspectCover')
        : t('player.aspectFill');

  return (
    <div
      className={`player-shell ${backend === 'native' ? 'native' : ''}`}
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('player.playingLabel', { name: title })}
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
      {digits && (
        <div className="zap-overlay" role="status">
          {digits}
        </div>
      )}
      <div className={`player-shade ${controlsVisible || status !== 'playing' ? 'visible' : ''}`}>
        <header className="player-top">
          <span className="live-badge">
            <i />
            {live ? t('player.live') : t('video.eyebrow')}
            {kindLabel[streamKind] && <em>{kindLabel[streamKind]}</em>}
            {backend === 'native' && <em>{t('player.native')}</em>}
          </span>
          <button
            data-tv-focus
            className="icon-button"
            onClick={onClose}
            aria-label={t('player.closePlayer')}
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
                {t('common.retry')}
              </button>
            )}
          </div>
        )}
        <div className="player-bottom">
          <div className="playing-channel">
            <Logo src={logo} name={title} />
            <div>
              <small>{subtitle}</small>
              <h2>{title}</h2>
              {channel && (
                <p>
                  <strong>{channel.now?.title ?? t('player.nowLive')}</strong>
                  {channel.next && <> · {t('player.after', { title: channel.next.title })}</>}
                </p>
              )}
            </div>
          </div>
          {!live && position && (
            <div className="seek-bar">
              <span>{clock(position.position)}</span>
              <input
                data-tv-focus
                aria-label={t('player.seek')}
                type="range"
                min="0"
                max={Math.max(1, Math.floor(position.duration))}
                step="1"
                value={Math.floor(position.position)}
                onChange={(event) => playerRef.current?.seek(Number(event.target.value))}
              />
              <span>{clock(position.duration)}</span>
            </div>
          )}
          <div className="player-controls">
            {live && (
              <>
                <button
                  data-tv-focus
                  className="icon-button"
                  onClick={() => changeRelative(-1)}
                  aria-label={t('player.previous')}
                >
                  <Icon name="up" />
                </button>
                <button
                  data-tv-focus
                  className="icon-button"
                  onClick={() => changeRelative(1)}
                  aria-label={t('player.next')}
                >
                  <Icon name="down" />
                </button>
                {lastChannel && lastChannel.id !== channel?.id && (
                  <button data-tv-focus className="text-button" onClick={goLast}>
                    {t('player.last')}: {lastChannel.name}
                  </button>
                )}
              </>
            )}
            <button
              data-tv-focus
              className="icon-button"
              onClick={togglePaused}
              aria-label={paused ? t('player.resume') : t('player.pause')}
            >
              <Icon name={paused ? 'play' : 'pause'} />
            </button>
            <button
              data-tv-focus
              className="icon-button"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? t('player.unmute') : t('player.mute')}
            >
              <Icon name="volume" />
            </button>
            <input
              data-tv-focus
              aria-label={t('player.volume')}
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
                aria-label={t('player.audioTrack')}
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
                aria-label={t('player.subtitles')}
                defaultValue=""
                onChange={(event) =>
                  playerRef.current?.selectTrack('text', event.target.value || null)
                }
              >
                <option value="">{t('player.subtitlesOff')}</option>
                {tracks.text.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </select>
            )}
            <button data-tv-focus className="text-button" onClick={cycleAspect}>
              {t('player.aspect', { mode: aspectLabel })}
            </button>
            {!device.tv && (
              <button
                data-tv-focus
                className="icon-button"
                onClick={() => void fullscreen()}
                aria-label={t('player.fullscreen')}
              >
                <Icon name="fullscreen" />
              </button>
            )}
          </div>
          <p className="player-hint">{device.tv ? t('player.hintTv') : t('player.hintDesktop')}</p>
        </div>
      </div>
    </div>
  );
}
