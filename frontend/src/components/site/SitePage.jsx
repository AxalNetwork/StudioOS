import React from 'react';
import PublicNav from '../PublicNav';
import PublicFooter from '../PublicFooter';
import useForcedLightTheme from '../../hooks/useForcedLightTheme';
import { usePageMeta } from '../../lib/seo';
import './site.css';

/**
 * The frame every page of the public site renders in (D675–D680, #1546):
 * the nav, one `<main>`, the footer, the site's light palette, and the page's
 * title and description for the tab and for link previews.
 *
 * `title` is the page's own name, without the site suffix; `usePageMeta` adds
 * it. A page passes `description` only when it differs from the registry's
 * (`lib/ogRegistry.js`).
 */
export default function SitePage({ title, description, children, className = '' }) {
  useForcedLightTheme();
  usePageMeta({ title, description });
  return (
    <div className="ax-site">
      <PublicNav />
      <main className={`ax-page ax-in ${className}`.trim()}>{children}</main>
      <PublicFooter />
    </div>
  );
}
