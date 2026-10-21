import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext.js';
import { companyLabel, useCompanyReadState } from '../CompanySwitcher.jsx';
import { AccountSheet, initialsOf } from './AccountSheet.jsx';
import { CompanySheet } from './CompanySheet.jsx';
import { usePhoneWidth } from './usePhoneWidth.js';
import { AXAL_MARK } from '../../components/AxalLogo.jsx';

// The same lazy module the desktop header loads, so the bell stays one chunk.
const NotificationBell = lazy(() => import('../../components/NotificationBell.jsx'));

/**
 * D699 decision 8: the band is the Lab band illustration under the canvas's
 * gradient (CO:23), on its darkest colour so the white type keeps its contrast
 * while the image loads. The canvas's `uploads/spin-out-lab-04622b47.png` is
 * the same illustration as `/site/lab-band.webp`, cropped; the file swap is a
 * recorded departure. The band is the same in light and dark mode.
 */
export const BAND_BACKGROUND = 'linear-gradient(180deg, rgba(20,12,38,.22) 0%, rgba(20,12,38,.55) 100%), '
  + 'url(/site/lab-band.webp) center 18% / cover no-repeat rgb(20,12,38)';

/** The band's darkest colour, as the status bar's tint while the band is drawn. */
export const BAND_TINT = '#140c26';

/**
 * Sets the page's theme colour to the band's and returns how to put the old one
 * back. Nothing to do on a page without the tag.
 */
export function tintStatusBar(doc) {
  const meta = doc?.querySelector?.('meta[name="theme-color"]');
  if (!meta) return () => {};
  const before = meta.getAttribute('content');
  meta.setAttribute('content', BAND_TINT);
  return () => { if (before == null) meta.removeAttribute('content'); else meta.setAttribute('content', before); };
}

// CO:227's Studio glyph: two four-pointed stars.
const STUDIO_PATHS = [
  'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z',
  'M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
];

// Each control is a 44px target around its glyph (M5's 44pt floor).
const TARGET = 'inline-flex h-11 min-w-11 items-center justify-center rounded-lg '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

/**
 * The founder's phone header (D699, CO:23): the logo, the company pill, the
 * Studio glyph, the bell and the initials, 52px tall, below 1024px only. The
 * pill opens Switch company and the initials open the account sheet. The pill
 * carries `data-company-switcher`, so `/company-settings`' "Switch company ↑"
 * finds it before the drawer's switcher and opens the sheet on a phone.
 *
 * UNDER THE CLOCK. As the shell's first element the band takes the top
 * safe-area inset (`data-phone-band`, index.css), so its illustration fills
 * the status bar's area; its 52px row sits below the inset. While it is drawn
 * the page's theme colour is the band's, for browsers that tint the status bar
 * from it, and the previous one comes back when it goes.
 */
export function PhoneHeader({ user, onLogout, branchFact }) {
  const { company } = useActiveCompany();
  const read = useCompanyReadState();
  const [sheet, setSheet] = useState(null);
  const pill = useRef(null);
  const avatar = useRef(null);
  const close = useCallback(() => setSheet(null), []);
  useEffect(() => tintStatusBar(typeof document === 'undefined' ? null : document), []);
  return (
    <>
      <header
        data-testid="phone-header"
        data-phone-band=""
        className="relative z-40 shrink-0 overflow-hidden text-white lg:hidden"
        style={{ background: BAND_BACKGROUND }}
      >
        <div className="relative h-[52px]">
        <div className="absolute inset-y-0 left-[22px] right-[22px] flex items-center justify-between gap-[10px]">
          <div className="flex items-center gap-1.5">
            {/* The mark the desktop header draws (AxalLogo), on a white chip: the
                old `/axal-logo.png` is an opaque 1320×2868 image, and inverting it
                drew a white block instead of a logo. */}
            <img src={AXAL_MARK} alt="" width="18" height="18" className="block h-[18px] w-[18px] rounded-[4px] bg-white object-contain p-px" />
            <span className="text-[12px] font-extrabold tracking-[-.012em] [text-shadow:0_1px_2px_rgba(0,0,0,.35)]">Axal VC</span>
          </div>
          <button
            ref={pill}
            type="button"
            onClick={() => setSheet('company')}
            aria-haspopup="dialog"
            aria-expanded={sheet === 'company'}
            data-company-switcher=""
            data-testid="phone-company-pill"
            className={`${TARGET} absolute left-1/2 top-1/2 max-w-[118px] -translate-x-1/2 -translate-y-1/2`}
          >
            <span className="inline-flex min-h-[28px] max-w-[118px] items-center rounded-full border border-white/35 bg-white/[.18] px-2.5 text-[11px] font-bold">
              <span className="truncate">{companyLabel(company, read)}</span>
            </span>
          </button>
          <div className="flex items-center gap-[9px]">
            <Link to="/studio" aria-label="Studio" className={TARGET} data-testid="phone-studio-link">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                {STUDIO_PATHS.map(d => <path key={d} d={d} />)}
              </svg>
            </Link>
            <Suspense fallback={<span className="inline-block h-11 w-11" />}>
              <NotificationBell userId={user?.id} tone="band" />
            </Suspense>
            <button
              ref={avatar}
              type="button"
              onClick={() => setSheet('account')}
              aria-label="Account"
              aria-haspopup="dialog"
              aria-expanded={sheet === 'account'}
              data-testid="phone-account-button"
              className={TARGET}
            >
              <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[rgba(255,255,255,.92)] text-[10px] font-extrabold text-[#6d28d9]">
                {initialsOf(user)}
              </span>
            </button>
          </div>
        </div>
        </div>
      </header>
      {sheet === 'company' && <CompanySheet onClose={close} opener={pill} />}
      {sheet === 'account' && <AccountSheet user={user} branchFact={branchFact} onLogout={onLogout} onClose={close} opener={avatar} />}
    </>
  );
}

/**
 * The band for a founder below 1024px, and the shell's own header (its
 * `children`) for everyone else. One header is mounted, never two, so a
 * founder's tab runs one notification poll and one WebSocket (decision 10).
 * `phone` is for tests; the shell leaves it to `usePhoneWidth()`.
 */
export function HeaderForWidth({ founder, phone, children, ...bandProps }) {
  const measured = usePhoneWidth();
  const isPhone = phone ?? measured;
  return founder && isPhone ? <PhoneHeader {...bandProps} /> : children;
}
