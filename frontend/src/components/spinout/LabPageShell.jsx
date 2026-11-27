import { labPageShellClass } from './labStyles';

/**
 * LabPageShell — canonical outer wrapper for Spin-Out Lab tool pages.
 *
 * Owns the left / top / right gutters (`LAB_PAGE_PAD`) and the per-tool
 * max-width (`LAB_PAGE_WIDTHS`). LabPageHeader stays inside this shell and
 * only owns header-internal spacing (back link, title row, pt-[19px]).
 *
 * The workspace overview uses the same pad tokens directly because it is
 * full-bleed within the gutters and has a sticky header that bleeds edge to
 * edge — see SpinoutLabWorkspace.jsx.
 *
 * @param {'workbench'|'reading'|'narrow'|'agreement'|'apply'|'brief'|'full'} width
 * @param {string} spaceY  Tailwind vertical stack between direct children. Pass '' to omit.
 * @param {string} className  Extra classes (e.g. `pb-24`, `py-16` for loading states).
 * @param {string} testId  data-testid for the shell.
 */
export default function LabPageShell({
  width = 'workbench',
  spaceY = 'space-y-5',
  className = '',
  testId,
  children,
  ...rest
}) {
  return (
    <div
      className={labPageShellClass(width, { spaceY, className })}
      data-testid={testId}
      {...rest}
    >
      {children}
    </div>
  );
}
