// theme.js — Bootstrap 5.3 data-bs-theme with a pure-black OLED override.
// The preference ('system' | 'light' | 'dark') lives in lib/settings.js
// (mt_theme, default 'system') so it survives reloads. 'system' follows
// prefers-color-scheme live; a manual override wins until set back to system
// (import-candidate-features.md §4.3 Phase 2, owner decision).
import { getSettings, saveSettings } from './settings.js';

export const THEME_CYCLE = ['system', 'dark', 'light'];

/** Apply the current preference to <html data-bs-theme> + <meta theme-color>. */
export function applyTheme() {
  const pref = getSettings().theme || 'system';
  const dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.dataset.bsTheme = dark ? 'dark' : 'light';

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? '#000000' : '#ffffff';

  return pref;
}

/** Step the preference through system -> dark -> light and re-apply. Returns the new setting. */
export function cycleTheme() {
  const current = getSettings().theme || 'system';
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length] ?? 'system';
  saveSettings({ theme: next });
  applyTheme();
  return next;
}