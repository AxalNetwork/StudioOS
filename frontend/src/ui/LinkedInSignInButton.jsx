import { LINKEDIN_SIGNIN } from './linkedinBrand';

const STATUS = 'text-center text-[12px] leading-snug text-gray-600 dark:text-gray-300';

/** D1355: unchanged official artwork; flow context stays outside the image. */
export default function LinkedInSignInButton({ busy = false, disabled = false, context, disabledReason, className = '', ...props }) {
  const label = context ? `Sign in with LinkedIn — ${context}` : 'Sign in with LinkedIn';
  const cursor = busy ? 'cursor-wait' : disabled ? 'cursor-not-allowed' : 'cursor-pointer';
  return <span className={`inline-flex min-w-0 flex-col items-stretch gap-1 ${className}`}>
    {context && <span className={STATUS}>{context}</span>}
    <button {...props} type="button" disabled={disabled || busy} aria-busy={busy || undefined}
      aria-label={label}
      className={`group inline-grid min-h-[44px] shrink-0 place-items-center rounded-[3px] border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0077B5] ${cursor}`}>
      <span className="relative block h-[40px] w-[215px]" aria-hidden="true">
        <img src={LINKEDIN_SIGNIN.default} width="215" height="40" alt="" className="block group-hover:hidden group-active:hidden group-disabled:block" />
        <img src={LINKEDIN_SIGNIN.hover} width="215" height="40" alt="" className="hidden group-hover:block group-active:hidden group-disabled:!hidden" />
        <img src={LINKEDIN_SIGNIN.active} width="215" height="40" alt="" className="hidden group-active:!block group-disabled:!hidden" />
      </span>
    </button>
    {busy && <span role="status" className={STATUS}>Opening LinkedIn…</span>}
    {!busy && disabled && disabledReason && <span className={STATUS}>{disabledReason}</span>}
  </span>;
}
