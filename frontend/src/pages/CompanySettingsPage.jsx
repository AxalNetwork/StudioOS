import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useActiveCompany } from '../contexts/ActiveCompanyContext';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';

// ---------- Who may edit -----------------------------------------------------
//
// A CLIENT MIRROR OF THE SERVER'S RULE, and only a mirror. `canEdit` in
// cloudflare-worker/src/routes/company.ts is the boundary: it gates PATCH
// /company/:uid and every member write, and a non-editor who gets past this
// gets a 403. What this buys is honesty on screen — until now every member
// saw editable inputs on every field, and a viewer who typed into one watched
// their edit vanish on blur with a red toast. Showing a value as a value is
// the difference between "you may not" and "that didn't work".
//
// The rule, verbatim from company.ts:114-118: platform admins pass; otherwise
// the caller's own link must be the primary admin, or carry one of three
// role_in_company values. `frontend/test/company_settings_members.test.mjs`
// asserts this list against the worker's, because two copies of an
// authorisation rule drift.
const EDIT_ROLES = ['Owner', 'Admin', 'Founder'];

/**
 * The caller's own membership row, and what it lets them do.
 *
 * `members[]` already comes back on GET /company/:uid, so this costs no extra
 * request. The viewer's id comes from the cached session — which is a UI
 * affordance, not a check: a stale or edited localStorage changes what the
 * page DRAWS and nothing about what the server accepts.
 */
function useMyRights(row) {
  return useMemo(() => {
    const me = safeReadJSON('user', {}) || {};
    const members = row?.members || [];
    const mine = members.find((m) => Number(m.user_id) === Number(me.id)) || null;
    const platformAdmin = me.role === 'admin';
    const canEdit = platformAdmin
      || !!(mine && (mine.is_primary_admin || EDIT_ROLES.includes(mine.role_in_company)));
    const primaryAdmins = members.filter((m) => m.is_primary_admin).length;
    return {
      myUserId: me.id ?? null,
      mine,
      platformAdmin,
      canEdit,
      isPrimaryAdmin: !!mine?.is_primary_admin,
      // Leaving is a member action, so a platform admin who is not a member
      // has nothing to leave.
      canLeave: !!mine && !(mine.is_primary_admin && primaryAdmins <= 1),
      primaryAdmins,
    };
  }, [row]);
}

// ---------- Shared helpers ---------------------------------------------------

function Card({ title, description, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children, status }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
        {status && <FieldStatus status={status} />}
      </span>
      {children}
      {hint && <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-1">{hint}</span>}
    </label>
  );
}

/**
 * PER-FIELD ACKNOWLEDGMENT, not a page-level toast.
 *
 * Every field on this page saves on blur, so the page-level "Saved" said only
 * that SOMETHING saved — on a form of eleven fields that is a guess, and when
 * a save failed it named no field at all. The canvas puts the word beside the
 * input you just left, which is the only place it answers the question you
 * actually asked. `error` carries the server's own sentence rather than a
 * generic one.
 */
function FieldStatus({ status }) {
  if (status.state === 'saving') {
    return <span className="text-[11px] text-gray-400 dark:text-gray-500">Saving…</span>;
  }
  if (status.state === 'saved') {
    return <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Saved</span>;
  }
  if (status.state === 'error') {
    return (
      <span className="text-[11px] font-medium text-red-600 dark:text-red-400 text-right">
        {status.message}
      </span>
    );
  }
  return null;
}

/** A field the viewer may read but not change. */
function ReadOnlyValue({ value, empty = 'Not recorded' }) {
  const has = value !== null && value !== undefined && String(value).trim() !== '';
  return (
    <div className={`w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-sm ${
      has ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 italic'
    }`}>
      {has ? String(value) : empty}
    </div>
  );
}

const inputCls =
  'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm ' +
  'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ' +
  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500';

const STAGE_OPTIONS = [
  ['', '— select —'],
  ['idea', 'Idea'],
  ['pre_seed', 'Pre-seed'],
  ['seed', 'Seed'],
  ['series_a', 'Series A'],
  ['series_b', 'Series B'],
  ['series_c_plus', 'Series C+'],
  ['growth', 'Growth'],
  ['profitable', 'Profitable'],
  ['public', 'Public'],
];

// ---------- Toast ------------------------------------------------------------

function useFlash() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, (msg, kind = 'success') => setToast({ msg, kind })];
}

// ---------- Page -------------------------------------------------------------

export default function CompanySettingsPage() {
  const { company: activeCompany } = useActiveCompany();
  const [toast, flash] = useFlash();

  if (!activeCompany) {
    return <CompanyOnRamp flash={flash} toast={toast} />;
  }

  return (
    <div className="max-w-3xl p-6 mx-auto space-y-6" data-testid="company-settings-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Company Settings</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Profile and details for{' '}
          <span className="font-medium">{activeCompany.company_name}</span>.
        </p>
      </div>

      {toast && <Toast toast={toast} />}

      <CompanyProfileCard uid={activeCompany.uid} flash={flash} />
    </div>
  );
}

// ---------- Empty-state on-ramp ----------------------------------------------
//
// Wave 2. This was a dead-end sentence ("Create or join a company to manage its
// settings here") with no way to do either, while POST /company/create has been
// live the whole time. Joining is deliberately NOT a self-serve button: the
// backend has no join-request or invitation-accept endpoint — membership is
// created by someone who can already edit the company adding you. Saying so is
// the honest version; a button that cannot work is not.

function CompanyOnRamp({ flash, toast }) {
  const { setCompany } = useActiveCompany();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const company_name = name.trim();
    if (!company_name) { flash('Enter a company name', 'error'); return; }
    setBusy(true);
    try {
      const created = await api.createCompany({ company_name });
      setCompany(created);
      flash('Company created');
    } catch (e) {
      flash(e?.message || 'Could not create the company', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl p-6 mx-auto space-y-6" data-testid="company-settings-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Company Settings</h1>
        <p className="text-gray-600 dark:text-gray-400">
          You are not linked to a company yet.
        </p>
      </div>

      {toast && <Toast toast={toast} />}

      <Card
        title="Create your company"
        description="Sets up the workspace your cap table, raise and metrics hang off."
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            placeholder="Company name"
            disabled={busy}
            className={inputCls}
          />
          <button
            onClick={create}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? 'Creating…' : 'Create company'}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          You become its primary admin, and can add teammates straight after.
        </p>
      </Card>

      <Card title="Join an existing company">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Membership is granted from the other side: ask an owner, admin or founder
          of that company to add you by the email address on this account. There is
          no self-serve join request yet, so nothing here would reach them.
        </p>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">What a company unlocks</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {UNLOCKS.map((u) => (
            <div key={u.title} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{u.title}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{u.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Four claims, each one true of something on this page or one route away.
 *
 * An empty state is a promise about what happens next, so every line here is
 * checkable: roles are `role_in_company` plus migration 191's title/authority/
 * carry, the growth fields say in their own card description that they feed
 * investor matching, every workspace narrows on the `X-Company-Id` header the
 * switcher sets, and `GET /company/memberships` returns a list because more
 * than one is normal. Nothing here describes a feature that does not exist.
 */
const UNLOCKS = [
  {
    title: 'A team, with real roles',
    body: 'Add co-founders and hires by the email on their account, set who may edit what, and record title, '
      + 'authority and carry per person — three separate axes, not one free-text field.',
  },
  {
    title: 'Metrics that feed matching',
    body: 'The growth details on this page — revenue range, headcount, products, expansion — are what investor '
      + 'matching and deal analysis read. There is nowhere to put them until a company exists.',
  },
  {
    title: 'Every workspace in the sidebar',
    body: 'Spin-Out Lab, Brand & Landing, customer discovery, the raise — each one narrows to whichever company '
      + 'is selected at the top. Switching companies re-scopes the whole shell.',
  },
  {
    title: 'More than one, kept apart',
    body: 'Founders often run two. Each gets its own settings, its own members and its own data, and no page '
      + 'ever mixes them — the switcher is the only thing that changes which one you are looking at.',
  },
];

function Toast({ toast }) {
  return (
    <div
      className={`rounded-lg px-4 py-2.5 text-sm ${
        toast.kind === 'error'
          ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
          : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
      }`}
    >
      {toast.msg}
    </div>
  );
}

// ---------- Company profile card ---------------------------------------------

function CompanyProfileCard({ uid, flash }) {
  const { setCompany } = useActiveCompany();
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  // One entry per field key: { state: 'saving'|'saved'|'error', message? }.
  // Keyed rather than a single flag so two fields saving at once cannot
  // overwrite each other's answer.
  const [fieldStatus, setFieldStatus] = useState({});
  const rights = useMyRights(row);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    api
      .getCompany(uid)
      .then(data => { if (!cancelled) setRow(data); })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Failed to load company profile'); });
    return () => { cancelled = true; };
  }, [uid]);

  const mark = useCallback((key, status) => {
    setFieldStatus(prev => ({ ...prev, [key]: status }));
    if (status?.state === 'saved') {
      setTimeout(() => setFieldStatus(prev => {
        if (prev[key]?.state !== 'saved') return prev;
        const next = { ...prev }; delete next[key]; return next;
      }), 2500);
    }
  }, []);

  const saveField = useCallback(
    async (key, value) => {
      mark(key, { state: 'saving' });
      try {
        const updated = await api.updateCompany(uid, { [key]: value });
        setRow(updated);
        // Keep the switcher display name in sync
        setCompany(prev => (prev ? { ...prev, [key]: value } : prev));
        mark(key, { state: 'saved' });
      } catch (e) {
        // The server's own sentence, not a generic one — it is the only thing
        // that says WHY, and a field-level message with no reason is noise.
        mark(key, { state: 'error', message: e?.message || 'Not saved' });
      }
    },
    [uid, mark, setCompany],
  );

  if (err) {
    return (
      <Card title="Company profile">
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      </Card>
    );
  }
  if (!row) {
    return (
      <Card title="Company profile">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      </Card>
    );
  }

  const { canEdit } = rights;
  const set = (k, v) => setRow(r => ({ ...r, [k]: v }));
  const onBlur = k => {
    const v = row[k] ?? '';
    // The one field that cannot be blanked: the company name is what every
    // other surface calls this workspace. The server rejects it too; saying so
    // here means the refusal names the field instead of arriving as a toast.
    if (k === 'company_name' && !String(v).trim()) {
      mark(k, { state: 'error', message: 'Can’t be empty — not saved' });
      return;
    }
    saveField(k, v === '' ? null : v);
  };

  /** An editable input, or the value, depending on what this member may do. */
  const text = (k, extra = {}) => (canEdit ? (
    <input
      value={row[k] || ''}
      onChange={e => set(k, e.target.value)}
      onBlur={() => onBlur(k)}
      disabled={fieldStatus[k]?.state === 'saving'}
      className={inputCls}
      {...extra}
    />
  ) : <ReadOnlyValue value={row[k]} />);

  return (
    <>
      {!canEdit && <ViewOnlyNotice rights={rights} />}

      <Card title="Company profile" description="Basic information shown across Axal VC.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Company name" status={fieldStatus.company_name}>
            {text('company_name')}
          </Field>
          <Field label="Stage" status={fieldStatus.stage}>
            {canEdit ? (
              <select
                value={row.stage || ''}
                onChange={e => { set('stage', e.target.value); saveField('stage', e.target.value || null); }}
                disabled={fieldStatus.stage?.state === 'saving'}
                className={inputCls}
              >
                {STAGE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            ) : (
              <ReadOnlyValue value={STAGE_OPTIONS.find(([v]) => v === row.stage)?.[1] || null} />
            )}
          </Field>
          <Field label="Website" status={fieldStatus.website}>
            {text('website', { placeholder: 'https://…' })}
          </Field>
          <Field label="LinkedIn URL" status={fieldStatus.linkedin_url}>
            {text('linkedin_url', { placeholder: 'https://linkedin.com/company/…' })}
          </Field>
          <Field label="International presence" hint="e.g. US, EU, APAC" status={fieldStatus.international_presence}>
            {text('international_presence')}
          </Field>
          <Field label="Logo URL" status={fieldStatus.logo_url}>
            {text('logo_url', { placeholder: 'https://…' })}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" status={fieldStatus.description}>
              {canEdit ? (
                <textarea
                  value={row.description || ''}
                  onChange={e => set('description', e.target.value)}
                  onBlur={() => onBlur('description')}
                  disabled={fieldStatus.description?.state === 'saving'}
                  rows={3}
                  className={`${inputCls} resize-none`}
                />
              ) : <ReadOnlyValue value={row.description} />}
            </Field>
          </div>
        </div>
      </Card>

      <Card
        title="Growth details"
        description="Business metrics used in investor matching and deal analysis."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Revenue range" status={fieldStatus.revenue_range}>
            {text('revenue_range', { placeholder: 'e.g. $1M–$5M ARR' })}
          </Field>
          <Field label="Employee count" status={fieldStatus.employee_count}>
            {canEdit ? (
              <input
                type="number"
                min="0"
                value={row.employee_count ?? ''}
                onChange={e =>
                  set('employee_count', e.target.value === '' ? null : Number(e.target.value))
                }
                onBlur={() => saveField('employee_count', row.employee_count ?? null)}
                disabled={fieldStatus.employee_count?.state === 'saving'}
                className={inputCls}
              />
            ) : <ReadOnlyValue value={row.employee_count} />}
          </Field>
          <Field label="Current products" status={fieldStatus.current_products}>
            {text('current_products')}
          </Field>
          <Field label="Expansion goals" status={fieldStatus.expansion_goals}>
            {text('expansion_goals')}
          </Field>
        </div>
      </Card>

      <MembersCard uid={uid} row={row} setRow={setRow} flash={flash} rights={rights} />

      <DangerZoneCard uid={uid} row={row} rights={rights} flash={flash} />

      <BoundaryNote />
    </>
  );
}

/**
 * Why the fields above are not inputs.
 *
 * Drawn only for a member who cannot edit. The three role names are the
 * server's, and the sentence about titles is the part people get wrong: a
 * `role_in_company` of "CTO" is a LABEL — company.ts checks the string against
 * three values and CTO is not one of them.
 */
function ViewOnlyNotice({ rights }) {
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-5 py-4">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">You can view this company, not edit it</p>
      <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-1">
        {rights.mine
          ? <>Your role here is <strong>{rights.mine.role_in_company || 'not recorded'}</strong>. Editing settings and
            managing members is limited to the primary admin and to members whose role is Owner, Admin or Founder.
            Any other title is a label and grants no edit rights.</>
          : <>You are not a member of this company. Ask an owner, admin or founder to add you by the email
            address on this account.</>}
      </p>
    </div>
  );
}

/**
 * What lives here and what does not.
 *
 * Straight from the canvas, and worth keeping because the two most common
 * mistakes on this page are looking for personal identity here and looking for
 * company settings in Account. Every destination named is a real route.
 */
function BoundaryNote() {
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
      Recruiting — advisors, co-founders and open roles — lives in Team. Landing pages live in Brand &amp; Landing,
      which reads the name and logo set above. Your own name, email, identity documents and security live in{' '}
      <a href="/account" className="underline hover:text-gray-700 dark:hover:text-gray-300">Account</a>, not here.
    </p>
  );
}

// ---------- Danger zone ------------------------------------------------------
//
// THE CANVAS DRAWS THREE ACTIONS. Two exist and one does not, and the third is
// why this card is written the way it is.
//
//   Transfer primary admin  — REAL. `PATCH /company/:uid/members/:userId`
//                             with `{ is_primary_admin: true }`, and only a
//                             primary admin may grant it (company.ts:362-365).
//                             It is the "Make primary" button on a member row,
//                             so this card points at it rather than shipping a
//                             second control for one write.
//   Leave company           — REAL. `DELETE /company/:uid/members/:userId`
//                             applied to your own id, with the existing
//                             last-primary-admin guard.
//   Delete company          — DOES NOT EXIST. `company.ts` declares eleven
//                             routes and company deletion is not one of them.
//
// The canvas gives Delete a type-the-name confirmation, which is the right
// design for a real destructive action and the wrong thing to ship over a
// route that 404s. A confirmation dialog is a promise that something will
// happen. So the limit is stated instead: what is missing, and what to do
// meanwhile. Building the endpoint is a separate change — it is deletion
// across the cap table, the raise, the data room and the metrics, and it
// deserves its own decision rather than arriving as UI polish.

function DangerZoneCard({ uid, row, rights, flash }) {
  const { setCompany } = useActiveCompany();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = row?.company_name || 'this company';

  const leave = async () => {
    setBusy(true);
    try {
      await api.removeCompanyMember(uid, rights.myUserId);
      // The company is gone from under this page, so drop it from the switcher
      // rather than leaving a stale selection pointing at a 404.
      setCompany(null);
      flash(`You have left ${name}`);
    } catch (e) {
      flash(e?.message || 'Could not leave the company', 'error');
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900 rounded-xl">
      <div className="px-5 py-4 border-b border-red-100 dark:border-red-900/60">
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">Danger zone</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Actions that change who holds {name}, or your own access to it.
        </p>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        <div className="p-5">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Transfer primary admin</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {rights.isPrimaryAdmin
              ? <>Use <strong>Make primary</strong> on the member you want to hand it to, in Members &amp; access
                above. You keep your seat; they take over member management and the lifecycle actions here.</>
              : <>Only the current primary admin can hand the role on.</>}
          </p>
        </div>

        <div className="p-5">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Leave company</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Removes your own access to {name}. Everything you contributed stays with the company.
          </p>
          {!rights.mine ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
              You are not a member of this company, so there is nothing to leave.
            </p>
          ) : !rights.canLeave ? (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              You are the only primary admin. Appoint another one first — a company with no primary admin has
              nobody who can manage it.
            </p>
          ) : confirming ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-700 dark:text-gray-300">
                Leave {name}? You will need someone inside to add you back.
              </span>
              <button
                onClick={leave}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Leaving…' : 'Yes, leave'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 font-medium hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              Leave company
            </button>
          )}
        </div>

        {/*
          NOT A BUTTON, because there is no endpoint behind one. Stating the
          limit is the honest version; a type-to-confirm dialog over a route
          that does not exist is worse than no control at all.
        */}
        <div className="p-5">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Delete company</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Not available from here. Deleting a company would remove every workspace scoped to it — cap table,
            raise, data room, metrics — and there is no self-serve route for that yet. Ask the Axal VC team
            through the <a href="/help" className="underline hover:text-gray-700 dark:hover:text-gray-300">Help Center</a>,
            and they will confirm what is held before anything is removed.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- Members & access -------------------------------------------------
//
// Wave 2, and the cheapest win in the whole census: `GET /company/:uid` has
// ALWAYS returned `members[]` (user_id, name, email, role_in_company,
// is_primary_admin, joined_at) plus `member_count`, and this page loaded it and
// rendered none of it. Add and remove were live with no UI; role change is new
// (PATCH /company/:uid/members/:userId, added alongside this).
//
// Two honesty points the canvas glosses over and this UI does not:
//   • "Invite by email" is not an invite. The backend resolves the address to
//     an EXISTING user and 404s otherwise — there is no invitation record and
//     no email is sent. The copy says so rather than implying a pending invite.
//   • Every mutation returns the refreshed company detail, so the list below is
//     the server's answer, never a local guess about what the write did.
/**
 * Title, authority and carry are THREE axes, not one.
 *
 * `role_in_company` was the only one — a free-text string everything a firm
 * knows about a teammate had to be squeezed into. Migration 191 separates
 * where someone sits (title), what they may do (authority) and what they are
 * paid on (carry). The design's own cases are why: a Venture Partner SPONSORs
 * while a Vice President only FLAGs, an Operating Partner is a partner by
 * title and VIEW by authority, and carry tracks neither.
 *
 * The picker never hardcodes the vocabulary — GET /company/team-vocabulary
 * serves the ladder, the functions and what each authority level MEANS, so
 * the two sides cannot drift. Selecting a title pre-fills authority from that
 * payload and then leaves it alone: the two are stored independently, and the
 * server does not derive one from the other either.
 *
 * `role_in_company` stays. Twenty-three production accounts have one and
 * canEdit() still reads it; retiring an access check is a separate change.
 */
function MembersCard({ uid, row, setRow, flash, rights }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [busy, setBusy] = useState(false);
  const [vocab, setVocab] = useState(null);

  useEffect(() => {
    let off = false;
    api.teamVocabulary().then((v) => { if (!off) setVocab(v); }).catch(() => {});
    return () => { off = true; };
  }, []);

  const members = row.members || [];
  const primaryAdmins = members.filter((m) => m.is_primary_admin).length;

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const updated = await fn();
      if (updated && Array.isArray(updated.members)) setRow(updated);
      flash(okMsg);
    } catch (e) {
      flash(e?.message || 'That did not work', 'error');
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const addr = email.trim().toLowerCase();
    if (!addr) { flash('Enter the teammate’s email', 'error'); return; }
    run(async () => {
      const r = await api.addCompanyMember(uid, { email: addr, role_in_company: role });
      setEmail('');
      return r;
    }, `${addr} added`);
  };

  return (
    <Card
      title={`Members & access (${members.length})`}
      description="Who can see and edit this company. Owners, Admins and Founders can manage members."
    >
      {/*
        THE RULE, SPELLED OUT. `role_in_company` is free text, and the three
        names that actually grant rights are indistinguishable from the ones
        that do not unless someone says so. This is the sentence people need
        before they wonder why their CTO cannot invite anyone.
      */}
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
        <strong className="text-gray-700 dark:text-gray-300">Owner</strong>,{' '}
        <strong className="text-gray-700 dark:text-gray-300">Admin</strong> and{' '}
        <strong className="text-gray-700 dark:text-gray-300">Founder</strong> can edit settings and manage
        members. Any other title — CTO, Head of Product — is a label and grants no edit rights. The primary
        admin can’t be removed; appoint another one first.
      </p>
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
        {members.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 p-4">
            No members recorded on this company.
          </p>
        )}
        {members.map((m) => {
          const isYou = Number(m.user_id) === Number(rights.myUserId);
          // The server's rule, per row: only an editor may change anyone, and
          // the primary admin's row is not editable or removable by anyone —
          // the role is transferred, not taken.
          const canChange = rights.canEdit && !m.is_primary_admin;
          const canRemove = rights.canEdit && !(m.is_primary_admin && primaryAdmins <= 1);
          return (
          <div key={m.user_id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {m.name || m.email}
                {isYou && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    You
                  </span>
                )}
                {m.is_primary_admin && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                    Primary admin
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.email}</div>
            </div>

            <input
              defaultValue={m.role_in_company || ''}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (!next || next === m.role_in_company) return;
                run(() => api.updateCompanyMember(uid, m.user_id, { role_in_company: next }),
                    `${m.name || m.email} is now ${next}`);
              }}
              disabled={busy || !canChange}
              aria-label={`Role for ${m.name || m.email}`}
              className="w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />

            {vocab && (
              <>
                <select
                  value={m.title || ''}
                  onChange={(e) => {
                    const title = e.target.value || null;
                    // The ladder's authority is a SUGGESTION. It pre-fills only
                    // when authority has not been set yet; an explicit choice is
                    // never overwritten by a rename.
                    const rung = [...vocab.ladder, ...vocab.functions]
                      .find((x) => (x.title || x.name) === title);
                    const patch = { title };
                    if (title && rung && !m.authority) patch.authority = rung.defaultAuthority;
                    run(() => api.updateCompanyMember(uid, m.user_id, patch),
                        title ? `${m.name || m.email} is now ${title}` : 'Title cleared');
                  }}
                  disabled={busy || !canChange}
                  aria-label={`Title for ${m.name || m.email}`}
                  className="w-40 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Title — not recorded</option>
                  <optgroup label="Ladder">
                    {vocab.ladder.map((r) => <option key={r.title} value={r.title}>{r.title}</option>)}
                  </optgroup>
                  <optgroup label="Functions">
                    {vocab.functions.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </optgroup>
                </select>

                <select
                  value={m.authority || ''}
                  onChange={(e) => run(
                    () => api.updateCompanyMember(uid, m.user_id, { authority: e.target.value || null }),
                    e.target.value ? `${m.name || m.email} can ${e.target.value}` : 'Authority cleared',
                  )}
                  disabled={busy || !canChange}
                  aria-label={`Authority for ${m.name || m.email}`}
                  title={vocab.authority_levels.find((a) => a.key === m.authority)?.meaning || ''}
                  className="w-28 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Authority —</option>
                  {vocab.authority_levels.map((a) => (
                    <option key={a.key} value={a.key} title={a.meaning}>{a.key}</option>
                  ))}
                </select>

                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  defaultValue={m.carry_bps ?? ''}
                  placeholder="carry bps"
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const next = raw === '' ? null : Number(raw);
                    if (next === (m.carry_bps ?? null)) return;
                    run(() => api.updateCompanyMember(uid, m.user_id, { carry_bps: next }),
                        next === null ? 'Carry cleared' : `Carry set to ${(next / 100).toFixed(2)}%`);
                  }}
                  disabled={busy || !canChange}
                  aria-label={`Carry in basis points for ${m.name || m.email}`}
                  title="Basis points — 150 is 1.5%. Stored as a whole number, never a float."
                  className="w-24 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 tabular-nums"
                />
              </>
            )}

            {!m.is_primary_admin && rights.isPrimaryAdmin && (
              <button
                onClick={() => run(
                  () => api.updateCompanyMember(uid, m.user_id, { is_primary_admin: true }),
                  `${m.name || m.email} is now a primary admin`,
                )}
                disabled={busy}
                className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-400 disabled:opacity-50"
              >
                Make primary
              </button>
            )}

            <button
              onClick={() => run(
                async () => { await api.removeCompanyMember(uid, m.user_id); return api.getCompany(uid); },
                `${m.name || m.email} removed`,
              )}
              disabled={busy || !canRemove}
              title={!rights.canEdit
                ? 'Only the primary admin, or an Owner, Admin or Founder, can remove a member'
                : m.is_primary_admin && primaryAdmins <= 1
                  ? 'Appoint another primary admin first'
                  : isYou ? 'Removes your own access — see Leave company below' : 'Remove from this company'}
              className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-red-400 hover:text-red-600 disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
            >
              Remove
            </button>
          </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        {!rights.canEdit ? (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Adding and removing members is limited to the primary admin and to members whose role is
            Owner, Admin or Founder.
          </p>
        ) : (
        <>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="teammate@company.com"
            disabled={busy}
            className={inputCls}
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role"
            disabled={busy}
            aria-label="Role for the new member"
            className="sm:w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={add}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
          >
            Add member
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          The address must already belong to an Axal VC account — this links an
          existing user, it does not send an invitation.
        </p>
        </>
        )}
      </div>
    </Card>
  );
}
