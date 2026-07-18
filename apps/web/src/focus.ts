const SELECTOR = '[data-tv-focus]:not([disabled])';

export function moveSpatialFocus(
  direction: 'left' | 'right' | 'up' | 'down',
  root: ParentNode = document,
): boolean {
  const current = document.activeElement;
  if (!(current instanceof HTMLElement)) return false;
  const origin = current.getBoundingClientRect();
  const candidates = [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter(
    (item) => item !== current,
  );
  const centerX = origin.left + origin.width / 2;
  const centerY = origin.top + origin.height / 2;
  let best: { element: HTMLElement; score: number } | undefined;
  for (const element of candidates) {
    const box = element.getBoundingClientRect();
    const dx = box.left + box.width / 2 - centerX;
    const dy = box.top + box.height / 2 - centerY;
    if ((direction === 'left' && dx >= -1) || (direction === 'right' && dx <= 1)) continue;
    if ((direction === 'up' && dy >= -1) || (direction === 'down' && dy <= 1)) continue;
    const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.4;
    if (!best || score < best.score) best = { element, score };
  }
  best?.element.focus({ preventScroll: false });
  return Boolean(best);
}
