import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Menu, X, ChevronDown, FileText, Network, CalendarDays, Users, Briefcase,
} from 'lucide-react';
import AxalLogo from './AxalLogo';
import { DOOR_LINKS, NETWORK_LINKS, SITE_ACTIONS } from '../lib/siteLinks';
import './site/site.css';

/**
 * The public nav, from the NAV of the owner's canvas (D674, #1548).
 *
 * Fixed rather than sticky, and 64px tall: the twenty-odd public pages that
 * render it pad their tops by `pt-16` to clear it, so it must not grow.
 * At 1060px and below the links fold into the burger menu, as in the canvas.
 */
const NET_ICONS = {
  overview: Network,
  articles: FileText,
  directory: Users,
  events: CalendarDays,
  circles: Users,
  jobs: Briefcase,
};

export default function PublicNav() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const netRef = useRef(null);

  // A route change closes both menus.
  useEffect(() => { setMenuOpen(false); setNetOpen(false); }, [pathname]);

  // The Network menu closes on Escape or a click outside it.
  useEffect(() => {
    if (!netOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNetOpen(false); };
    const onDown = (e) => { if (netRef.current && !netRef.current.contains(e.target)) setNetOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [netOpen]);

  const current = (to) => (pathname === to || pathname.startsWith(`${to}/`) ? 'page' : undefined);
  const inNetwork = NETWORK_LINKS.some((l) => current(l.to));

  return (
    <nav className="ax-site-chrome ax-navbar" aria-label="Main">
      <div className="ax-wrap ax-navbar-row">
        <Link to="/" aria-label="Axal VC home" className="flex items-center flex-none">
          <AxalLogo size="sm" onLight />
        </Link>

        <div className="ax-navlinks">
          {DOOR_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="ax-navlink" aria-current={current(l.to)}>{l.label}</Link>
          ))}
          <div className="ax-netmenu-wrap" ref={netRef}>
            <button
              type="button"
              className="ax-navlink"
              aria-expanded={netOpen}
              aria-haspopup="true"
              aria-current={inNetwork ? 'page' : undefined}
              onClick={() => setNetOpen((v) => !v)}
            >
              Network <ChevronDown size={14} aria-hidden="true" />
            </button>
            {netOpen && (
              <div className="ax-netmenu">
                {NETWORK_LINKS.map((l) => {
                  const Icon = NET_ICONS[l.icon] || Network;
                  return (
                    <Link key={l.to} to={l.to} onClick={() => setNetOpen(false)}>
                      <span className="ax-netmenu-icon"><Icon size={17} aria-hidden="true" /></span>
                      <span>
                        <span className="ax-netmenu-t">{l.label}</span>
                        <span className="ax-netmenu-b" style={{ display: 'block' }}>{l.blurb}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="ax-nav-actions">
          <Link to={SITE_ACTIONS.lpLogin} className="ax-lp">LP login</Link>
          <Link to={SITE_ACTIONS.apply} className="ax-btn ax-btn-sm ax-btn-primary">Apply →</Link>
          <button
            type="button"
            className="ax-burger"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="ax-mobilemenu">
          <div className="ax-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {DOOR_LINKS.map((l) => (
              <Link key={l.to} to={l.to} aria-current={current(l.to)}>{l.label}</Link>
            ))}
            <div className="ax-mobilemenu-h">Network</div>
            {NETWORK_LINKS.map((l) => (
              <Link key={l.to} to={l.to} aria-current={current(l.to)}>{l.label}</Link>
            ))}
            <Link to={SITE_ACTIONS.lpLogin} className="ax-mobilemenu-sep">{SITE_ACTIONS.lpLabel}</Link>
          </div>
        </div>
      )}
    </nav>
  );
}
