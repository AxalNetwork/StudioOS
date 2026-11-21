// D4618 part 2 (#4618): the account's entity records, drawn on Portfolio's
// Companies tab (D1140): "Your companies" with each company's KYB pill and
// entity editor, and the account's signing entity (`CorporateEntityCard`).
// Moved unchanged out of `../SettingsPage.jsx`; each card owns its reads.
import Card from './AccountCard.jsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unreadable } from '../../ui';
import { companyPathFor } from './companies/companiesModel';
import { Field, inputCls } from './SettingsFields';

// ---------- Task #16 — Profile sub-tabs (Personal / Corporate / Verification)

const ENTITY_TYPE_OPTIONS = [
  ['', '— select —'],
  ['llc', 'LLC'],
  ['c_corp', 'C-Corp'],
  ['s_corp', 'S-Corp'],
  ['b_corp', 'B-Corp'],
  ['ltd', 'Ltd'],
  ['plc', 'PLC'],
  ['gmbh', 'GmbH'],
  ['ug', 'UG'],
  ['ag', 'AG'],
  ['sa', 'SA'],
  ['sas', 'SAS'],
  ['sarl', 'SARL'],
  ['bv', 'BV'],
  ['nv', 'NV'],
  ['spa', 'SpA'],
  ['srl', 'Srl'],
  ['ab', 'AB'],
  ['as', 'AS'],
  ['oy', 'Oy'],
  ['pte_ltd', 'Pte Ltd'],
  ['pty_ltd', 'Pty Ltd'],
  ['kk', 'KK'],
  ['gk', 'GK'],
  ['sole_proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership'],
  ['other', 'Other'],
];


// ---------- Corporate / legal entity ---------------------------------------
//
// The account's signing entity: the legal entity, its owners and directors,
// and the screening flags (read-only here). It renders on Companies and
// projects (owner, 2026-10-28), beside the account's companies, and no longer
// on Profile and identity.
//
// corporate_profiles.user_id is a PRIMARY KEY, so this is ONE entity per
// account, not one per company. That is why it is the account's own card,
// beside the companies list, and not in one company's Company Settings, whose
// "Legal entity" card would need columns
// company_profiles does not have (see account_canvas_coverage.test.mjs).

// Small editor for the two JSON array columns (ubos_json, directors_json).
// The server takes the whole array in one PUT and revalidates every row, so
// these save explicitly rather than on blur: a per-row autosave would race
// its own siblings and there is no per-row endpoint to race against.
function RowList({ label, hint, cols, rows, onChange, onSave, busy, error, addLabel }) {
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => onChange([...rows, Object.fromEntries(cols.map(c => [c.k, c.type === 'bool' ? false : '']))]);
  const del = (i) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
      <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</h3>
      {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{hint}</p>}
      {rows.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Not recorded.</p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 mb-2">
          {cols.map(c => (
            <div key={c.k} className={c.w || 'flex-1 min-w-[8rem]'}>
              <span className="text-[11px] text-gray-600 dark:text-gray-400 block mb-1">{c.label}</span>
              {c.type === 'bool' ? (
                <label className="flex items-center gap-2 h-[38px] text-xs text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={!!r[c.k]} disabled={busy}
                    onChange={e => set(i, c.k, e.target.checked)} />
                  {c.boxLabel}
                </label>
              ) : (
                <input value={r[c.k] ?? ''} disabled={busy} className={inputCls}
                  maxLength={c.maxLength} placeholder={c.placeholder}
                  onChange={e => set(i, c.k, c.upper ? e.target.value.toUpperCase() : e.target.value)} />
              )}
            </div>
          ))}
          <button onClick={() => del(i)} disabled={busy}
            className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg">
            Remove
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={add} disabled={busy}
          className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg">
          {addLabel}
        </button>
        <button onClick={onSave} disabled={busy}
          className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg">
          Save
        </button>
      </div>
      {error && <span className="text-[11px] text-red-600 dark:text-red-400 block mt-1">{error}</span>}
    </div>
  );
}


export function CorporateEntityCard({ flash }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [taxIdInput, setTaxIdInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [ubos, setUbos] = useState([]);
  const [directors, setDirectors] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.getLegalEntity()
      .then(r => {
        if (cancelled) return;
        setRow(r);
        setUbos(Array.isArray(r.ubos) ? r.ubos : []);
        setDirectors(Array.isArray(r.directors) ? r.directors : []);
      })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load legal entity'); });
    return () => { cancelled = true; };
  }, []);

  // The profile routes' error contract: the worker throws
  // ProfileValidationError with a `field`, so a rejection lands inline on the
  // input that caused it instead of a toast that names nothing.
  const save = async (patch) => {
    setBusy(true);
    setFieldErrors({});
    try {
      const updated = await api.updateLegalEntity(patch);
      setRow(updated);
      setUbos(Array.isArray(updated.ubos) ? updated.ubos : []);
      setDirectors(Array.isArray(updated.directors) ? updated.directors : []);
      try { window.dispatchEvent(new CustomEvent('axal:profile_saved')); } catch {}
      flash('Saved');
      if ('tax_id_number' in patch) setTaxIdInput('');
      return true;
    } catch (e) {
      const errsMap = e?.data?.errors;
      if (errsMap && typeof errsMap === 'object') setFieldErrors(errsMap);
      else if (e?.field) setFieldErrors({ [e.field]: e.message });
      if (!e?.field && !errsMap) flash(e.message || 'Failed to save', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (err) return <Card title="Legal entity"><div className="text-sm text-red-600 dark:text-red-400">{err}</div></Card>;
  if (!row) return <Card title="Legal entity"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const r = row;
  const set = (k, v) => setRow({ ...r, [k]: v });
  const onBlurSave = (k) => {
    const v = r[k] ?? null;
    save({ [k]: v === '' ? null : v });
  };
  const fe = (k) => fieldErrors[k]
    ? <span className="text-[11px] text-red-600 dark:text-red-400 block mt-1">{fieldErrors[k]}</span>
    : null;

  const text = (k, label, extra = {}) => (
    <Field label={label} hint={extra.hint}>
      <input value={r[k] || ''} maxLength={extra.maxLength}
        placeholder={extra.placeholder} disabled={busy} className={inputCls}
        onChange={e => set(k, extra.upper ? e.target.value.toUpperCase() : e.target.value)}
        onBlur={() => onBlurSave(k)} />
      {fe(k)}
    </Field>
  );

  // Derived server-side from the UBO rows (>= 25% ownership), so it is shown
  // as a consequence of the table below, never as its own toggle.
  const disclosed = !!r.ubo_disclosed;

  return (
    <Card title="Legal entity"
      description="The company that signs on your behalf. Used to auto-fill contracts between that entity and Axal VC. Sensitive fields are encrypted at rest.">
      <div className="grid sm:grid-cols-2 gap-3">
        {text('entity_name', 'Legal entity name', { maxLength: 200 })}
        <Field label="Entity type"
          hint="Setting a type requires a registration number — the server refuses the pair otherwise.">
          <select value={r.entity_type || ''} disabled={busy} className={inputCls}
            onChange={e => { const v = e.target.value; set('entity_type', v); save({ entity_type: v || null }); }}>
            {ENTITY_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {fe('entity_type')}
        </Field>
        {text('registration_number', 'Registration number', { maxLength: 100 })}
        <Field label={`Tax ID${r.has_tax_id ? ' (saved · ••••' + (r.tax_id_last4 || '••••') + ')' : ''}`}
          hint="Encrypted at rest. Type a new value to replace.">
          <div className="flex gap-2">
            <input value={taxIdInput} onChange={e => setTaxIdInput(e.target.value)}
              disabled={busy} className={inputCls} placeholder={r.has_tax_id ? 'Replace…' : 'Enter…'} />
            <button onClick={() => taxIdInput && save({ tax_id_number: taxIdInput })}
              disabled={busy || !taxIdInput}
              className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg">Save</button>
            {r.has_tax_id && (
              <button onClick={() => save({ tax_id_number: null })} disabled={busy}
                className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg">Clear</button>
            )}
          </div>
          {fe('tax_id_number')}
        </Field>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Registered address</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {text('registered_address_line1', 'Address line 1')}
          {text('registered_address_line2', 'Address line 2')}
          {text('registered_city', 'City', { maxLength: 100 })}
          {text('registered_state', 'State / region', { maxLength: 100 })}
          {text('registered_postal', 'Postal code')}
          {text('registered_country', 'Country of incorporation (ISO α-2)', { maxLength: 2, upper: true, placeholder: 'US' })}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Signing authority</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {text('signing_authority_name', 'Name', { maxLength: 200 })}
          {text('signing_authority_title', 'Title', { maxLength: 100 })}
          {text('signing_authority_email', 'Email', { maxLength: 320 })}
        </div>
      </div>

      <RowList
        label="Beneficial owners"
        hint={`Anyone holding 25% or more. ${disclosed
          ? 'At least one owner at or above 25% is recorded.'
          : 'No owner at or above 25% is recorded yet.'}`}
        addLabel="Add owner"
        busy={busy}
        error={fieldErrors.ubos}
        rows={ubos}
        onChange={setUbos}
        onSave={() => save({ ubos })}
        cols={[
          { k: 'name', label: 'Name', maxLength: 200 },
          { k: 'nationality', label: 'Nationality (ISO α-2)', maxLength: 2, upper: true, placeholder: 'US', w: 'w-32' },
          { k: 'ownership_pct', label: 'Ownership %', w: 'w-28' },
          { k: 'is_pep', label: 'Politically exposed', type: 'bool', boxLabel: 'Yes', w: 'w-40' },
        ]}
      />

      <RowList
        label="Directors"
        addLabel="Add director"
        busy={busy}
        error={fieldErrors.directors}
        rows={directors}
        onChange={setDirectors}
        onSave={() => save({ directors })}
        cols={[
          { k: 'name', label: 'Name', maxLength: 200 },
          { k: 'title', label: 'Title', maxLength: 100 },
          { k: 'email', label: 'Email', maxLength: 320 },
        ]}
      />

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Screening</h3>
        <dl className="grid sm:grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-gray-600 dark:text-gray-400">High-risk jurisdiction</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-0.5">
              {r.aml_high_risk_jurisdiction ? 'Flagged' : 'Not flagged'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-600 dark:text-gray-400">Sanctions last checked</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-0.5">
              {r.sanctions_last_checked_at
                ? new Date(r.sanctions_last_checked_at).toLocaleDateString()
                : 'Not recorded'}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          Both are set by screening, not from this page. Insurance carriers are stored
          on this record but have no editor here yet.
        </p>
      </div>
    </Card>
  );
}


// ---------- Your companies (Wave 2) -----------------------------------------
//
// The Account canvas asks for a "Your companies" pane. `GET /company/memberships`
// has been live with no consumer anywhere in Settings — this page made zero
// company calls before now.
//
// Read-only ON PURPOSE. The integration rule is that company context changes
// through `CompanySwitcher` and nowhere else, so this pane reports what you
// belong to and sends you to the switcher; it does not become a second one.
// D433 — the KYB pill and the entity fields the Account canvas draws per
// company. The pill comes from GET /trust/companies/kyb (migration 220, one
// `company_kyb_records` row per company), matched to the memberships list by
// company id. "Save entity" writes POST /trust/companies/kyb for THAT row's
// company — the client names it by overriding the X-Company-Id header for the
// one call, and the worker still verifies membership before writing.
//
// TWO READS, TWO FAILURE STATES. Memberships and KYB come from different
// routes; a failed KYB read must not blank the company list, and must not
// read as "no record" either — it says "Unreadable" on the rows it could not
// answer for, with a retry.
const KYB_STATUS_LABEL = {
  in_review: 'In review',
  verified: 'Verified',
  rejected: 'Rejected',
  not_started: 'Not started',
};

function kybStatusLabel(status) {
  if (!status) return 'Not started';
  return KYB_STATUS_LABEL[status] || String(status).replace(/_/g, ' ');
}

function kybTone(status) {
  if (status === 'verified') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
  if (status === 'in_review') return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
  return 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
}


const COMPANY_ENTITY_FIELDS = [
  ['entity_name', 'Legal entity name'],
  ['entity_type', 'Entity type'],
  ['jurisdiction', 'Country of incorporation'],
  ['registration_number', 'Registration ID'],
  ['registered_address', 'Registered address'],
];


function CompanyEntityEditor({ company, kyb, onSaved, flash }) {
  const [form, setForm] = useState(() => Object.fromEntries(
    COMPANY_ENTITY_FIELDS.map(([k]) => [k, kyb?.[k] || '']),
  ));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await api.companyKybStart(form, company.id);
      onSaved(res?.kyb || null);
      flash?.('Entity saved — verification is in review.');
    } catch (e) {
      setErr(e?.message || 'Could not save this entity');
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3" data-testid={`company-entity-editor-${company.id}`}>
      <div className="grid sm:grid-cols-2 gap-3">
        {COMPANY_ENTITY_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={inputCls} />
          </Field>
        ))}
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Saving puts this company&apos;s verification in review. No registry match runs yet — there is no provider on this platform.
        </p>
        <button type="button" onClick={save} disabled={busy}
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-xs font-medium whitespace-nowrap">
          {busy ? 'Saving…' : 'Save entity'}
        </button>
      </div>
    </div>
  );
}


export function YourCompaniesSection({ flash }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  // 'loading' → 'ready' | 'failed'. Kept apart from the memberships read.
  const [kyb, setKyb] = useState({ phase: 'loading', byCompany: {}, message: null });
  const [kybAttempt, setKybAttempt] = useState(0);
  const [editing, setEditing] = useState(null); // company id with the editor open

  useEffect(() => {
    let cancelled = false;
    api.listMyCompanies()
      // The endpoint returns a bare array (not {items}), and names the
      // caller's role `my_role` — verified against company.ts, not assumed.
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : (r?.items || [])); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load your companies'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setKyb((k) => (k.phase === 'failed' ? { ...k, phase: 'loading' } : k));
    api.companyKybList()
      .then((r) => {
        if (cancelled) return;
        const byCompany = {};
        for (const it of r?.items || []) byCompany[String(it.company_id)] = it.kyb || null;
        setKyb({ phase: 'ready', byCompany, message: null });
      })
      .catch((e) => { if (!cancelled) setKyb({ phase: 'failed', byCompany: {}, message: e?.message || null }); });
    return () => { cancelled = true; };
  }, [kybAttempt]);

  const companyId = (c) => c.id ?? c.company_id;

  return (
    <Card
      title="Your companies"
      description="Every company this account belongs to, your role in each, and each company's own entity record."
    >
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {!err && rows === null && <p className="text-sm text-gray-500">Loading…</p>}
      {!err && rows && rows.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          You are not a member of any company yet. Create one with New company on this page,
          or ask an owner to add you by this account&apos;s email.
        </p>
      )}
      {!err && rows && rows.length > 0 && (
        <>
          {kyb.phase === 'failed' && (
            <div className="mb-3" data-testid="company-kyb-unreadable">
              <Unreadable what="Each company’s entity record" claim={kyb.message || ''} onRetry={() => setKybAttempt((n) => n + 1)} />
            </div>
          )}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((c) => {
              const id = companyId(c);
              const record = kyb.phase === 'ready' ? (kyb.byCompany[String(id)] ?? null) : undefined;
              const open = editing !== null && String(editing) === String(id);
              return (
                <div key={c.uid || id} className="p-3" data-testid={`company-row-${id}`}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {c.company_name || c.name || 'Unnamed company'}
                        {c.is_primary_admin && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                            Primary admin
                          </span>
                        )}
                      </div>
                      {c.my_role && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{c.my_role}</div>
                      )}
                    </div>
                    {/* The pill: a record, no record, or a read that failed. The
                        last is not "Not started" — that would tell a company in
                        review it never began. */}
                    {record === undefined ? (
                      kyb.phase === 'failed'
                        ? <span className="text-[11px] text-red-700 dark:text-red-300" data-testid="company-kyb-pill">KYB · Unreadable</span>
                        : <span className="text-[11px] text-gray-400" data-testid="company-kyb-pill">KYB · …</span>
                    ) : (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${kybTone(record?.status)}`} data-testid="company-kyb-pill">
                        KYB · {kybStatusLabel(record?.status)}
                      </span>
                    )}
                    <button type="button" onClick={() => setEditing(open ? null : id)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-400 whitespace-nowrap"
                      data-testid={`company-entity-toggle-${id}`}>
                      {open ? 'Close' : 'Entity'}
                    </button>
                    {/* D1140: Manage opens this row's company, not the one active on this device (#2422 item 3). */}
                    <Link
                      to={c.uid ? companyPathFor(c.uid) : '/account/portfolio'}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-400 whitespace-nowrap"
                      data-testid={`company-manage-${id}`}
                    >
                      Manage
                    </Link>
                  </div>
                  {open && (
                    <CompanyEntityEditor
                      company={{ id }}
                      kyb={record || null}
                      flash={flash}
                      onSaved={(k) => setKyb((prev) => ({ ...prev, byCompany: { ...prev.byCompany, [String(id)]: k } }))}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
            To work in a different company, switch it in the sidebar — that is the
            one control that repoints the whole workspace. Each company&apos;s entity is
            separate from your account&apos;s own entity under Profile → Corporate: that one
            is who signs your contracts, these are who the workspaces belong to.
          </p>
        </>
      )}
    </Card>
  );
}
