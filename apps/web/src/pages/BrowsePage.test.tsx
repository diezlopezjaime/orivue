import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowsePage } from './BrowsePage';
import { useAppStore } from '../store';

const channels = [
  {
    id: 'one',
    name: 'Canal Aurora',
    number: 1,
    groupId: 'news',
    groupName: 'Noticias',
    favorite: false,
  },
];
function json(value: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BrowsePage />
    </QueryClientProvider>,
  );
}

describe('BrowsePage', () => {
  beforeEach(() => {
    useAppStore.setState({
      selectedGroupId: undefined,
      filter: 'all',
      search: '',
      currentChannel: undefined,
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      return url.includes('/groups')
        ? json([{ id: 'news', name: 'Noticias', channelCount: 1 }])
        : json(channels);
    });
  });
  it('loads channels and supports search', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Canal Aurora')).toBeTruthy();
    await user.type(screen.getByPlaceholderText('Buscar un canal…'), 'aurora');
    await waitFor(() => expect(useAppStore.getState().search).toBe('aurora'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('search=aurora'), expect.anything());
  });
  it('selects a channel for playback', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Reproducir Canal Aurora' }));
    expect(useAppStore.getState().currentChannel?.id).toBe('one');
  });
  it('handles a broken logo without exposing an empty image', async () => {
    renderPage();
    expect(await screen.findByText('CA')).toBeTruthy();
  });
});
