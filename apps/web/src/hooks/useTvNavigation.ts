import { useEffect } from 'react';
import { moveSpatialFocus } from '../focus';

export function useTvNavigation(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      const directions = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      } as const;
      const direction = directions[event.key as keyof typeof directions];
      if (!direction) return;
      const dialogs = document.querySelectorAll<HTMLElement>('[data-tv-root]');
      const root = dialogs.length ? dialogs[dialogs.length - 1] : document;
      if (moveSpatialFocus(direction, root)) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
