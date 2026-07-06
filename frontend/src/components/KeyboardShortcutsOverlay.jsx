import React, { useEffect, useState, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useEscapeClose } from './useEscapeClose';

/**
 * Task #3 (IC) — Cmd/Ctrl + / opens this overlay listing every global
 * keyboard shortcut the app honors. Traps focus while open and returns
 * focus to the previously-focused element on close (WCAG 2.1.2).
 *
 * Mounted once at the App root; listens for the trigger globally.
 */
const SHORTCUTS = [
  { keys: ['⌘', 'K'], altKeys: ['Ctrl', 'K'], label: 'Open command palette' },
  { keys: ['⌘', '/'], altKeys: ['Ctrl', '/'], label: 'Show keyboard shortcuts' },
  { keys: ['?'], label: 'Show keyboard shortcuts (alternate)' },
  { keys: ['G', 'H'], label: 'Go to Home' },
  { keys: ['G', 'P'], label: 'Go to Startups' },
  { keys: ['G', 'S'], label: 'Go to Settings' },
  { keys: ['G', 'D'], label: 'Go to Docs' },
  { keys: ['Esc'], label: 'Close modal / dialog' },
  { keys: ['Tab'], label: 'Move focus forward' },
  { keys: ['Shift', 'Tab'], label: 'Move focus backward' },
];

export default function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const previousFocus = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      // Ignore when typing in inputs/textareas/contenteditable.
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable;
      // Cmd/Ctrl + / or plain ? (shift+/).
      if ((e.key === '/' && (e.metaKey || e.ctrlKey)) || (e.key === '?' && !typing)) {
        e.preventDefault();
        previousFocus.current = document.activeElement;
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEscapeClose(() => setOpen(false));

  // Focus trap — move focus into the dialog on open, cycle Tab/Shift+Tab
  // among focusables inside the dialog, restore focus on close. WCAG 2.1.2.
  useEffect(() => {
    if (!open) {
      if (previousFocus.current && previousFocus.current.focus) {
        try { previousFocus.current.focus(); } catch { /* element may be gone */ }
      }
      return;
    }
    const t = setTimeout(() => dialogRef.current?.focus(), 30);

    function getFocusables() {
      const root = dialogRef.current;
      if (!root) return [];
      const sel = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(root.querySelectorAll(sel)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null,
      );
    }
    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      const focusables = getFocusables();
      if (focusables.length === 0) {
        // No interactive content — keep focus on the dialog itself.
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === dialogRef.current) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    const node = dialogRef.current;
    node?.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(t);
      node?.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in p-4"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[80vh] overflow-y-auto focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700">
          <h2 id="keyboard-shortcuts-title" className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Keyboard size={17} aria-hidden="true" />
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close keyboard shortcuts"
            className="inline-flex items-center justify-center w-11 h-11 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <X size={18} />
          </button>
        </div>
        <ul className="px-5 py-3 divide-y divide-gray-100 dark:divide-gray-800">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between py-2.5 gap-4">
              <span className="text-sm text-gray-700 dark:text-gray-300">{s.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                {s.keys.map((k, i) => (
                  <kbd key={i} className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-xs font-mono font-medium text-gray-700 dark:text-gray-200">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
