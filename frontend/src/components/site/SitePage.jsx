import React from 'react';
import PublicNav from '../PublicNav';
import PublicFooter from '../PublicFooter';
import NewsletterSignup from './NewsletterSignup';
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
 *
 * D813 (#2259): the newsletter block (board W1) sits above the footer on every
 * page. The newsletter's own pages pass `signup={false}`, since each is that
 * form or follows from it.
 *
 * D6996 (#6996): `path` names the route the head describes. A page that serves
 * several routes from one mounted component (the trust center's tabs) passes it,
 * so moving between them rewrites the head; without it the hook reads the
 * address once, when the page mounts.
 */
export default function SitePage({ title, description, path, children, className = '', signup = true }) {
  useForcedLightTheme();
  usePageMeta({ title, description, path });
  return (
    <div className="ax-site">
      <PublicNav />
      <main className={`ax-page ax-in ${className}`.trim()}>{children}</main>
      {signup && <NewsletterSignup />}
      <PublicFooter />
    </div>
  );
}
