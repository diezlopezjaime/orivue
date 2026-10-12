import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type CreatePlaylistInput, type CreateXtreamInput } from '../api';
import { Icon } from '../components/Icon';
import { formatDate, useT } from '../i18n';
import type { Playlist } from '../types';

type SourceTab = 'url' | 'xtream' | 'file';

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : null;
}

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

export function ListsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['playlists'] });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SourceTab>('url');
  const [editing, setEditing] = useState<string>();
  const [fileName, setFileName] = useState(() => t('lists.fileDefault'));
  const [notice, setNotice] = useState<string>();

  const close = () => {
    setOpen(false);
    setNotice(undefined);
  };
  const create = useMutation({
    mutationFn: (input: CreatePlaylistInput) => api.createPlaylist(input),
    onSuccess: () => {
      void invalidate();
      close();
    },
    onError: () => void invalidate(),
  });
  const createXtream = useMutation({
    mutationFn: (input: CreateXtreamInput) => api.createXtream(input),
    onSuccess: () => {
      void invalidate();
      close();
    },
    onError: () => void invalidate(),
  });
  const refresh = useMutation({ mutationFn: api.refreshPlaylist, onSettled: invalidate });
  const refreshEpg = useMutation({ mutationFn: api.refreshEpg, onSettled: invalidate });
  const remove = useMutation({ mutationFn: api.deletePlaylist, onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: { name?: string; autoRefreshMinutes?: number };
    }) => api.updatePlaylist(id, input),
    onSuccess: invalidate,
  });
  const importFile = useMutation({
    mutationFn: ({ name, file }: { name: string; file: File }) => api.importPlaylist(name, file),
    onSettled: invalidate,
  });

  const submitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = field(data, 'name').trim();
    const url = field(data, 'url').trim();
    const epgUrl = field(data, 'epgUrl').trim();
    if (name && url) create.mutate({ name, url, ...(epgUrl ? { epgUrl } : {}) });
  };
  const submitXtream = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = field(data, 'name').trim();
    const host = field(data, 'host').trim();
    const username = field(data, 'username').trim();
    const password = field(data, 'password');
    const output = data.get('output') === 'm3u8' ? 'm3u8' : 'ts';
    if (name && host && username && password)
      createXtream.mutate({ name, host, username, password, output });
  };
  const pending = create.isPending || createXtream.isPending;
  const formError = errorText(create.error) ?? errorText(createXtream.error);
  const actionError = errorText(refresh.error) ?? errorText(refreshEpg.error);

  return (
    <section className="page lists-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t('lists.eyebrow')}</span>
          <h1>{t('lists.title')}</h1>
        </div>
        <button
          data-tv-focus
          className="primary-button"
          onClick={() => (open ? close() : setOpen(true))}
        >
          {t('lists.add')}
        </button>
      </header>
      {open && (
        <div className="playlist-form">
          <div className="source-tabs" role="tablist">
            {(
              [
                ['url', t('lists.tabUrl')],
                ['xtream', t('lists.tabXtream')],
                ['file', t('lists.tabFile')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                data-tv-focus
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'selected' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'url' && (
            <form onSubmit={submitUrl}>
              <div>
                <label>
                  {t('lists.name')}
                  <input
                    data-tv-focus
                    required
                    name="name"
                    placeholder={t('lists.namePlaceholder')}
                  />
                </label>
                <label>
                  {t('lists.url')}
                  <input
                    data-tv-focus
                    required
                    name="url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="off"
                    placeholder={t('lists.urlPlaceholder')}
                  />
                </label>
                <label>
                  {t('lists.epgUrl')} <small>{t('common.optional')}</small>
                  <input
                    data-tv-focus
                    name="epgUrl"
                    type="url"
                    inputMode="url"
                    autoCapitalize="off"
                    placeholder={t('lists.epgPlaceholder')}
                  />
                </label>
              </div>
              <p>{t('lists.urlHint')}</p>
              {formError && <p className="form-error">{formError}</p>}
              <button data-tv-focus disabled={pending} className="primary-button">
                {pending ? t('lists.importing') : t('lists.importUrl')}
              </button>
            </form>
          )}
          {tab === 'xtream' && (
            <form onSubmit={submitXtream}>
              <div className="xtream-grid">
                <label>
                  {t('lists.name')}
                  <input data-tv-focus required name="name" placeholder={t('lists.providerName')} />
                </label>
                <label>
                  {t('lists.host')} <small>{t('lists.hostHint')}</small>
                  <input
                    data-tv-focus
                    required
                    name="host"
                    inputMode="url"
                    autoCapitalize="off"
                    placeholder={t('lists.hostPlaceholder')}
                  />
                </label>
                <label>
                  {t('lists.username')}
                  <input data-tv-focus required name="username" autoCapitalize="off" />
                </label>
                <label>
                  {t('lists.password')}
                  <input data-tv-focus required name="password" type="password" />
                </label>
                <label>
                  {t('lists.output')}
                  <select data-tv-focus name="output" defaultValue="ts">
                    <option value="ts">{t('lists.outputTs')}</option>
                    <option value="m3u8">{t('lists.outputHls')}</option>
                  </select>
                </label>
              </div>
              <p>{t('lists.xtreamHint')}</p>
              {formError && <p className="form-error">{formError}</p>}
              <button data-tv-focus disabled={pending} className="primary-button">
                {pending ? t('lists.connecting') : t('lists.connect')}
              </button>
            </form>
          )}
          {tab === 'file' && (
            <div className="file-import inline">
              <div>
                <h2>{t('lists.fileTitle')}</h2>
                <p>{t('lists.fileHint')}</p>
              </div>
              <input
                data-tv-focus
                aria-label={t('lists.fileName')}
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
              />
              <label data-tv-focus className="secondary-button">
                {importFile.isPending ? t('lists.importing') : t('lists.chooseFile')}
                <input
                  type="file"
                  accept=".m3u,.m3u8,application/vnd.apple.mpegurl,audio/x-mpegurl"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      importFile.mutate(
                        { name: fileName || file.name, file },
                        { onSuccess: () => close() },
                      );
                  }}
                />
              </label>
              {errorText(importFile.error) && (
                <p className="form-error">{errorText(importFile.error)}</p>
              )}
            </div>
          )}
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}
      {actionError && <p className="notice form-error">{actionError}</p>}
      <div className="playlist-grid">
        {playlists.data?.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            playlist={playlist}
            editing={editing === playlist.id}
            busy={refresh.isPending || refreshEpg.isPending || playlist.refreshing !== null}
            onEdit={() => setEditing(playlist.id)}
            onRename={(name) => {
              if (name && name !== playlist.name)
                update.mutate({ id: playlist.id, input: { name } });
              setEditing(undefined);
            }}
            onRefresh={() =>
              refresh.mutate(playlist.id, {
                onSuccess: (result) =>
                  setNotice(
                    t('lists.refreshed', {
                      name: playlist.name,
                      channels: result.channelCount,
                      programs: result.programCount,
                    }),
                  ),
              })
            }
            onRefreshEpg={() => refreshEpg.mutate(playlist.id)}
            onAutoRefresh={(minutes) =>
              update.mutate({ id: playlist.id, input: { autoRefreshMinutes: minutes } })
            }
            onRemove={() => {
              if (window.confirm(t('lists.confirmDelete', { name: playlist.name })))
                remove.mutate(playlist.id);
            }}
          />
        ))}
      </div>
      {!playlists.isLoading && !playlists.data?.length && (
        <div className="empty-state large">
          <Icon name="lists" />
          <strong>{t('lists.empty')}</strong>
          <p>{t('lists.emptyHint')}</p>
        </div>
      )}
    </section>
  );
}

function PlaylistCard({
  playlist,
  editing,
  busy,
  onEdit,
  onRename,
  onRefresh,
  onRefreshEpg,
  onAutoRefresh,
  onRemove,
}: {
  playlist: Playlist;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onRename: (name: string) => void;
  onRefresh: () => void;
  onRefreshEpg: () => void;
  onAutoRefresh: (minutes: number) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const kindLabel =
    playlist.kind === 'xtream'
      ? t('lists.kindXtream')
      : playlist.kind === 'file'
        ? t('lists.kindFile')
        : t('lists.kindUrl');
  const relative = (input: string): string => {
    const diff = Date.now() - new Date(input).getTime();
    if (Number.isNaN(diff)) return '';
    if (diff < 60_000) return t('lists.now');
    if (diff < 3_600_000) return t('lists.minutesAgo', { count: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return t('lists.hoursAgo', { count: Math.floor(diff / 3_600_000) });
    return formatDate(input, { day: 'numeric', month: 'short' });
  };
  const guideState = playlist.epgUrl
    ? playlist.epgStatus === 'ready'
      ? t('lists.guideUpdated', {
          when: relative(playlist.epgUpdatedAt ?? playlist.lastUpdatedAt ?? ''),
        })
      : playlist.epgStatus === 'error'
        ? t('lists.guideError')
        : t('lists.guidePending')
    : t('lists.noGuide');
  const stepLabel =
    playlist.refreshing === 'account'
      ? t('lists.stepAccount')
      : playlist.refreshing === 'live'
        ? t('lists.stepLive')
        : playlist.refreshing === 'vod'
          ? t('lists.stepVod')
          : playlist.refreshing === 'epg'
            ? t('lists.stepEpg')
            : null;
  return (
    <article className="playlist-card">
      <div className="playlist-icon">
        <Icon name="lists" />
      </div>
      <div className="playlist-copy">
        {editing ? (
          <input
            data-tv-focus
            autoFocus
            defaultValue={playlist.name}
            onBlur={(event) => onRename(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') onRename(playlist.name);
            }}
          />
        ) : (
          <h2>{playlist.name}</h2>
        )}
        <p>
          <span
            className={`status-dot ${playlist.status === 'error' ? 'error' : ''} ${stepLabel ? 'busy' : ''}`}
          />
          {stepLabel ??
            (playlist.status === 'pending'
              ? t('lists.pending')
              : playlist.status === 'error'
                ? t('lists.error')
                : t('lists.ready'))}
          <span className="kind-chip">{kindLabel}</span>
        </p>
        <strong>
          {t('common.channels', { count: playlist.channelCount })}
          {playlist.programCount
            ? ` · ${t('lists.programs', { count: playlist.programCount })}`
            : ''}
        </strong>
        {(playlist.movieCount || playlist.seriesCount) > 0 && (
          <small>
            {t('lists.vodCount', { movies: playlist.movieCount, series: playlist.seriesCount })}
          </small>
        )}
        <small>
          {playlist.lastUpdatedAt
            ? t('lists.updated', { when: relative(playlist.lastUpdatedAt) })
            : t('lists.notUpdated')}
          {` · ${guideState}`}
        </small>
        {playlist.account && (
          <small>
            {t('lists.account', { status: playlist.account.status.toLowerCase() })}
            {playlist.account.expiresAt
              ? ` · ${t('lists.expires', { date: formatDate(playlist.account.expiresAt, { dateStyle: 'medium' }) })}`
              : ''}
            {playlist.account.maxConnections
              ? ` · ${t('lists.connections', { active: playlist.account.activeConnections ?? 0, max: playlist.account.maxConnections })}`
              : ''}
          </small>
        )}
        {playlist.lastError && <em>{playlist.lastError}</em>}
        {playlist.epgError && !playlist.lastError && (
          <em>{t('lists.guidePrefix', { error: playlist.epgError })}</em>
        )}
        {playlist.lastWarnings.length > 0 && (
          <ul className="playlist-warnings">
            {playlist.lastWarnings.slice(0, 5).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
            {playlist.lastWarnings.length > 5 && (
              <li>{t('lists.moreWarnings', { count: playlist.lastWarnings.length - 5 })}</li>
            )}
          </ul>
        )}
        {playlist.kind !== 'file' && (
          <label className="refresh-select">
            {t('lists.autoRefresh')}
            <select
              data-tv-focus
              value={playlist.autoRefreshMinutes}
              onChange={(event) => onAutoRefresh(Number(event.target.value))}
            >
              <option value={0}>{t('lists.manual')}</option>
              <option value={60}>{t('lists.hourly')}</option>
              <option value={360}>{t('lists.every6h')}</option>
              <option value={720}>{t('lists.every12h')}</option>
              <option value={1440}>{t('lists.daily')}</option>
            </select>
          </label>
        )}
      </div>
      <div className="card-actions">
        <button
          data-tv-focus
          onClick={onRefresh}
          disabled={busy}
          aria-label={t('lists.refresh', { name: playlist.name })}
        >
          <Icon name="retry" />
        </button>
        {playlist.epgUrl && (
          <button
            data-tv-focus
            onClick={onRefreshEpg}
            disabled={busy}
            aria-label={t('lists.refreshGuide', { name: playlist.name })}
          >
            <Icon name="guide" />
          </button>
        )}
        <button
          data-tv-focus
          onClick={onEdit}
          aria-label={t('lists.editList', { name: playlist.name })}
        >
          {t('common.edit')}
        </button>
        <button
          data-tv-focus
          className="danger"
          onClick={onRemove}
          aria-label={t('lists.deleteList', { name: playlist.name })}
        >
          {t('common.delete')}
        </button>
      </div>
    </article>
  );
}
