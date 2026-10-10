import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerOverlay } from './PlayerOverlay';
import { installTestEngine } from '../test/engine-fixture';
import type { Channel } from '../types';

vi.mock('mpegts.js', () => {
  const player = {
    attachMediaElement: vi.fn(),
    detachMediaElement: vi.fn(),
    load: vi.fn(),
    unload: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
  };
  return {
    default: {
      getFeatureList: () => ({ mseLivePlayback: true }),
      createPlayer: vi.fn(() => player),
      Events: { ERROR: 'error', MEDIA_INFO: 'media_info' },
      ErrorTypes: { MEDIA_ERROR: 'MediaError', NETWORK_ERROR: 'NetworkError' },
      ErrorDetails: { NETWORK_STATUS_CODE_INVALID: 'NetworkStatusCodeInvalid' },
    },
  };
});

describe('PlayerOverlay', () => {
  let channels: Channel[];
  let opened: Awaited<ReturnType<typeof installTestEngine>>['opened'];

  beforeEach(async () => {
    const fixture = await installTestEngine();
    opened = fixture.opened;
    const source = await fixture.engine.addSource({
      kind: 'm3u',
      name: 'Demo',
      url: 'https://lists.test/demo.m3u',
    });
    await fixture.engine.refreshSource(source.id);
    channels = fixture.engine.listChannels().items.map((channel) => ({
      id: channel.id,
      name: channel.name,
      groupName: channel.groupName,
      streamKind: channel.streamKind,
    }));
  });

  it('opens a playback session for the channel and closes with Escape', async () => {
    const onClose = vi.fn();
    const onChange = vi.fn();
    render(
      <PlayerOverlay
        channel={channels[1]!}
        channels={channels}
        onClose={onClose}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Reproduciendo Canal Horizonte' })).toBeTruthy();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]?.kind).toBe('mpegts');
    expect(opened[0]?.upstreamUrl).toBe('https://streams.test/horizonte.ts');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    await userEvent.keyboard('{PageDown}');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cine Nocturno' }));
  });

  it('uses the native video element for progressive streams', async () => {
    render(
      <PlayerOverlay
        channel={channels[2]!}
        channels={channels}
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const video = document.querySelector('video');
    await vi.waitFor(() =>
      expect(video?.getAttribute('src')).toBe('https://streams.test/cine.mp4'),
    );
  });
});
