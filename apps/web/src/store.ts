import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel } from './types';

type ChannelFilter = 'all' | 'favorites' | 'recent';
export type TvModePreference = 'auto' | 'on' | 'off';
export type PlayerPreference = 'auto' | 'native' | 'web';

interface AppState {
  selectedGroupId: string | undefined;
  filter: ChannelFilter;
  search: string;
  currentChannel: Channel | undefined;
  volume: number;
  muted: boolean;
  aspect: 'contain' | 'cover' | 'fill';
  tvMode: TvModePreference;
  playerPreference: PlayerPreference;
  setGroup: (id?: string) => void;
  setFilter: (filter: ChannelFilter) => void;
  setSearch: (search: string) => void;
  play: (channel?: Channel) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  cycleAspect: () => void;
  setTvMode: (mode: TvModePreference) => void;
  setPlayerPreference: (preference: PlayerPreference) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      filter: 'all',
      search: '',
      selectedGroupId: undefined,
      currentChannel: undefined,
      volume: 0.8,
      muted: false,
      aspect: 'contain',
      tvMode: 'auto',
      playerPreference: 'auto',
      setGroup: (selectedGroupId) => set({ selectedGroupId, filter: 'all' }),
      setFilter: (filter) => set({ filter, selectedGroupId: undefined }),
      setSearch: (search) => set({ search }),
      play: (currentChannel) => set({ currentChannel }),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),
      setMuted: (muted) => set({ muted }),
      cycleAspect: () =>
        set((state) => ({
          aspect:
            state.aspect === 'contain' ? 'cover' : state.aspect === 'cover' ? 'fill' : 'contain',
        })),
      setTvMode: (tvMode) => set({ tvMode }),
      setPlayerPreference: (playerPreference) => set({ playerPreference }),
    }),
    {
      name: 'orivue-preferences',
      partialize: ({ volume, muted, aspect, tvMode, playerPreference }) => ({
        volume,
        muted,
        aspect,
        tvMode,
        playerPreference,
      }),
    },
  ),
);
