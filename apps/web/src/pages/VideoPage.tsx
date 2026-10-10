import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useBackButton } from '../hooks/useBackButton';
import { useT } from '../i18n';
import { useAppStore } from '../store';
import type { VodItem, VodKind } from '../types';

export function VideoPage() {
  const t = useT();
  const playVod = useAppStore((state) => state.playVod);
  const [kind, setKind] = useState<VodKind>('movie');
  const [categoryId, setCategoryId] = useState<string>();
  const [search, setSearch] = useState('');
  const [series, setSeries] = useState<VodItem>();
  const categories = useQuery({
    queryKey: ['vodCategories', kind],
    queryFn: () => api.vodCategories(kind),
  });
  const items = useQuery({
    queryKey: ['vod', kind, categoryId, search],
    queryFn: () => api.vod({ kind, categoryId, search, limit: 400 }),
  });
  useEffect(() => {
    setCategoryId(undefined);
    setSeries(undefined);
  }, [kind]);
  const total = items.data?.total ?? 0;
  const hasCatalogue = Boolean(categories.data?.length) || total > 0 || Boolean(search);
  return (
    <section className="page video-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t('video.eyebrow')}</span>
          <h1>{t('video.title')}</h1>
        </div>
        <label className="search-box">
          <Icon name="search" />
          <span className="sr-only">{t('common.search')}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('video.searchPlaceholder')}
          />
        </label>
      </header>
      <div className="source-tabs" role="tablist">
        {(['movie', 'series'] as const).map((id) => (
          <button
            key={id}
            data-tv-focus
            role="tab"
            aria-selected={kind === id}
            className={kind === id ? 'selected' : ''}
            onClick={() => setKind(id)}
          >
            {id === 'movie' ? t('video.movies') : t('video.series')}
          </button>
        ))}
      </div>
      {!hasCatalogue && !items.isLoading ? (
        <div className="empty-state large">
          <Icon name="video" />
          <strong>{t('video.empty')}</strong>
          <p>{t('video.emptyHint')}</p>
        </div>
      ) : (
        <div className="browser-grid">
          <aside className="category-panel" aria-label={t('browse.categoriesLabel')}>
            <p className="panel-label">{t('browse.categories')}</p>
            <div className="category-list">
              <button
                data-tv-focus
                className={!categoryId ? 'selected' : ''}
                onClick={() => setCategoryId(undefined)}
              >
                <span>{t('video.all')}</span>
              </button>
              {categories.data?.map((category) => (
                <button
                  data-tv-focus
                  key={category.id}
                  className={categoryId === category.id ? 'selected' : ''}
                  onClick={() => setCategoryId(category.id)}
                >
                  <span>{category.name}</span>
                  <small>{category.count}</small>
                </button>
              ))}
            </div>
          </aside>
          <main className="channels-panel">
            <div className="panel-heading">
              <div>
                <span className="accent-line" />
                <h2>{kind === 'movie' ? t('video.movies') : t('video.series')}</h2>
              </div>
              <span>{t('video.items', { count: total })}</span>
            </div>
            {items.data && items.data.items.length === 0 && (
              <div className="empty-state">
                <span>{t('video.noResults')}</span>
              </div>
            )}
            <div className="poster-grid">
              {items.data?.items.map((item) => (
                <button
                  data-tv-focus
                  key={item.id}
                  className="poster-card"
                  onClick={() => (item.kind === 'movie' ? playVod({ item }) : setSeries(item))}
                  aria-label={item.name}
                >
                  {item.poster ? (
                    <img src={item.poster} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="poster-fallback">{item.name.slice(0, 2).toUpperCase()}</span>
                  )}
                  <span className="poster-copy">
                    <strong>{item.name}</strong>
                    <small>
                      {[item.year, item.rating ? `★ ${item.rating.toFixed(1)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </main>
        </div>
      )}
      {series && <SeriesDetails item={series} onClose={() => setSeries(undefined)} />}
    </section>
  );
}

function SeriesDetails({ item, onClose }: { item: VodItem; onClose: () => void }) {
  const t = useT();
  const playVod = useAppStore((state) => state.playVod);
  const [season, setSeason] = useState<number>();
  const info = useQuery({ queryKey: ['series', item.id], queryFn: () => api.seriesInfo(item.id) });
  useBackButton(onClose);
  const seasons = info.data?.seasons ?? [];
  const active = seasons.find((entry) => entry.season === season) ?? seasons[0];
  return (
    <div className="series-details" data-tv-root role="dialog" aria-label={item.name}>
      <header>
        <button
          data-tv-focus
          className="icon-button"
          onClick={onClose}
          aria-label={t('video.back')}
        >
          <Icon name="back" />
        </button>
        <div>
          <h2>{item.name}</h2>
          <small>{[item.year, item.categoryName].filter(Boolean).join(' · ')}</small>
        </div>
      </header>
      {info.isLoading && <p className="dialog-subtitle">{t('video.loadingSeries')}</p>}
      {info.isError && <p className="form-error">{t('video.seriesFailed')}</p>}
      {(info.data?.plot ?? item.plot) && <p className="plot">{info.data?.plot ?? item.plot}</p>}
      {seasons.length > 1 && (
        <div className="source-tabs" role="tablist">
          {seasons.map((entry) => (
            <button
              key={entry.season}
              data-tv-focus
              role="tab"
              aria-selected={active?.season === entry.season}
              className={active?.season === entry.season ? 'selected' : ''}
              onClick={() => setSeason(entry.season)}
            >
              {t('video.season', { number: entry.season })}
            </button>
          ))}
        </div>
      )}
      <ul className="episode-list">
        {active?.episodes.map((episode) => (
          <li key={episode.id}>
            <button data-tv-focus onClick={() => playVod({ item, episode })}>
              <span className="episode-number">
                {episode.season}x{String(episode.number).padStart(2, '0')}
              </span>
              <span className="episode-copy">
                <strong>{episode.title}</strong>
                {episode.durationSeconds ? (
                  <small>
                    {t('video.minutes', { count: Math.round(episode.durationSeconds / 60) })}
                  </small>
                ) : null}
              </span>
              <Icon name="play" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
