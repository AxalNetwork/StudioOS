/**
 * The Workspaces launcher — S23 · H37 (D284).
 *
 * One top-bar button on the HQ and Admin shells opening the 29 working pages
 * in four groups. They are not admin consoles, and they no longer sit in the
 * sidebar: a workspace page lights no row. The list is `WORKSPACE_GROUPS`,
 * shared with the command palette; the count is computed from it.
 *
 * Three of the pages redirect a FOUNDER to a founder page (App.jsx: /my/jobs,
 * /services, /needs, each `user?.role === 'founder' ? <Navigate …>`). The
 * canvas notes "Opens a founder page" on them; an admin is not redirected, so
 * the note is not drawn here — it would be false for the only people who see
 * this launcher.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, ChevronDown } from 'lucide-react';
import { WORKSPACES, WORKSPACE_GROUPS } from '../lib/adminPlacement.js';

export default function WorkspacesLauncher() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" data-testid="workspaces-launcher">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
      >
        <LayoutGrid size={14} />
        Workspaces
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Workspaces"
          className="absolute right-0 top-full mt-1.5 z-50 w-[min(760px,calc(100vw-2rem))] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">Workspaces</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="workspaces-count">
              {WORKSPACES.length} pages · not admin consoles
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3 mt-3">
            {WORKSPACE_GROUPS.map((g) => (
              <div key={g.group}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {g.group} · {g.count}
                </div>
                <div className="flex flex-col gap-0.5 mt-1.5">
                  {g.items.map((w) => (
                    <Link
                      key={w.route}
                      to={w.route}
                      onClick={() => setOpen(false)}
                      className="block px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{w.label}</span>
                        <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{w.route}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">{w.description}</div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
