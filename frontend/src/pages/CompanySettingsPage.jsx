import React, { useState, useEffect, useCallback } from 'react';
import { useActiveCompany } from '../contexts/ActiveCompanyContext';
import { api } from '../lib/api';

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

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-1">{hint}</span>}
    </label>
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
    </div>
  );
}

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    api
      .getCompany(uid)
      .then(data => { if (!cancelled) setRow(data); })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Failed to load company profile'); });
    return () => { cancelled = true; };
  }, [uid]);

  const save = useCallback(
    async changes => {
      setBusy(true);
      try {
        const updated = await api.updateCompany(uid, changes);
        setRow(updated);
        // Keep the switcher display name in sync
        setCompany(prev => (prev ? { ...prev, ...changes } : prev));
        flash('Saved');
      } catch (e) {
        flash(e?.message || 'Failed to save', 'error');
      } finally {
        setBusy(false);
      }
    },
    [uid, flash, setCompany],
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
        <p className="text-sm text-gray-500">Loading…</p>
      </Card>
    );
  }

  const set = (k, v) => setRow(r => ({ ...r, [k]: v }));
  const onBlur = k => {
    const v = row[k] ?? '';
    save({ [k]: v === '' ? null : v });
  };

  return (
    <>
      <Card title="Company profile" description="Basic information shown across Axal VC.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Company name">
            <input
              value={row.company_name || ''}
              onChange={e => set('company_name', e.target.value)}
              onBlur={() => onBlur('company_name')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Stage">
            <select
              value={row.stage || ''}
              onChange={e => { set('stage', e.target.value); save({ stage: e.target.value || null }); }}
              disabled={busy}
              className={inputCls}
            >
              {STAGE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Website">
            <input
              value={row.website || ''}
              onChange={e => set('website', e.target.value)}
              onBlur={() => onBlur('website')}
              disabled={busy}
              placeholder="https://…"
              className={inputCls}
            />
          </Field>
          <Field label="LinkedIn URL">
            <input
              value={row.linkedin_url || ''}
              onChange={e => set('linkedin_url', e.target.value)}
              onBlur={() => onBlur('linkedin_url')}
              disabled={busy}
              placeholder="https://linkedin.com/company/…"
              className={inputCls}
            />
          </Field>
          <Field label="International presence" hint="e.g. US, EU, APAC">
            <input
              value={row.international_presence || ''}
              onChange={e => set('international_presence', e.target.value)}
              onBlur={() => onBlur('international_presence')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Logo URL">
            <input
              value={row.logo_url || ''}
              onChange={e => set('logo_url', e.target.value)}
              onBlur={() => onBlur('logo_url')}
              disabled={busy}
              placeholder="https://…"
              className={inputCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea
                value={row.description || ''}
                onChange={e => set('description', e.target.value)}
                onBlur={() => onBlur('description')}
                disabled={busy}
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card
        title="Growth details"
        description="Business metrics used in investor matching and deal analysis."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Revenue range">
            <input
              value={row.revenue_range || ''}
              onChange={e => set('revenue_range', e.target.value)}
              onBlur={() => onBlur('revenue_range')}
              disabled={busy}
              placeholder="e.g. $1M–$5M ARR"
              className={inputCls}
            />
          </Field>
          <Field label="Employee count">
            <input
              type="number"
              min="0"
              value={row.employee_count ?? ''}
              onChange={e =>
                set('employee_count', e.target.value === '' ? null : Number(e.target.value))
              }
              onBlur={() => save({ employee_count: row.employee_count ?? null })}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Current products">
            <input
              value={row.current_products || ''}
              onChange={e => set('current_products', e.target.value)}
              onBlur={() => onBlur('current_products')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Expansion goals">
            <input
              value={row.expansion_goals || ''}
              onChange={e => set('expansion_goals', e.target.value)}
              onBlur={() => onBlur('expansion_goals')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      <MembersCard uid={uid} row={row} setRow={setRow} flash={flash} />
    </>
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
function MembersCard({ uid, row, setRow, flash }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [busy, setBusy] = useState(false);

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
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
        {members.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 p-4">
            No members recorded on this company.
          </p>
        )}
        {members.map((m) => (
          <div key={m.user_id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {m.name || m.email}
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
              disabled={busy}
              aria-label={`Role for ${m.name || m.email}`}
              className="w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />

            {!m.is_primary_admin && (
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
              disabled={busy || (m.is_primary_admin && primaryAdmins <= 1)}
              title={m.is_primary_admin && primaryAdmins <= 1
                ? 'Appoint another primary admin first'
                : 'Remove from this company'}
              className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-red-400 hover:text-red-600 disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
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
      </div>
    </Card>
  );
}
