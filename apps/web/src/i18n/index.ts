import { useSyncExternalStore } from 'react';
import { en } from './en';
import { es } from './es';
import type { Language, MessageKey, Messages } from './types';

export type { Language, MessageKey } from './types';

const dictionaries: Record<Language, Messages> = { es, en };
export const LANGUAGES: Array<{ id: Language; label: string }> = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];

export type LanguagePreference = 'auto' | Language;

let preference: LanguagePreference = 'auto';
let current: Language = detect('auto');
const listeners = new Set<() => void>();

export function detect(pref: LanguagePreference): Language {
  if (pref !== 'auto') return pref;
  const tag = typeof navigator === 'undefined' ? 'es' : navigator.language || 'es';
  return tag.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function setLanguagePreference(pref: LanguagePreference): void {
  preference = pref;
  const next = detect(pref);
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function getLanguage(): Language {
  return current;
}

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

function lookup(language: Language, key: string): string | undefined {
  let node: unknown = dictionaries[language];
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export type Params = Record<string, string | number>;

/** Translates a key in the active language, falling back to Spanish. */
export function t(key: MessageKey, params?: Params): string {
  const template = lookup(current, key) ?? lookup('es', key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Re-renders the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
  return t;
}

export function formatTime(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat(current, { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDate(input: string | Date, options: Intl.DateTimeFormatOptions): string {
  const date = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat(current, options).format(date);
}
