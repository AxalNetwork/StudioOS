/**
 * D4615 (#4615) — the Settings cards' serialized saves (`lib/serialSave.js`)
 * wired to their routes, and how each card reads its switches. Kept apart from
 * SettingsPage.jsx so the tests drive them with promises they resolve in any
 * order.
 */
import { api } from './api';
import { SerialSaver, mergeDelta } from './serialSave';

const CONFLICT = 'Changed in another tab or device since you opened it, so your last change was not saved. The other change is shown.';

/** Visibility & discovery (`/settings/privacy`). */
export function privacySaver(read, setRow, flash, client = api) {
  const { revision, ...values } = read || {};
  return new SerialSaver({
    initial: values,
    revision: Number(revision ?? 0),
    send: (delta, rev) => client.updatePrivacySettings({ ...delta, expected_revision: rev }),
    accept: (res) => { const { revision: r, ...v } = res || {}; return { values: v, revision: r }; },
    conflictOf: (e) => { const cur = e?.data?.current; if (!cur) return null; const { revision: r, ...v } = cur; return { values: v, revision: r }; },
    onChange: (view) => setRow(view),
    onSaved: () => flash?.('Saved'),
    onError: (e, kind) => flash?.(kind === 'conflict' ? CONFLICT : (e?.message || 'Failed to save'), 'error'),
  });
}

/** Digest, categories and quiet hours (`/settings/notifications`). */
export function notificationSaver(read, setRow, flash, setFieldErrors, client = api) {
  const { revision, ...values } = read || {};
  return new SerialSaver({
    initial: values,
    revision: Number(revision ?? 0),
    send: (delta, rev) => client.updateNotificationSettings({ ...delta, expected_revision: rev }),
    accept: (res) => { const { revision: r, ...v } = res || {}; return { values: v, revision: r }; },
    conflictOf: (e) => { const cur = e?.data?.current; if (!cur) return null; const { revision: r, ...v } = cur; return { values: v, revision: r }; },
    onChange: (view) => setRow(view),
    onSaved: () => flash?.('Saved'),
    onError: (e, kind) => {
      // Task #14 — a field-level refusal is shown beside its field; anything else as a toast.
      if (kind === 'failed' && e?.status === 400 && e?.field) setFieldErrors?.({ [e.field]: e.message || 'Invalid value' });
      else flash?.(kind === 'conflict' ? CONFLICT : (e?.message || 'Failed to save'), 'error');
    },
  });
}

/** The public-profile switches (`/settings/privacy/public-profile`), one switch per save. */
export function publicProfileSaver(data, setPp, flash, client = api) {
  return new SerialSaver({
    initial: { ...(data?.public_profile_effective || {}) },
    revision: Number(data?.public_profile_revision ?? 0),
    send: (delta, rev) => client.updatePublicProfileSwitches({ fields: delta, expected_revision: rev }),
    accept: (res) => ({ values: res?.public_profile_effective || {}, revision: res?.public_profile_revision }),
    conflictOf: (e) => (e?.data?.public_profile_effective
      ? { values: e.data.public_profile_effective, revision: e.data.public_profile_revision } : null),
    onChange: (view) => setPp(view),
    onSaved: () => flash?.('Saved'),
    onError: (e, kind) => flash?.(kind === 'conflict' ? CONFLICT : (e?.message || 'Failed to save'), 'error'),
  });
}

/**
 * The category switches as the card draws them: the server's effective values
 * (unset is on, a mandatory category always on), with this tab's own choices
 * over them. Before the server reports effective values (an older Worker), an
 * unset switch still reads on, as delivery treats it.
 */
export function categorySwitches(row) {
  const eff = row?.effective_categories || null;
  const locked = new Set(eff?.locked || []);
  const pick = (effMap, stored) => {
    const out = { ...(effMap || {}) };
    for (const [k, v] of Object.entries(stored || {})) if (typeof v === 'boolean' && !locked.has(k)) out[k] = v;
    return new Proxy(out, { get: (t, k) => (typeof k === 'string' && !(k in t) ? true : t[k]) });
  };
  return { email: pick(eff?.email, row?.notif_categories_email), inapp: pick(eff?.inapp, row?.notif_categories_inapp), locked };
}

export { mergeDelta };
