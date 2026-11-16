// D4618 part 2 (#4618): the labelled field and the input class the Account
// sections share. Moved unchanged out of `../SettingsPage.jsx`, which still
// uses them for Sign-in and security, so every extracted section and the
// page draw one field the same way.

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-1">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500';
