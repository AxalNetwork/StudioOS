import React from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { openCookiePreferences } from '../lib/cookieConsent';
import { OWNERSHIP_NOTICE } from '../lib/legalNotice';
import {
  DOOR_LINKS, NETWORK_LINKS, BUILD_LINKS, LEGAL_FOOTER_LINKS, SOCIAL_LINKS,
} from '../lib/siteLinks';
import AxalLogo from './AxalLogo';
import './site/site.css';

/**
 * The public footer, from the FOOTER of the owner's canvas (D674, #1548).
 *
 * Three columns (For, Network, Build With Us), the social row, the legal row
 * and the disclosure. Every list comes from `lib/siteLinks.js`, the same lists
 * the nav reads, so the two cannot disagree about which pages exist. The
 * ownership line is `OWNERSHIP_NOTICE`, shared with the onboarding footer.
 */

const SOCIAL_ICONS = {
  'Facebook': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.884v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
    </svg>
  ),
  'LinkedIn': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  ),
  'X': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  ),
  'Instagram': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
    </svg>
  ),
  'YouTube': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  ),
  'Telegram': (
    <Send size={18} />
  ),
  'TikTok': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.6 5.82c.9.66 1.94 1.04 3.04 1.1v3.08c-1.1-.03-2.18-.31-3.1-.82v5.24c0 4.2-3.56 7.58-7.82 7.58A7.74 7.74 0 0 1 1 14.24c0-4.22 3.44-7.64 7.68-7.64.25 0 .5.02.74.04v3.18a4.7 4.7 0 0 0-.74-.07c-2.48 0-4.48 1.98-4.48 4.46 0 2.47 2 4.45 4.48 4.45 2.58 0 4.62-2.06 4.62-4.64V1h3.3c.02 1.1.4 2.15 1.1 3.04Z"/>
    </svg>
  ),
};

export default function PublicFooter() {
  return (
    <footer className="ax-site-chrome ax-footer">
      <div className="ax-footer-glow" aria-hidden="true" />
      <div className="ax-footer-rule" aria-hidden="true" />
      <div className="ax-wrap ax-footer-body">
        <div className="ax-foot-grid">
          <div>
            <AxalLogo size="sm" onDark />
            <p className="ax-foot-tag">We work with partners globally to build the rails for the next generation of ventures.</p>
            <ul className="ax-socials" aria-label="Axal VC on social media">
              {SOCIAL_LINKS.map(({ label, href }) => (
                <li key={label}>
                  <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
                    {SOCIAL_ICONS[label]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="For">
            <h2>For</h2>
            <ul className="ax-foot-list">
              {DOOR_LINKS.map((l) => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}
            </ul>
          </nav>
          <nav aria-label="Network">
            <h2>Network</h2>
            <ul className="ax-foot-list">
              {NETWORK_LINKS.map((l) => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}
            </ul>
          </nav>
          <nav aria-label="Build with us">
            <h2>Build With Us</h2>
            <ul className="ax-foot-list">
              {BUILD_LINKS.map((l) => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}
            </ul>
          </nav>
        </div>

        <div className="ax-foot-divider" aria-hidden="true"><span /><i /><span /></div>

        <div className="ax-foot-legal-copy">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="ax-foot-legal">
              {LEGAL_FOOTER_LINKS.map((l) => (l.action === 'cookies'
                ? <button key={l.label} type="button" onClick={openCookiePreferences}>{l.label}</button>
                : <Link key={l.to} to={l.to}>{l.label}</Link>))}
            </div>
            <p className="ax-foot-small">{OWNERSHIP_NOTICE}</p>
          </div>
          <p className="ax-foot-small ax-foot-disclosure">
            <strong>Disclosure:</strong> Investment in startups involves a high degree of risk and may result in the loss of your entire investment. Nothing on this site is an offer to sell securities — see <Link to="/risk-disclosures">Risk Disclosures</Link>.
          </p>
        </div>
      </div>
    </footer>
  );
}
