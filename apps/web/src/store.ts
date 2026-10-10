import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LanguagePreference } from './i18n';
import type { Channel, VodTarget } from './types';

type ChannelFilter = 'all' | 'favorites' | 'recent' | 'hidden';
export type TvModePreference = 'auto' | 'on' | 'off';
export type PlayerPreference = 'auto' | 'native' | 'web';

interface AppState {
  selectedGroupId: string | undefined;
  filter: ChannelFilter;
  search: string;
  currentChannel: Channel | undefined;
  currentVod: VodTarget | undefined;
  volume: number;
  muted: boolean;
  aspect: 'contain' | 'cover' | 'fill';
  tvMode: TvModePreference;
  playerPreference: PlayerPreference;
  language: LanguagePreference;
  lastChannel: Channel | undefined;
  setGroup: (id?: string) => void;
  setFilter: (filter: ChannelFilter) => void;
  setSearch: (search: string) => void;
  play: (channel?: Channel) => void;
  playVod: (target?: VodTarget) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  cycleAspect: () => void;
  setTvMode: (mode: TvModePreference) => void;
  setPlayerPreference: (preference: PlayerPreference) => void;
  setLanguage: (language: LanguagePreference) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      filter: 'all',
      search: '',
      selectedGroupId: undefined,
      currentChannel: undefined,
      currentVod: undefined,
      volume: 0.8,
      muted: false,
      aspect: 'contain',
      tvMode: 'auto',
      playerPreference: 'auto',
      language: 'auto',
      lastChannel: undefined,
      setGroup: (selectedGroupId) => set({ selectedGroupId, filter: 'all' }),
      setFilter: (filter) => set({ filter, selectedGroupId: undefined }),
      setSearch: (search) => set({ search }),
      play: (currentChannel) =>
        set((state) => ({
          currentChannel,
          currentVod: currentChannel ? undefined : state.currentVod,
          lastChannel:
            currentChannel && state.currentChannel && state.currentChannel.id !== currentChannel.id
              ? state.currentChannel
              : state.lastChannel,
        })),
      playVod: (currentVod) =>
        set((state) => ({
          currentVod,
          currentChannel: currentVod ? undefined : state.currentChannel,
        })),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),
      setMuted: (muted) => set({ muted }),
      cycleAspect: () =>
        set((state) => ({
          aspect:
            state.aspect === 'contain' ? 'cover' : state.aspect === 'cover' ? 'fill' : 'contain',
        })),
      setTvMode: (tvMode) => set({ tvMode }),
      setPlayerPreference: (playerPreference) => set({ playerPreference }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'orivue-preferences',
      partialize: ({ volume, muted, aspect, tvMode, playerPreference, language, lastChannel }) => ({
        volume,
        muted,
        aspect,
        tvMode,
        playerPreference,
        language,
        lastChannel,
      }),
    },
  ),
);
