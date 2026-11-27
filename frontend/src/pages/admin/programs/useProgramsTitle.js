import { useEffect } from 'react';

/**
 * D4807: the browser tab says which Programs page and scope it is, not the public
 * site's default ("From idea to funded company"). Set directly rather than
 * through `usePageMeta`: an admin page needs no Open Graph tags and must not
 * fire the public pageview beacon. The previous title comes back on leaving.
 */
export const PROGRAMS_SITE = 'Axal VC StudioOS';

/** "Programs · HQ — Axal VC StudioOS", or "Perks · Programs — Axal VC StudioOS". */
export function programsTitle(page, scope = null) {
  return `${[page, scope].filter(Boolean).join(' · ')} — ${PROGRAMS_SITE}`;
}

export default function useProgramsTitle(page, scope = null) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.title;
    document.title = programsTitle(page, scope);
    return () => { document.title = prev; };
  }, [page, scope]);
}
