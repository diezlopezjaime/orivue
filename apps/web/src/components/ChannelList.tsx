import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
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
}: {
  channels: Channel[];
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowHeight = typeof window !== 'undefined' && window.innerWidth >= 2560 ? 106 : 82;
  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    initialRect: { width: 900, height: 640 },
    overscan: 8,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const rows = virtualRows.length
    ? virtualRows
    : channels
        .slice(0, 10)
        .map((_, index) => ({ index, key: index, start: index * rowHeight, size: rowHeight }));
  if (!channels.length)
    return (
      <div className="empty-state">
        <span>Sin canales</span>
        <p>Importa una lista o prueba otro filtro.</p>
      </div>
    );
  return (
    <div className="channel-scroll" ref={parentRef} role="list" aria-label="Canales">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {rows.map((row) => {
          const channel = channels[row.index];
          if (!channel) return null;
          return (
            <div
              className="channel-row"
              role="listitem"
              key={channel.id}
              style={{ transform: `translateY(${row.start}px)`, height: row.size }}
            >
              <button
                data-tv-focus
                className="channel-main"
                onClick={() => onPlay(channel)}
                aria-label={`Reproducir ${channel.name}`}
              >
                <span className="channel-number">
                  {channel.number ?? String(row.index + 1).padStart(2, '0')}
                </span>
                <Logo src={channel.logoUrl} name={channel.name} />
                <span className="channel-copy">
                  <strong>{channel.name}</strong>
                  <small>{channel.now?.title ?? 'Sin información de programación'}</small>
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
                    ? `Quitar ${channel.name} de favoritos`
                    : `Añadir ${channel.name} a favoritos`
                }
                onClick={() => onFavorite(channel)}
              >
                <Icon name="heart" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function formatTime(input: string): string {
  return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(input),
  );
}
