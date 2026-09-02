import React from 'react';
import { Link } from 'react-router-dom';
import AxalLogo from '../AxalLogo';

/**
 * Auth & Onboarding v2 — shared chrome for sign-in, register, and onboarding
 * steps that sit outside the main app shell (A1, A2, wizards).
 */
export default function AuthShell({
  children,
  email,
  platformNote = 'Platform sign-in',
  showApplyCard = false,
  applyHref = '/register',
  applyLabel = 'Apply to Axal VC →',
  compact = false,
  /** Full-page background image (e.g. /auth/login-background.webp on /login). */
  backgroundSrc = null,
}) {
  const shellStyle = backgroundSrc
    ? {
        backgroundImage:
          'linear-gradient(104deg, rgba(36,31,56,.52) 0%, rgba(36,31,56,.28) 42%, rgba(36,31,56,.62) 100%), '
          + `url(${backgroundSrc})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {
        background:
          'linear-gradient(104deg, rgba(244,240,254,.97) 0%, rgba(244,240,254,.9) 34%, rgba(36,31,56,.32) 68%, rgba(36,31,56,.5) 100%), '
          + 'linear-gradient(135deg, #241f38 0%, #4c1d95 100%)',
      };

  return (
    <div className="min-h-screen flex flex-col" style={shellStyle}>
      <header className="flex items-center justify-between gap-3 px-6 py-5 sm:px-8">
        {/* Clickable: this is a signed-out page, and `/` is where PublicNav's
            logo goes, so the destination is the same wherever you meet it.
            The link lives here rather than inside AxalLogo because PublicNav
            already wraps it — a link inside a link is invalid HTML. */}
        <Link to="/" aria-label="Axal VC home" className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <AxalLogo size="sm" onDark={!!backgroundSrc} />
        </Link>
        {email ? (
          <span className="font-mono text-[11px] text-white/80 truncate max-w-[220px]">{email}</span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-widest text-white/80">{platformNote}</span>
        )}
      </header>

      <div className={`flex flex-1 justify-center px-4 pb-12 ${compact ? 'pt-4' : 'pt-6 sm:pt-10'}`}>
        <div className="w-full max-w-[404px]">
          {children}
          {showApplyCard && (
            <div
              className="mt-3 rounded-[14px] border px-5 py-4"
              style={{ background: '#fff', borderColor: '#e8e6ee' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] font-bold text-[#241f38]">Not a member yet?</div>
                <Link
                  to={applyHref}
                  className="text-[13px] font-bold whitespace-nowrap flex-none no-underline hover:underline"
                  style={{ color: '#6d28d9' }}
                >
                  {applyLabel}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuthCard({ children, className = '' }) {
  return (
    <div
      className={`rounded-[14px] border px-7 py-7 sm:px-8 ${className}`}
      style={{ background: '#fff', borderColor: '#e8e6ee', boxShadow: '0 2px 14px rgba(36,31,56,.07)' }}
    >
      {children}
    </div>
  );
}

export const authV2 = {
  purple: '#7c3aed',
  purpleDark: '#6d28d9',
  purpleTint: '#f4f0fe',
  ink: '#241f38',
  muted: '#6b6577',
  hair: '#e8e6ee',
  label: 'font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#6b6577]',
  input: 'w-full box-border rounded-[10px] border px-3.5 py-3 text-sm text-[#241f38] bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30',
  btnPrimary: 'block w-full rounded-[10px] border px-4 py-3 text-sm font-bold text-white cursor-pointer disabled:opacity-60',
  btnSecondary: 'flex w-full items-center justify-center gap-2 rounded-[10px] border px-4 py-2.5 text-[13.5px] font-semibold cursor-pointer disabled:opacity-60',
};
