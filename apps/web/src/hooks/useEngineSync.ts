import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getEngine } from '../engine';

/** Invalidates React Query caches when the engine reports changes. */
export function useEngineSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    return getEngine().subscribe((event) => {
      switch (event.type) {
        case 'sources':
        case 'refresh':
          void queryClient.invalidateQueries({ queryKey: ['playlists'] });
          break;
        case 'channels':
          void queryClient.invalidateQueries({ queryKey: ['groups'] });
          void queryClient.invalidateQueries({ queryKey: ['channels'] });
          void queryClient.invalidateQueries({ queryKey: ['timeline'] });
          break;
        case 'epg':
          void queryClient.invalidateQueries({ queryKey: ['channels'] });
          void queryClient.invalidateQueries({ queryKey: ['timeline'] });
          break;
        case 'library':
          void queryClient.invalidateQueries({ queryKey: ['channels'] });
          void queryClient.invalidateQueries({ queryKey: ['groups'] });
          break;
      }
    });
  }, [queryClient]);
}
