import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import type { Playlist } from '../types';

export function ListsPage() {
  const queryClient = useQueryClient();
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['playlists'] });
  const create = useMutation({
    mutationFn: api.createPlaylist,
    onSuccess: () => {
      void invalidate();
      setOpen(false);
    },
  });
  const refresh = useMutation({ mutationFn: api.refreshPlaylist, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: api.deletePlaylist, onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Playlist> }) =>
      api.updatePlaylist(id, input),
    onSuccess: invalidate,
  });
  const importFile = useMutation({
    mutationFn: ({ name, file }: { name: string; file: File }) => api.importPlaylist(name, file),
    onSuccess: invalidate,
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [fileName, setFileName] = useState('Mi lista local');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nameValue = data.get('name');
    const urlValue = data.get('url');
    const epgValue = data.get('epgUrl');
    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    const url = typeof urlValue === 'string' ? urlValue.trim() : '';
    const epgUrl = typeof epgValue === 'string' ? epgValue.trim() : '';
    if (name && url) create.mutate({ name, url, ...(epgUrl ? { epgUrl } : {}) });
  };
  return (
    <section className="page lists-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">FUENTES</span>
          <h1>Mis listas</h1>
        </div>
        <button data-tv-focus className="primary-button" onClick={() => setOpen((value) => !value)}>
          + Añadir lista
        </button>
      </header>
      {open && (
        <form className="playlist-form" onSubmit={submit}>
          <div>
            <label>
              Nombre
              <input data-tv-focus required name="name" placeholder="Televisión de casa" />
            </label>
            <label>
              URL M3U / M3U8
              <input
                data-tv-focus
                required
                name="url"
                type="url"
                placeholder="https://servidor.local/lista.m3u"
              />
            </label>
            <label>
              Guía XMLTV <small>opcional</small>
              <input
                data-tv-focus
                name="epgUrl"
                type="url"
                placeholder="https://servidor.local/guia.xml"
              />
            </label>
          </div>
          <p>Las URL solo se envían al servicio local y no aparecen en diagnósticos.</p>
          {create.error && <p className="form-error">{create.error.message}</p>}
          <button data-tv-focus disabled={create.isPending} className="primary-button">
            {create.isPending ? 'Importando…' : 'Importar URL'}
          </button>
        </form>
      )}
      <div className="playlist-grid">
        {playlists.data?.map((playlist) => (
          <article className="playlist-card" key={playlist.id}>
            <div className="playlist-icon">
              <Icon name="lists" />
            </div>
            <div className="playlist-copy">
              {editing === playlist.id ? (
                <input
                  data-tv-focus
                  autoFocus
                  defaultValue={playlist.name}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== playlist.name)
                      update.mutate({ id: playlist.id, input: { name } });
                    setEditing(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setEditing(undefined);
                  }}
                />
              ) : (
                <h2>{playlist.name}</h2>
              )}
              <p>
                <span className={`status-dot ${playlist.status === 'error' ? 'error' : ''}`} />
                {playlist.status === 'updating'
                  ? 'Actualizando'
                  : playlist.status === 'error'
                    ? 'Con errores'
                    : 'Lista disponible'}
              </p>
              <strong>{playlist.channelCount ?? 0} canales</strong>
              <small>
                {playlist.lastUpdatedAt
                  ? `Actualizada ${relativeDate(playlist.lastUpdatedAt)}`
                  : 'Aún no actualizada'}
              </small>
              {playlist.error && <em>{playlist.error}</em>}
            </div>
            <div className="card-actions">
              <button
                data-tv-focus
                onClick={() => refresh.mutate(playlist.id)}
                disabled={refresh.isPending}
                aria-label={`Actualizar ${playlist.name}`}
              >
                <Icon name="retry" />
              </button>
              <button
                data-tv-focus
                onClick={() => setEditing(playlist.id)}
                aria-label={`Editar ${playlist.name}`}
              >
                Editar
              </button>
              <button
                data-tv-focus
                className="danger"
                onClick={() => {
                  if (window.confirm(`¿Eliminar “${playlist.name}”?`)) remove.mutate(playlist.id);
                }}
                aria-label={`Eliminar ${playlist.name}`}
              >
                Eliminar
              </button>
            </div>
          </article>
        ))}
      </div>
      {!playlists.isLoading && !playlists.data?.length && (
        <div className="empty-state large">
          <Icon name="lists" />
          <strong>Tu biblioteca está vacía</strong>
          <p>Añade una URL M3U o importa un archivo local para empezar.</p>
        </div>
      )}
      <section className="file-import">
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
          Elegir archivo
          <input
            type="file"
            accept=".m3u,.m3u8,application/vnd.apple.mpegurl"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importFile.mutate({ name: fileName || file.name, file });
            }}
          />
        </label>
      </section>
    </section>
  );
}

function relativeDate(input: string): string {
  const diff = Date.now() - new Date(input).getTime();
  if (diff < 60_000) return 'ahora';
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(input));
}
