// T18 — Safe localStorage helpers.
//
// Why: every JSON.parse(localStorage.getItem(key)) site can crash on:
//   1. localStorage being unavailable (Safari private mode, iframes)
//   2. The stored value being corrupted by another tab/extension
//   3. The user wiping the value mid-session
//
// Use safeReadJSON / safeWriteJSON instead. They never throw.

export function safeReadJSON(key, fallback = null) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function safeWriteJSON(key, value) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(key) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {}
}
