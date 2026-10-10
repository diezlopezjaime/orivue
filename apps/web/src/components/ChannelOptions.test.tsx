import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelOptions } from './ChannelOptions';
import { api } from '../api';
import { installTestEngine } from '../test/engine-fixture';
import type { Channel } from '../types';

describe('ChannelOptions', () => {
  let channel: Channel;
  let engine: Awaited<ReturnType<typeof installTestEngine>>['engine'];

  beforeEach(async () => {
    ({ engine } = await installTestEngine());
    const source = await engine.addSource({
      kind: 'm3u',
      name: 'Demo',
      url: 'https://lists.test/demo.m3u',
      epgUrl: 'https://guide.test/epg.xml',
    });
    await engine.refreshSource(source.id);
    channel = (await api.channels({}))[2]!; // Cine Nocturno, no EPG match
  });

  it('renames, hides and maps the guide of a channel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ChannelOptions channel={channel} onClose={onClose} />
      </QueryClientProvider>,
    );
    const name = screen.getByPlaceholderText('Deja vacío para usar el nombre original');
    await user.clear(name);
    await user.type(name, 'Cine de noche');
    await user.click(screen.getByLabelText('Ocultar este canal'));
    const select = await screen.findByRole('listbox');
    await user.selectOptions(select, 'aurora');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    const updated = engine.getChannel(channel.id)!;
    expect(updated.name).toBe('Cine de noche');
    expect(updated.hidden).toBe(true);
    expect(engine.epgKeyFor(channel.id)).toBe('aurora');
    expect(engine.listChannels({ hiddenOnly: true }).items.map((c) => c.id)).toEqual([channel.id]);
  });
});
