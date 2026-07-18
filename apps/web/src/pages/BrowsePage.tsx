import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ChannelList } from '../components/ChannelList';
import { Icon } from '../components/Icon';
import { useAppStore } from '../store';
import type { Channel } from '../types';

export function BrowsePage() {
  const state = useAppStore();
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.groups });
  const channels = useQuery({
    queryKey: ['channels', state.selectedGroupId, state.filter, state.search],
    queryFn: () =>
      api.channels({
        groupId: state.selectedGroupId,
        search: state.search,
        favorite: state.filter === 'favorites' || undefined,
        recent: state.filter === 'recent' || undefined,
      }),
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
  const title =
    state.filter === 'favorites'
      ? 'Favoritos'
      : state.filter === 'recent'
        ? 'Vistos recientemente'
        : (groups.data?.find((group) => group.id === state.selectedGroupId)?.name ??
          'Todos los canales');
  return (
    <section className="page browse-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">ORIVUE · TELEVISIÓN LOCAL</span>
          <h1>En directo</h1>
        </div>
        <label className="search-box">
          <Icon name="search" />
          <span className="sr-only">Buscar canales</span>
          <input
            value={state.search}
            onChange={(event) => state.setSearch(event.target.value)}
            placeholder="Buscar un canal…"
          />
        </label>
        <time>
          {new Intl.DateTimeFormat('es', {
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date())}
        </time>
      </header>
      <div className="browser-grid">
        <aside className="category-panel" aria-label="Categorías">
          <p className="panel-label">BIBLIOTECA</p>
          <button
            data-tv-focus
            className={!state.selectedGroupId && state.filter === 'all' ? 'selected' : ''}
            onClick={() => state.setGroup()}
          >
            <Icon name="live" />
            <span>Todos</span>
          </button>
          <button
            data-tv-focus
            className={state.filter === 'favorites' ? 'selected' : ''}
            onClick={() => state.setFilter('favorites')}
          >
            <Icon name="heart" />
            <span>Favoritos</span>
          </button>
          <button
            data-tv-focus
            className={state.filter === 'recent' ? 'selected' : ''}
            onClick={() => state.setFilter('recent')}
          >
            <Icon name="clock" />
            <span>Recientes</span>
          </button>
          <p className="panel-label">CATEGORÍAS</p>
          <div className="category-list">
            {groups.data?.map((group) => (
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
        </aside>
        <main className="channels-panel">
          <div className="panel-heading">
            <div>
              <span className="accent-line" />
              <h2>{title}</h2>
            </div>
            <span>{channels.data?.length ?? 0} canales</span>
          </div>
          {channels.isLoading ? (
            <LoadingRows />
          ) : channels.isError ? (
            <ErrorState retry={() => void channels.refetch()} />
          ) : (
            <ChannelList
              channels={channels.data ?? []}
              onPlay={state.play}
              onFavorite={(channel) => favorite.mutate(channel)}
            />
          )}
        </main>
      </div>
    </section>
  );
}

function LoadingRows() {
  return (
    <div className="loading-rows" aria-label="Cargando canales">
      {Array.from({ length: 7 }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}
function ErrorState({ retry }: { retry: () => void }) {
  return (
    <div className="empty-state">
      <strong>No se pudieron cargar los canales</strong>
      <p>Comprueba que el servicio local esté iniciado.</p>
      <button data-tv-focus className="primary-button" onClick={retry}>
        Volver a intentar
      </button>
    </div>
  );
}
