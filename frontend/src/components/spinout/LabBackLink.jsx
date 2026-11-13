import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * "← Back to Workspace" — the Lab's standard return control.
 *
 * This is a BUTTON, not bare text, and it sits inline with the page title
 * rather than stacked above it. Both come straight from the design handoff
 * (attached_assets/Customer_Discovery.dc.html):
 *
 *   height 34px · padding 0 12px 0 9px · radius 9px
 *   border 1px #e4e4e7 · background #fff · color #52525b · 13px/600
 *
 * Several Lab pages had drifted to an unstyled text link, which read as
 * body copy rather than a control. Centralising it here means the next page
 * that needs one cannot drift again.
 */
export default function LabBackLink({ to = '/spinout-lab', label = 'Back to Workspace', className = '' }) {
  return (
    <Link
      to={to}
      data-testid="link-back-to-workspace"
      className={
        'inline-flex flex-none items-center gap-1.5 h-[34px] pl-[9px] pr-3 rounded-[9px] ' +
        'border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
        'text-[13px] font-semibold text-gray-600 dark:text-gray-300 ' +
        'hover:text-violet-700 dark:hover:text-violet-300 hover:border-violet-200 dark:hover:border-violet-800 ' +
        'transition-colors ' + className
      }
    >
      <ArrowLeft size={15} aria-hidden="true" /> {label}
    </Link>
  );
}
