import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel } from './types';

type ChannelFilter = 'all' | 'favorites' | 'recent';

interface AppState {
  selectedGroupId: string | undefined;
  filter: ChannelFilter;
  search: string;
  currentChannel: Channel | undefined;
  recentIds: string[];
  volume: number;
  muted: boolean;
  aspect: 'contain' | 'cover' | 'fill';
  setGroup: (id?: string) => void;
  setFilter: (filter: ChannelFilter) => void;
  setSearch: (search: string) => void;
  play: (channel?: Channel) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  cycleAspect: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      filter: 'all',
      search: '',
      selectedGroupId: undefined,
      currentChannel: undefined,
      recentIds: [],
      volume: 0.8,
      muted: false,
      aspect: 'contain',
      setGroup: (selectedGroupId) => set({ selectedGroupId, filter: 'all' }),
      setFilter: (filter) => set({ filter, selectedGroupId: undefined }),
      setSearch: (search) => set({ search }),
      play: (currentChannel) =>
        set((state) => ({
          currentChannel,
          recentIds: currentChannel
            ? [
                currentChannel.id,
                ...state.recentIds.filter((id) => id !== currentChannel.id),
              ].slice(0, 30)
            : state.recentIds,
        })),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),
      setMuted: (muted) => set({ muted }),
      cycleAspect: () =>
        set((state) => ({
          aspect:
            state.aspect === 'contain' ? 'cover' : state.aspect === 'cover' ? 'fill' : 'contain',
        })),
    }),
    {
      name: 'orivue-preferences',
      partialize: ({ recentIds, volume, muted, aspect }) => ({ recentIds, volume, muted, aspect }),
    },
  ),
);
