import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowsePage } from './BrowsePage';
import { useAppStore } from '../store';
import { installTestEngine } from '../test/engine-fixture';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BrowsePage />
    </QueryClientProvider>,
  );
}

describe('BrowsePage', () => {
  beforeEach(async () => {
    useAppStore.setState({
      selectedGroupId: undefined,
      filter: 'all',
      search: '',
      currentChannel: undefined,
    });
    const { engine } = await installTestEngine();
    const source = await engine.addSource({
      kind: 'm3u',
      name: 'Demo',
      url: 'https://lists.test/demo.m3u',
      epgUrl: 'https://guide.test/epg.xml',
    });
    await engine.refreshSource(source.id);
  });

  it('loads channels, groups and the current programme', async () => {
    renderPage();
    expect(await screen.findByText('Canal Aurora')).toBeTruthy();
    expect(screen.getByText('Boletín abierto')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Noticias/ })).toBeTruthy();
    expect(screen.getByText('3 canales')).toBeTruthy();
  });

  it('filters by search text', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Canal Aurora');
    await user.type(screen.getByPlaceholderText('Buscar un canal…'), 'horiz');
    await waitFor(() => expect(useAppStore.getState().search).toBe('horiz'));
    await waitFor(() => expect(screen.queryByText('Canal Aurora')).toBeNull());
    expect(screen.getByText('Canal Horizonte')).toBeTruthy();
  });

  it('selects a channel for playback and toggles favourites', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Reproducir Canal Aurora' }));
    expect(useAppStore.getState().currentChannel?.name).toBe('Canal Aurora');
    await user.click(screen.getByRole('button', { name: 'Añadir Canal Aurora a favoritos' }));
    await screen.findByRole('button', { name: 'Quitar Canal Aurora de favoritos' });
  });

  it('handles a missing logo without exposing an empty image', async () => {
    renderPage();
    expect(await screen.findAllByText('CA')).toHaveLength(2);
  });
});
