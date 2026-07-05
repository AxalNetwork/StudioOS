import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * ScrollToTop — restores window scroll position to the top on every
 * pathname change. Lives inside <BrowserRouter> so useLocation fires
 * for every client-side navigation (footer links, nav, back/forward).
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}
