import React from 'react';
import { Link } from 'react-router-dom';
import { openCookiePreferences } from '../lib/cookieConsent';
import { OWNERSHIP_NOTICE } from '../lib/legalNotice';
import {
  DOOR_LINKS, NETWORK_LINKS, BUILD_LINKS, LEGAL_FOOTER_LINKS, SOCIAL_LINKS,
} from '../lib/siteLinks';
import AxalLogo from './AxalLogo';
import BrandIcon from '../ui/BrandIcon.jsx';
import './site/site.css';

/**
 * The public footer, from the FOOTER of the owner's canvas (D674, #1548).
 *
 * Three columns (For, Network, Build With Us), the social row, the legal row
 * and the disclosure. Every list comes from `lib/siteLinks.js`, the same lists
 * the nav reads, so the two cannot disagree about which pages exist. The
 * ownership line is `OWNERSHIP_NOTICE`, shared with the onboarding footer.
 */


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
              {SOCIAL_LINKS.map(({ key, label, href }) => (
                <li key={key}>
                  <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
                    {/* D687: the one copy of each mark, monochrome as the canvas draws the footer. */}
                    <BrandIcon provider={key} size={18} variant="bare" tone="current" />
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
