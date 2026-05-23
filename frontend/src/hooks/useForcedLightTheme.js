import { useLayoutEffect } from 'react';

/**
 * Force the document into the light theme while the calling component is
 * mounted, regardless of the user's saved Settings → Appearance choice.
 *
 * Used by public marketing surfaces (landing, login, register) whose
 * brand palettes are hand-crafted and should never be flipped by an
 * authenticated user's dark-mode preference.
 *
 * Snapshots and restores the `.dark` class + `data-theme` attribute on
 * `<html>` so navigating back into the app returns the user to their
 * chosen theme. Runs in `useLayoutEffect` so the override applies
 * before the first paint and avoids a dark flash.
 */
export default function useForcedLightTheme() {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains('dark');
    const prevTheme = html.dataset.theme;

    html.classList.remove('dark');
    html.dataset.theme = 'light';

    return () => {
      if (hadDark) html.classList.add('dark');
      if (prevTheme !== undefined) html.dataset.theme = prevTheme;
      else delete html.dataset.theme;
    };
  }, []);
}
