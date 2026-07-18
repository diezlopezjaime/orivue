import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { useTvNavigation } from './hooks/useTvNavigation';
import { BrowsePage } from './pages/BrowsePage';
import { GuidePage } from './pages/GuidePage';
import { ListsPage } from './pages/ListsPage';
import { useAppStore } from './store';
import type { Channel } from './types';

const PlayerOverlay = lazy(() =>
  import('./components/PlayerOverlay').then((module) => ({ default: module.PlayerOverlay })),
);

export function App() {
  useTvNavigation();
  const current = useAppStore((state) => state.currentChannel);
  const play = useAppStore((state) => state.play);
  const queryClient = useQueryClient();
  const channels = queryClient
    .getQueriesData<Channel[]>({ queryKey: ['channels'] })
    .flatMap(([, data]) => data ?? []);
  const uniqueChannels = [...new Map(channels.map((channel) => [channel.id, channel])).values()];
  const onChange = useCallback((channel: Channel) => play(channel), [play]);
  useEffect(() => {
    const first = document.querySelector<HTMLElement>('[data-tv-focus]');
    if (!document.activeElement || document.activeElement === document.body) first?.focus();
  }, []);
  return (
    <div className="app-shell">
      <Sidebar />
      <Routes>
        <Route path="/" element={<BrowsePage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/lists" element={<ListsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {current && (
        <Suspense
          fallback={
            <div className="player-shell" role="status" aria-label="Preparando reproductor" />
          }
        >
          <PlayerOverlay
            channel={current}
            channels={uniqueChannels.length ? uniqueChannels : [current]}
            onClose={() => play()}
            onChange={onChange}
          />
        </Suspense>
      )}
    </div>
  );
}
