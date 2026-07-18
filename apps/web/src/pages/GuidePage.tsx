import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api';
import { formatTime } from '../components/ChannelList';
import { Logo } from '../components/Logo';
import { useAppStore } from '../store';
import type { Program } from '../types';

const HOUR = 3_600_000;

export function GuidePage() {
  const play = useAppStore((state) => state.play);
  const range = useMemo(() => {
    const from = new Date();
    from.setMinutes(0, 0, 0);
    const to = new Date(from.getTime() + 6 * HOUR);
    return { from, to };
  }, []);
  const timeline = useQuery({
    queryKey: ['timeline', range.from.toISOString()],
    queryFn: () => api.timeline(range.from.toISOString(), range.to.toISOString()),
  });
  const hours = Array.from(
    { length: 7 },
    (_, index) => new Date(range.from.getTime() + index * HOUR),
  );
  return (
    <section className="page guide-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">PROGRAMACIÓN</span>
          <h1>Guía</h1>
        </div>
        <div className="date-chip">
          Hoy ·{' '}
          {new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' }).format(new Date())}
        </div>
      </header>
      <div className="guide-shell">
        <div className="guide-hours">
          <span>Canal</span>
          {hours.map((hour) => (
            <time key={hour.toISOString()}>{formatTime(hour.toISOString())}</time>
          ))}
        </div>
        <div className="guide-scroll">
          {timeline.isLoading && (
            <div className="loading-rows">
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
          {timeline.isError && (
            <div className="empty-state">
              <strong>Guía no disponible</strong>
              <p>Los canales siguen disponibles aunque no exista información EPG.</p>
            </div>
          )}
          {timeline.data?.map(({ channel, programs }) => (
            <div className="guide-row" key={channel.id}>
              <button data-tv-focus className="guide-channel" onClick={() => play(channel)}>
                <Logo src={channel.logoUrl} name={channel.name} />
                <span>{channel.name}</span>
              </button>
              <div className="program-lane">
                {programs.map((program) => (
                  <ProgramBlock
                    key={program.id ?? `${program.startsAt}-${program.title}`}
                    program={program}
                    start={range.from.getTime()}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProgramBlock({ program, start }: { program: Program; start: number }) {
  const left = Math.max(0, ((new Date(program.startsAt).getTime() - start) / HOUR) * 180);
  const width = Math.max(
    70,
    ((new Date(program.endsAt).getTime() - new Date(program.startsAt).getTime()) / HOUR) * 180,
  );
  const live =
    new Date(program.startsAt).getTime() <= Date.now() &&
    new Date(program.endsAt).getTime() > Date.now();
  return (
    <button
      data-tv-focus
      className={`program-block ${live ? 'live' : ''}`}
      style={{ left, width }}
      title={program.description ?? program.title}
    >
      <small>{formatTime(program.startsAt)}</small>
      <strong>{program.title}</strong>
    </button>
  );
}
