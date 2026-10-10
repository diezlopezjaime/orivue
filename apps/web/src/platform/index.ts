import type { AppPlatform } from './types';

export type * from './types';

let instance: Promise<AppPlatform> | undefined;

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getPlatform(): Promise<AppPlatform> {
  instance ??= isTauri()
    ? import('./tauri').then((module) => module.createTauriPlatform())
    : import('./browser').then((module) => module.createBrowserPlatform());
  return instance;
}

/** Test seam. */
export function setPlatform(platform: AppPlatform | undefined): void {
  instance = platform ? Promise.resolve(platform) : undefined;
}
