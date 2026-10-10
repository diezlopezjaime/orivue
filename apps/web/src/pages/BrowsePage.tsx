import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from '../api';
import { ChannelList } from '../components/ChannelList';
import { ChannelOptions } from '../components/ChannelOptions';
import { GroupManager } from '../components/GroupManager';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useNumericZap } from '../hooks/useNumericZap';
import { formatDate, useT } from '../i18n';
import { useAppStore } from '../store';
import type { Channel } from '../types';

export function BrowsePage() {
  const t = useT();
  const state = useAppStore();
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<Channel>();
  const [managingGroups, setManagingGroups] = useState(false);
  const [highlight, setHighlight] = useState<number>();
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.groups });
  const channels = useQuery({
    queryKey: ['channels', state.selectedGroupId, state.filter, state.search],
    queryFn: () =>
      api.channels({
        groupId: state.selectedGroupId,
        search: state.search,
        favorite: state.filter === 'favorites' || undefined,
        recent: state.filter === 'recent' || undefined,
        hiddenOnly: state.filter === 'hidden' || undefined,
      }),
  });
  const recents = useQuery({
    queryKey: ['channels', 'continue'],
    queryFn: () => api.channels({ recent: true }),
  });
  const favorite = useMutation({
    mutationFn: (channel: Channel) => api.favorite(channel.id, !channel.favorite),
    onMutate: async (channel) => {
      await queryClient.cancelQueries({ queryKey: ['channels'] });
      queryClient.setQueriesData<Channel[]>({ queryKey: ['channels'] }, (old) =>
        old?.map((item) => (item.id === channel.id ? { ...item, favorite: !item.favorite } : item)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['channels'] }),
  });
  const list = channels.data ?? [];
  const zapTo = useCallback(
    (number: number) => {
      const index = list.findIndex((channel) => channel.number === number);
      if (index < 0) return;
      setHighlight(index);
      state.play(list[index]);
    },
    [list, state],
  );
  const digits = useNumericZap(zapTo, !state.currentChannel && !options && !managingGroups);
  const visibleGroups = groups.data?.filter((group) => !group.hidden) ?? [];
  const title =
    state.filter === 'favorites'
      ? t('browse.favorites')
      : state.filter === 'recent'
        ? t('browse.recent')
        : state.filter === 'hidden'
          ? t('browse.hidden')
          : (groups.data?.find((group) => group.id === state.selectedGroupId)?.name ??
            t('browse.allChannels'));
  const continueWith = recents.data?.[0];
  return (
    <section className="page browse-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t('browse.eyebrow')}</span>
          <h1>{t('browse.title')}</h1>
        </div>
        <label className="search-box">
          <Icon name="search" />
          <span className="sr-only">{t('browse.searchLabel')}</span>
          <input
            value={state.search}
            onChange={(event) => state.setSearch(event.target.value)}
            placeholder={t('browse.searchPlaceholder')}
          />
        </label>
        <time>
          {formatDate(new Date(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
        </time>
      </header>
      {continueWith && state.filter === 'all' && !state.selectedGroupId && !state.search && (
        <button
          data-tv-focus
          className="continue-banner"
          onClick={() => state.play(continueWith)}
          aria-label={`${t('browse.continueWatching')}: ${continueWith.name}`}
        >
          <Logo src={continueWith.logoUrl} name={continueWith.name} />
          <span>
            <small>{t('browse.continueWatching')}</small>
            <strong>{continueWith.name}</strong>
          </span>
          <Icon name="play" />
        </button>
      )}
      <div className="browser-grid">
        <aside className="category-panel" aria-label={t('browse.categoriesLabel')}>
          <p className="panel-label">{t('browse.library')}</p>
          <button
            data-tv-focus
            className={!state.selectedGroupId && state.filter === 'all' ? 'selected' : ''}
            onClick={() => state.setGroup()}
          >
            <Icon name="live" />
            <span>{t('browse.all')}</span>
          </button>
          <button
            data-tv-focus
            className={state.filter === 'favorites' ? 'selected' : ''}
            onClick={() => state.setFilter('favorites')}
          >
            <Icon name="heart" />
            <span>{t('browse.favorites')}</span>
          </button>
          <button
            data-tv-focus
            className={state.filter === 'recent' ? 'selected' : ''}
            onClick={() => state.setFilter('recent')}
          >
            <Icon name="clock" />
            <span>{t('browse.recentShort')}</span>
          </button>
          <button
            data-tv-focus
            className={state.filter === 'hidden' ? 'selected' : ''}
            onClick={() => state.setFilter('hidden')}
          >
            <Icon name="eyeOff" />
            <span>{t('browse.hidden')}</span>
          </button>
          <p className="panel-label">{t('browse.categories')}</p>
          <div className="category-list">
            {visibleGroups.map((group) => (
              <button
                data-tv-focus
                className={state.selectedGroupId === group.id ? 'selected' : ''}
                key={group.id}
                onClick={() => state.setGroup(group.id)}
              >
                <span>{group.name}</span>
                <small>{group.channelCount ?? ''}</small>
              </button>
            ))}
          </div>
          {Boolean(groups.data?.length) && (
            <button data-tv-focus className="manage-groups" onClick={() => setManagingGroups(true)}>
              <Icon name="settings" />
              <span>{t('browse.manageCategories')}</span>
            </button>
          )}
        </aside>
        <main className="channels-panel">
          <div className="panel-heading">
            <div>
              <span className="accent-line" />
              <h2>{title}</h2>
            </div>
            <span>{t('common.channels', { count: list.length })}</span>
          </div>
          {channels.isLoading ? (
            <LoadingRows label={t('browse.loadingChannels')} />
          ) : channels.isError ? (
            <ErrorState retry={() => void channels.refetch()} />
          ) : (
            <ChannelList
              channels={list}
              onPlay={state.play}
              onFavorite={(channel) => favorite.mutate(channel)}
              onOptions={setOptions}
              highlightIndex={highlight}
            />
          )}
        </main>
      </div>
      {digits && (
        <div className="zap-overlay" role="status">
          {digits}
        </div>
      )}
      {options && <ChannelOptions channel={options} onClose={() => setOptions(undefined)} />}
      {managingGroups && <GroupManager onClose={() => setManagingGroups(false)} />}
    </section>
  );
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div className="loading-rows" aria-label={label}>
      {Array.from({ length: 7 }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}
function ErrorState({ retry }: { retry: () => void }) {
  const t = useT();
  return (
    <div className="empty-state">
      <strong>{t('browse.loadFailed')}</strong>
      <p>{t('browse.loadFailedHint')}</p>
      <button data-tv-focus className="primary-button" onClick={retry}>
        {t('common.retry')}
      </button>
    </div>
  );
}
