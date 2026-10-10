import { useEffect, useState } from 'react';
import { getDevice } from '../engine';
import { useAppStore } from '../store';

/** Applies the 10-foot (TV) layout flag to the document and reports it. */
export function useTvMode(): boolean {
  const preference = useAppStore((state) => state.tvMode);
  const detected = getDevice().tv;
  const active = preference === 'auto' ? detected : preference === 'on';
  useEffect(() => {
    document.documentElement.dataset.tv = active ? 'true' : 'false';
    document.documentElement.dataset.platform = getDevice().platform;
  }, [active]);
  return active;
}

export function useDeviceInfo() {
  const [device] = useState(() => getDevice());
  return device;
}
