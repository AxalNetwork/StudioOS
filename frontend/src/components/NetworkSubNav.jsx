import React from 'react';
import { NavLink } from 'react-router-dom';
import { FileText, Users, CalendarDays, Network } from 'lucide-react';

// Shared secondary navigation for the public Network surface. Rendered directly
// under <PublicNav /> on each of the four Network pages so the section reads as
// one cohesive experience (discover a circle → a directory profile → an
// event/program → join the network) rather than four disconnected pages.
const NETWORK_LINKS = [
  { to: '/articles', label: 'Articles', icon: FileText },
  { to: '/directory', label: 'Directory', icon: Network },
  { to: '/events', label: 'Programs & Events', icon: CalendarDays },
  { to: '/circles', label: 'Communities & Circles', icon: Users },
];

export default function NetworkSubNav({ className = '' }) {
  return (
    <div className={`border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur ${className}`}>
      <nav
        aria-label="Network sections"
        className="max-w-6xl mx-auto px-6 flex items-center gap-1 overflow-x-auto"
      >
        <span className="mr-3 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Network
        </span>
        {NETWORK_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
