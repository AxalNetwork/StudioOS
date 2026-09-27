import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Unrecorded, Unreadable } from '../../ui';

/**
 * The firm's partner profile, for Firm Settings (`/company-settings`) — D390.
 *
 * WHY THIS IS A CARD AND NOT A PAGE. `/partner/operations/overview` was the
 * only place a service partner could edit their firm's name, company and
 * specialisation, switch founder introductions on and off, and read their
 * partner agreement. That page retires (D304: only into a canvas-built page
 * that does its whole job), and the Partner Operator Canvas's "Firm Settings"
 * row points at `/company-settings` (shellConfig.js). This card is Overview's
 * whole job, so the retirement can name it as the successor.
 *
 * IT IS NOT THE COMPANY RECORD, AND IT SAYS SO. `/company-settings` edits a
 * `companies` row through the active-company context. This card edits the
 * `partners` row (PATCH /partner-portal/profile) — keyed by the sign-in's
 * `users.partner_id`, not by any company membership — which is how quotes
 * attribute the firm to founders. A partner with no company still has one, so
 * the page mounts this card above its no-company on-ramp. Two stores, one
 * page: the heading and the first sentence name which one this is.
 *
 * MOUNTED BY THE PAGE, NOT BY THIS FILE (D395). CompanySettingsPage.jsx
 * imports this default export and renders it for partner accounts only, above
 * its no-company on-ramp. Nothing here reads the role; the page decides.
 *
 * THREE READS, THREE STATES EACH. The profile, the agreement and the intro
 * toggle each load, fail or answer on their own, so one failure never blanks
 * the others. A sign-in with no firm attached is `e.code === 'no_partner_profile'`
 * (the worker's refusal code, D390) — a fact about the account, drawn as one.
 * Any other failure is Unreadable with a retry. Neither ever prints a zero.
 */

const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const primaryButton = 'inline-flex items-center rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900';
const ghostButton = 'inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300';

export const NO_PARTNER_PROFILE = 'no_partner_profile';

function formatDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A label over a value, where an absent value says it is absent. */
function Fact({ label, value, testid }) {
  const has = value !== null && value !== undefined && String(value).trim() !== '';
  return (
    <div data-testid={testid}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{has ? String(value) : <Unrecorded />}</div>
    </div>
  );
}

/** The account has no firm attached — a fact, not a failure. */
export function NoFirmAttached() {
  return (
    <div data-testid="firm-profile-unlinked" className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
      <p className="font-medium text-gray-800 dark:text-gray-200">No partner profile is attached to this sign-in.</p>
      <p className="mt-1">
        A firm record is created during partner onboarding and linked to the account that finished it.
        If you were invited as a partner, finish onboarding from your invitation link; an admin can
        also attach an existing firm under Partners → Firm links.
      </p>
    </div>
  );
}

function ProfileEditor({ profile, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState({
    name: profile.name || '',
    company: profile.company || '',
    specialization: profile.specialization || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      data-testid="firm-profile-editor"
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Name</span>
        <input className={inputClass} value={form.name} onChange={set('name')} maxLength={120} required />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-400">How your quotes are attributed to founders. It cannot be blank.</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Company</span>
        <input className={inputClass} value={form.company} onChange={set('company')} maxLength={160} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Specialisations</span>
        <input className={inputClass} value={form.specialization} onChange={set('specialization')} maxLength={240} placeholder="Comma-separated, e.g. GTM, RevOps, Pricing" />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-400">A blank company or specialisation is saved as not recorded.</span>
      </label>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className={ghostButton} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * The profile section. `profile` is a load state:
 * `{ status: 'loading' | 'ready' | 'unlinked' | 'unreadable', data?, message? }`.
 */
export function FirmProfileSection({
  profile, editing = false, saving = false, saveError = '', introBusy = false, introError = '',
  onEdit, onSave, onCancel, onToggleIntros, onRetry,
}) {
  if (profile.status === 'loading') {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading the firm profile…</p>;
  }
  if (profile.status === 'unlinked') return <NoFirmAttached />;
  if (profile.status === 'unreadable') {
    return (
      <Unreadable
        what="The firm profile"
        claim="This is not a claim that the firm has no profile."
        onRetry={onRetry}
      />
    );
  }
  const p = profile.data;
  const specialisations = String(p.specialization || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return (
    <div className="space-y-4" data-testid="firm-profile-ready">
      {editing ? (
        <ProfileEditor profile={p} onSave={onSave} onCancel={onCancel} saving={saving} error={saveError} />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <Fact label="Name" value={p.name} testid="firm-name" />
              <Fact label="Company" value={p.company} testid="firm-company" />
              <div data-testid="firm-specialisations">
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Specialisations</div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-sm">
                  {specialisations.length
                    ? specialisations.map((s) => (
                      <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">{s}</span>
                    ))
                    : <Unrecorded />}
                </div>
              </div>
            </div>
            <button type="button" className={ghostButton} onClick={onEdit} data-testid="firm-profile-edit">Edit</button>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-4 dark:border-gray-800">
            <Fact label="Contact email" value={p.email} testid="firm-email" />
            <Fact label="Status" value={p.status} testid="firm-status" />
            <Fact label="Partner since" value={formatDay(p.created_at)} testid="firm-since" />
            <Fact label="Referral code" value={p.referral_code} testid="firm-referral-code" />
            <Fact label="Referrals to date" value={p.referrals_count} testid="firm-referrals" />
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700" data-testid="firm-intros">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Founder introductions</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {p.accepting_intros
              ? 'On — founders can ask to be introduced to your firm from the marketplace and directory.'
              : 'Off — founders cannot ask to be introduced to your firm.'}
          </div>
          {introError && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{introError}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!p.accepting_intros}
          className={ghostButton}
          disabled={introBusy}
          onClick={onToggleIntros}
        >
          {introBusy ? 'Saving…' : p.accepting_intros ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}

/**
 * The partner agreement — READ-ONLY. `deal` is a load state whose `data` is
 * the /partner-portal/my-deal body. No agreement on record is a sentence, not
 * an empty grid; an unreadable read is not a claim that none exists.
 */
export function PartnerAgreementSection({ deal, onRetry }) {
  if (deal.status === 'loading') {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading the partner agreement…</p>;
  }
  if (deal.status === 'unreadable') {
    return (
      <Unreadable
        what="The partner agreement"
        claim="This is not a claim that no agreement exists."
        onRetry={onRetry}
      />
    );
  }
  const d = deal.data?.deal || null;
  if (!d) {
    return (
      <p data-testid="firm-agreement-none" className="text-sm text-gray-600 dark:text-gray-400">
        No partner agreement is on record for this sign-in. Its terms appear here once one is activated.
      </p>
    );
  }
  const redemptions = deal.data?.redemptions_count;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="firm-agreement">
      <Fact label="Agreement" value={d.deal_type ? String(d.deal_type).replace(/_/g, ' ') : null} />
      <Fact label="Status" value={d.status ? String(d.status).replace(/_/g, ' ') : null} />
      <Fact label="Term" value={d.term_months ? `${d.term_months} months` : null} />
      <Fact label="Active since" value={formatDay(d.activated_at)} />
      <Fact label="Founder tier granted" value={d.granted_tier_founder} />
      <Fact label="Investor tier granted" value={d.granted_tier_investor} />
      <Fact label="Referral redemptions" value={redemptions} testid="firm-agreement-redemptions" />
      <Fact label="Ends" value={formatDay(d.expires_at)} />
    </div>
  );
}

/** The whole card as it draws, from states — no requests. */
export function PartnerFirmProfileView(props) {
  const { deal, onRetryDeal } = props;
  return (
    <section
      data-testid="partner-firm-profile-card"
      className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Firm profile</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Your firm&apos;s partner profile — the record your quotes and introductions carry. It is not the
          company record: a firm has this profile whether or not it belongs to a company here.
        </p>
      </div>
      <div className="space-y-6 p-5">
        <FirmProfileSection {...props} />
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Partner agreement</h3>
          <PartnerAgreementSection deal={deal} onRetry={onRetryDeal} />
        </div>
      </div>
    </section>
  );
}

const loading = { status: 'loading' };

export default function PartnerFirmProfileCard() {
  const [profile, setProfile] = useState(loading);
  const [deal, setDeal] = useState(loading);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [introBusy, setIntroBusy] = useState(false);
  const [introError, setIntroError] = useState('');

  const loadProfile = useCallback(async () => {
    setProfile(loading);
    try {
      const r = await api.partnerPortal.getProfile();
      setProfile({ status: 'ready', data: r.partner });
    } catch (e) {
      setProfile(e?.code === NO_PARTNER_PROFILE
        ? { status: 'unlinked' }
        : { status: 'unreadable', message: e?.message });
    }
  }, []);

  const loadDeal = useCallback(async () => {
    setDeal(loading);
    try {
      setDeal({ status: 'ready', data: await api.partnerPortal.myDeal() });
    } catch (e) {
      setDeal({ status: 'unreadable', message: e?.message });
    }
  }, []);

  useEffect(() => { loadProfile(); loadDeal(); }, [loadProfile, loadDeal]);

  const save = async (form) => {
    setSaving(true); setSaveError('');
    try {
      const r = await api.partnerPortal.updateProfile(form);
      setProfile({ status: 'ready', data: r.partner });
      setEditing(false);
    } catch (e) {
      setSaveError(e?.message || 'The profile did not save.');
    }
    setSaving(false);
  };

  const toggleIntros = async () => {
    if (profile.status !== 'ready') return;
    setIntroBusy(true); setIntroError('');
    try {
      const r = await api.partnerPortal.setAcceptingIntros(!profile.data.accepting_intros);
      setProfile((p) => ({ ...p, data: { ...p.data, accepting_intros: !!r.accepting_intros } }));
    } catch (e) {
      if (e?.code === NO_PARTNER_PROFILE) setProfile({ status: 'unlinked' });
      else setIntroError(e?.message || 'Introductions were not changed.');
    }
    setIntroBusy(false);
  };

  return (
    <PartnerFirmProfileView
      profile={profile}
      deal={deal}
      editing={editing}
      saving={saving}
      saveError={saveError}
      introBusy={introBusy}
      introError={introError}
      onEdit={() => { setSaveError(''); setEditing(true); }}
      onCancel={() => setEditing(false)}
      onSave={save}
      onToggleIntros={toggleIntros}
      onRetry={loadProfile}
      onRetryDeal={loadDeal}
    />
  );
}
