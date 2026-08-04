/**
 * The Lab tool-page icon tile.
 *
 * Design handoff draws every workspace tool header with its icon in a rounded
 * violet tile rather than as a bare glyph beside the title:
 *
 *   34px square · radius 9px · background #f4f0ff · icon #7c3aed
 *
 * Pages that render the raw lucide icon read as unfinished next to the ones
 * that don't, so this keeps the treatment in one place — same reasoning as
 * LabBackLink.
 *
 * Usage: <LabPageIcon icon={Compass} />
 */
export default function LabPageIcon({ icon: Icon, className = '' }) {
  if (!Icon) return null;
  return (
    <span
      aria-hidden="true"
      className={
        'w-[34px] h-[34px] flex-none rounded-[9px] flex items-center justify-center ' +
        'bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 ' + className
      }
    >
      <Icon size={18} />
    </span>
  );
}
