import { useCallback, useEffect, useRef, useState } from 'react';

const DIGIT_DELAY = 1400;

/**
 * Remote-control style channel entry: digits accumulate for a moment and
 * then resolve to a channel number. Returns the pending digits for display.
 */
export function useNumericZap(onNumber: (number: number) => void, enabled = true): string {
  const [digits, setDigits] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const callback = useRef(onNumber);
  callback.current = onNumber;

  const commit = useCallback((value: string) => {
    window.clearTimeout(timer.current);
    setDigits('');
    const number = Number(value);
    if (number > 0) callback.current(number);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      if (!/^\d$/.test(event.key)) {
        if (event.key === 'Enter' && digits) {
          event.preventDefault();
          commit(digits);
        }
        return;
      }
      event.preventDefault();
      const next = (digits + event.key).slice(-4);
      setDigits(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => commit(next), DIGIT_DELAY);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [commit, digits, enabled]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return digits;
}
