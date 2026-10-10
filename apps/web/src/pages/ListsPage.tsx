import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type CreatePlaylistInput, type CreateXtreamInput } from '../api';
import { Icon } from '../components/Icon';
import type { Playlist } from '../types';

type SourceTab = 'url' | 'xtream' | 'file';

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Error desconocido';
}

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

export function ListsPage() {
  const queryClient = useQueryClient();
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['playlists'] });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SourceTab>('url');
  const [editing, setEditing] = useState<string>();
  const [fileName, setFileName] = useState('Mi lista local');
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

  return (
    <section className="page lists-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">FUENTES</span>
          <h1>Mis listas</h1>
        </div>
        <button
          data-tv-focus
          className="primary-button"
          onClick={() => (open ? close() : setOpen(true))}
        >
          + Añadir lista
        </button>
      </header>
      {open && (
        <div className="playlist-form">
          <div className="source-tabs" role="tablist" aria-label="Tipo de fuente">
            {(
              [
                ['url', 'URL M3U / M3U8'],
                ['xtream', 'Cuenta Xtream Codes'],
                ['file', 'Archivo local'],
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
                  Nombre
                  <input data-tv-focus required name="name" placeholder="Televisión de casa" />
                </label>
                <label>
                  URL de la lista
                  <input
                    data-tv-focus
                    required
                    name="url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="off"
                    placeholder="https://servidor.ejemplo/lista.m3u"
                  />
                </label>
                <label>
                  Guía XMLTV <small>opcional</small>
                  <input
                    data-tv-focus
                    name="epgUrl"
                    type="url"
                    inputMode="url"
                    autoCapitalize="off"
                    placeholder="https://servidor.ejemplo/guia.xml"
                  />
                </label>
              </div>
              <p>
                Si pegas una URL <code>get.php</code> de un panel Xtream se detecta automáticamente
                y la guía se carga sola. Las credenciales solo se guardan en este dispositivo.
              </p>
              {formError && <p className="form-error">{formError}</p>}
              <button data-tv-focus disabled={pending} className="primary-button">
                {pending ? 'Importando…' : 'Importar URL'}
              </button>
            </form>
          )}
          {tab === 'xtream' && (
            <form onSubmit={submitXtream}>
              <div className="xtream-grid">
                <label>
                  Nombre
                  <input data-tv-focus required name="name" placeholder="Mi proveedor" />
                </label>
                <label>
                  Servidor <small>host:puerto</small>
                  <input
                    data-tv-focus
                    required
                    name="host"
                    inputMode="url"
                    autoCapitalize="off"
                    placeholder="http://panel.ejemplo:8080"
                  />
                </label>
                <label>
                  Usuario
                  <input data-tv-focus required name="username" autoCapitalize="off" />
                </label>
                <label>
                  Contraseña
                  <input data-tv-focus required name="password" type="password" />
                </label>
                <label>
                  Formato de stream
                  <select data-tv-focus name="output" defaultValue="ts">
                    <option value="ts">MPEG-TS (recomendado)</option>
                    <option value="m3u8">HLS (m3u8)</option>
                  </select>
                </label>
              </div>
              <p>Se descargan canales, categorías y guía del panel. Nada sale de tu dispositivo.</p>
              {formError && <p className="form-error">{formError}</p>}
              <button data-tv-focus disabled={pending} className="primary-button">
                {pending ? 'Conectando…' : 'Conectar cuenta'}
              </button>
            </form>
          )}
          {tab === 'file' && (
            <div className="file-import inline">
              <div>
                <h2>Importar archivo local</h2>
                <p>Compatible con archivos .m3u y .m3u8.</p>
              </div>
              <input
                data-tv-focus
                aria-label="Nombre de la lista local"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
              />
              <label data-tv-focus className="secondary-button">
                {importFile.isPending ? 'Importando…' : 'Elegir archivo'}
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
      <div className="playlist-grid">
        {playlists.data?.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            playlist={playlist}
            editing={editing === playlist.id}
            busy={refresh.isPending || refreshEpg.isPending}
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
                    `${playlist.name}: ${result.channelCount} canales y ${result.programCount} programas.`,
                  ),
              })
            }
            onRefreshEpg={() => refreshEpg.mutate(playlist.id)}
            onAutoRefresh={(minutes) =>
              update.mutate({ id: playlist.id, input: { autoRefreshMinutes: minutes } })
            }
            onRemove={() => {
              if (window.confirm(`¿Eliminar “${playlist.name}”?`)) remove.mutate(playlist.id);
            }}
          />
        ))}
      </div>
      {!playlists.isLoading && !playlists.data?.length && (
        <div className="empty-state large">
          <Icon name="lists" />
          <strong>Tu biblioteca está vacía</strong>
          <p>Añade una URL M3U, una cuenta Xtream o importa un archivo local para empezar.</p>
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
  const kindLabel =
    playlist.kind === 'xtream' ? 'Xtream Codes' : playlist.kind === 'file' ? 'Archivo' : 'URL M3U';
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
          <span className={`status-dot ${playlist.status === 'error' ? 'error' : ''}`} />
          {playlist.status === 'pending'
            ? 'Pendiente'
            : playlist.status === 'error'
              ? 'Con errores'
              : 'Lista disponible'}
          <span className="kind-chip">{kindLabel}</span>
        </p>
        <strong>
          {playlist.channelCount} canales
          {playlist.programCount ? ` · ${playlist.programCount} programas` : ''}
        </strong>
        <small>
          {playlist.lastUpdatedAt
            ? `Actualizada ${relativeDate(playlist.lastUpdatedAt)}`
            : 'Aún no actualizada'}
          {playlist.epgUrl
            ? playlist.epgStatus === 'ready'
              ? ` · guía ${relativeDate(playlist.epgUpdatedAt ?? playlist.lastUpdatedAt ?? '')}`
              : playlist.epgStatus === 'error'
                ? ' · guía con errores'
                : ' · guía pendiente'
            : ' · sin guía'}
        </small>
        {playlist.account && (
          <small>
            Cuenta {playlist.account.status.toLowerCase()}
            {playlist.account.expiresAt
              ? ` · caduca ${new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(playlist.account.expiresAt))}`
              : ''}
            {playlist.account.maxConnections
              ? ` · ${playlist.account.activeConnections ?? 0}/${playlist.account.maxConnections} conexiones`
              : ''}
          </small>
        )}
        {playlist.lastError && <em>{playlist.lastError}</em>}
        {playlist.epgError && !playlist.lastError && <em>Guía: {playlist.epgError}</em>}
        {playlist.kind !== 'file' && (
          <label className="refresh-select">
            Actualización automática
            <select
              data-tv-focus
              value={playlist.autoRefreshMinutes}
              onChange={(event) => onAutoRefresh(Number(event.target.value))}
            >
              <option value={0}>Manual</option>
              <option value={60}>Cada hora</option>
              <option value={360}>Cada 6 horas</option>
              <option value={720}>Cada 12 horas</option>
              <option value={1440}>Cada día</option>
            </select>
          </label>
        )}
      </div>
      <div className="card-actions">
        <button
          data-tv-focus
          onClick={onRefresh}
          disabled={busy}
          aria-label={`Actualizar ${playlist.name}`}
        >
          <Icon name="retry" />
        </button>
        {playlist.epgUrl && (
          <button
            data-tv-focus
            onClick={onRefreshEpg}
            disabled={busy}
            aria-label={`Actualizar guía de ${playlist.name}`}
          >
            <Icon name="guide" />
          </button>
        )}
        <button data-tv-focus onClick={onEdit} aria-label={`Editar ${playlist.name}`}>
          Editar
        </button>
        <button
          data-tv-focus
          className="danger"
          onClick={onRemove}
          aria-label={`Eliminar ${playlist.name}`}
        >
          Eliminar
        </button>
      </div>
    </article>
  );
}

function relativeDate(input: string): string {
  const diff = Date.now() - new Date(input).getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 60_000) return 'ahora';
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(input));
}
