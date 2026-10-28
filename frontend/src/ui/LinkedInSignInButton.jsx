import { LINKEDIN_SIGNIN } from './linkedinBrand';

/** D1355: LinkedIn's supplied button, unchanged; only actual OAuth entry points. */
export default function LinkedInSignInButton({ busy = false, disabled = false, className = '', ...props }) {
  return <button {...props} type="button" disabled={disabled || busy} aria-busy={busy || undefined}
    aria-label="Sign in with LinkedIn"
    className={`group inline-grid min-h-[44px] shrink-0 place-items-center rounded-[3px] border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0077B5] disabled:cursor-wait ${className}`}>
    <span className="relative block h-[40px] w-[215px]" aria-hidden="true">
      <img src={LINKEDIN_SIGNIN.default} width="215" height="40" alt="" className="block group-hover:hidden group-active:hidden group-disabled:block" />
      <img src={LINKEDIN_SIGNIN.hover} width="215" height="40" alt="" className="hidden group-hover:block group-active:hidden group-disabled:!hidden" />
      <img src={LINKEDIN_SIGNIN.active} width="215" height="40" alt="" className="hidden group-active:!block group-disabled:!hidden" />
    </span>
    {busy && <span className="sr-only" role="status">Opening LinkedIn…</span>}
  </button>;
}
