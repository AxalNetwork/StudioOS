import React from 'react';
import { Link } from 'react-router-dom';
import { alsoInFor } from '../lib/adminPlacement.js';

/**
 * "Also in <row>" — the working pages a profile row owns beyond its zones
 * (D563). The Workspaces launcher that listed them is retired; each now
 * lights the row in `PAGE_HOMES` and is linked here, on that row's overview,
 * so it is one click from the sidebar. The list is `alsoInFor(role, row)`,
 * read from the map, never typed on the page.
 *
 * Renders nothing when the row owns no such page.
 */
export default function AlsoIn({ role, row, className = '' }) {
  const pages = alsoInFor(role, row);
  if (!pages.length) return null;
  return (
    <nav
      aria-label={`Also in ${row}`}
      data-testid={`also-in-${row.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      className={`mt-4 rounded-xl border border-[#ececf1] bg-white p-4 dark:border-[#2c2b3c] dark:bg-[#171622] ${className}`.trim()}
    >
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Also in {row}</div>
      <ul className="mt-2 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {pages.map((p) => (
          <li key={p.route}>
            <Link to={p.route} data-testid={`link-also-in-${p.route.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`} className="text-[12.5px] font-semibold text-axal-violet hover:underline">
              {p.label}
            </Link>
            <span className="ml-1.5 text-[11.5px] text-axal-muted">{p.description}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
