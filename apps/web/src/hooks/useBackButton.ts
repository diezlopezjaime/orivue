import { useEffect } from 'react';
import { getAppPlatform } from '../engine';

/**
 * Hardware back button (Android, Fire TV remote). While a handler is
 * registered the system default (leaving the app) is suppressed.
 */
export function useBackButton(handler: (() => void) | undefined): void {
  useEffect(() => {
    if (!handler) return;
    let platform;
    try {
      platform = getAppPlatform();
    } catch {
      return;
    }
    return platform.onBack(handler);
  }, [handler]);
}
