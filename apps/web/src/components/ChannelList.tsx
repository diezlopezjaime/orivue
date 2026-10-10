import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import { formatTime, useT } from '../i18n';
import type { Channel } from '../types';
import { Icon } from './Icon';
import { Logo } from './Logo';

function progress(channel: Channel): number {
  if (!channel.now) return 0;
  const start = new Date(channel.now.startsAt).getTime();
  const end = new Date(channel.now.endsAt).getTime();
  return Math.min(100, Math.max(0, ((Date.now() - start) / Math.max(1, end - start)) * 100));
}

export function ChannelList({
  channels,
  onPlay,
  onFavorite,
  onOptions,
  highlightIndex,
}: {
  channels: Channel[];
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel) => void;
  onOptions?: ((channel: Channel) => void) | undefined;
  /** Row to scroll into view (numeric zapping). */
  highlightIndex?: number | undefined;
}) {
  const t = useT();
  const parentRef = useRef<HTMLDivElement>(null);
  const rowHeight = typeof window !== 'undefined' && window.innerWidth >= 2560 ? 106 : 82;
  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    initialRect: { width: 900, height: 640 },
    overscan: 8,
  });
  useEffect(() => {
    if (highlightIndex !== undefined && highlightIndex >= 0 && highlightIndex < channels.length)
      virtualizer.scrollToIndex(highlightIndex, { align: 'center' });
  }, [channels.length, highlightIndex, virtualizer]);
  const virtualRows = virtualizer.getVirtualItems();
  const rows = virtualRows.length
    ? virtualRows
    : channels
        .slice(0, 10)
        .map((_, index) => ({ index, key: index, start: index * rowHeight, size: rowHeight }));
  if (!channels.length)
    return (
      <div className="empty-state">
        <span>{t('browse.noChannels')}</span>
        <p>{t('browse.noChannelsHint')}</p>
      </div>
    );
  return (
    <div
      className="channel-scroll"
      ref={parentRef}
      role="list"
      aria-label={t('browse.channelsLabel')}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {rows.map((row) => {
          const channel = channels[row.index];
          if (!channel) return null;
          return (
            <div
              className={`channel-row ${row.index === highlightIndex ? 'highlight' : ''}`}
              role="listitem"
              key={channel.id}
              style={{ transform: `translateY(${row.start}px)`, height: row.size }}
            >
              <button
                data-tv-focus
                className="channel-main"
                onClick={() => onPlay(channel)}
                aria-label={t('channel.play', { name: channel.name })}
              >
                <span className="channel-number">
                  {channel.number ?? String(row.index + 1).padStart(2, '0')}
                </span>
                <Logo src={channel.logoUrl} name={channel.name} />
                <span className="channel-copy">
                  <strong>{channel.name}</strong>
                  <small>{channel.now?.title ?? t('channel.noProgram')}</small>
                  {channel.now && (
                    <span className="program-progress">
                      <i style={{ width: `${progress(channel)}%` }} />
                    </span>
                  )}
                </span>
                <span className="channel-time">
                  {channel.now ? formatTime(channel.now.endsAt) : '—'}
                </span>
                <span className="play-pill">
                  <Icon name="play" />
                </span>
              </button>
              <button
                data-tv-focus
                className={`favorite-button ${channel.favorite ? 'active' : ''}`}
                aria-label={
                  channel.favorite
                    ? t('channel.removeFavorite', { name: channel.name })
                    : t('channel.addFavorite', { name: channel.name })
                }
                onClick={() => onFavorite(channel)}
              >
                <Icon name="heart" />
              </button>
              {onOptions && (
                <button
                  data-tv-focus
                  className="options-button"
                  aria-label={t('channel.options', { name: channel.name })}
                  onClick={() => onOptions(channel)}
                >
                  <Icon name="more" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
