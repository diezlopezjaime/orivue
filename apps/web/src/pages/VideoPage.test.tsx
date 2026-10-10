import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { VideoPage } from './VideoPage';
import { useAppStore } from '../store';
import { installTestEngine } from '../test/engine-fixture';

const PANEL = 'http://panel.test:8080';
const API = `${PANEL}/player_api.php?username=u&password=p`;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VideoPage />
    </QueryClientProvider>,
  );
}

describe('VideoPage', () => {
  beforeEach(async () => {
    useAppStore.setState({ currentVod: undefined, currentChannel: undefined });
    const { engine } = await installTestEngine({
      [API]: JSON.stringify({ user_info: { status: 'Active', auth: 1 }, server_info: {} }),
      [`${API}&action=get_vod_categories`]: JSON.stringify([
        { category_id: '1', category_name: 'Acción' },
      ]),
      [`${API}&action=get_series_categories`]: JSON.stringify([
        { category_id: '2', category_name: 'Comedia' },
      ]),
      [`${API}&action=get_vod_streams`]: JSON.stringify([
        { stream_id: 1, name: 'Película Alfa', category_id: '1', container_extension: 'mp4' },
      ]),
      [`${API}&action=get_series`]: JSON.stringify([
        { series_id: 9, name: 'Serie Beta', category_id: '2' },
      ]),
      [`${API}&action=get_series_info&series_id=9`]: JSON.stringify({
        episodes: { '1': [{ id: '91', episode_num: 1, title: 'Piloto' }] },
      }),
      [`${PANEL}/get.php?username=u&password=p&type=m3u_plus&output=ts`]:
        '#EXTM3U\n#EXTINF:-1 group-title="TV",Canal Uno\nhttp://panel.test:8080/live/u/p/1.ts\n',
      [`${PANEL}/xmltv.php?username=u&password=p`]: '<tv></tv>',
    });
    const source = await engine.addSource({
      kind: 'xtream',
      name: 'Panel',
      host: PANEL,
      username: 'u',
      password: 'p',
    });
    await engine.refreshSource(source.id);
  });

  it('lists movies and starts playback', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Película Alfa')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Acción/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Película Alfa' }));
    expect(useAppStore.getState().currentVod?.item.name).toBe('Película Alfa');
  });

  it('opens a series, shows its episodes and plays one', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Series' }));
    await user.click(await screen.findByRole('button', { name: 'Serie Beta' }));
    await user.click(await screen.findByRole('button', { name: /Piloto/ }));
    expect(useAppStore.getState().currentVod?.episode?.id).toBe('91');
  });
});
