import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileText, Network, CalendarDays, Users, Briefcase } from 'lucide-react';
import { NETWORK_LINKS } from '../../lib/siteLinks';

/**
 * The Network section's own row of links, under the site nav (the canvas's
 * NETWORK SUB-NAV, D679). Every Network page renders it first. It reads the
 * same `NETWORK_LINKS` the nav and the footer read, so it can never offer a
 * page they do not.
 */
const ICONS = { overview: Network, articles: FileText, directory: Users, events: CalendarDays, circles: Users, jobs: Briefcase };

export default function NetworkSubNav() {
  const { pathname } = useLocation();
  const current = (to) => (pathname === to || pathname.startsWith(`${to}/`) ? 'page' : undefined);
  return (
    <nav className="ax-subnav" aria-label="Network">
      <div className="ax-wrap ax-subnav-row">
        <span className="ax-subnav-k">Network</span>
        {NETWORK_LINKS.map((l) => {
          const Icon = ICONS[l.icon] || Network;
          return (
            <Link key={l.to} to={l.to} className="ax-subnav-link" aria-current={current(l.to)}>
              <Icon size={15} aria-hidden="true" /> {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
