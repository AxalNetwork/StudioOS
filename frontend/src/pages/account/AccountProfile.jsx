import PersonaFollowUpCheck from './PersonaFollowUpCheck';
import { useEffect, useState } from 'react';
import { normalizePhoneInput, phonePlaceholder, PHONE_ERROR } from '../../lib/phoneNumber';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Pill, Skeleton, Unrecorded, Unreadable } from '../../ui';
import { BTN, INPUT, FieldRow, LoadingRows, Outcome, PanelCard, Switch, useAccountRead } from './AccountCenter';
import {
  LOCALES, changedFields, countryLabel, dayLabel, fieldErrorsFrom, historyLines,
  latestArchetype, localeLabel, locationLabel, phoneLabel, splitPersonalPatch,
} from './accountCenterModel';

/**
 * D568 — Profile and identity: the canvas's `ac_profile` block.
 *
 * Account cards over five stores, each read on its own so one failure costs one
 * card: Personal details (the account name, the identity route's username and
 * language, the details route's phone and location), Identity (legal name,
 * date of birth and nationality from the identity route, tax residence from
 * the details route), Address and tax ID (the personal profile route),
 * Public archetype (the newest profile snapshot and its publish consent), and
 * Change history (the profile snapshots, with "Ask me again").
 *
 * No company or signing entity here (owner, 2026-10-28): both are Companies
 * and projects', and verification is Trust Center's. The profile editors below
 * these cards (LinkedIn import, profile, background, extras, jurisdictions,
 * role preferences) have no sub-tabs. They edit some neighbouring fields, so
 * the two sides keep each other current: a save here calls `onSaved` (the page
 * remounts the editors below, which re-read) and announces
 * `axal:profile_saved`; a save below announces the same event, and these cards
 * re-read on it.
 */

export const PROFILE_SAVED_EVENT = 'axal:profile_saved';

function announceSaved() {
  try { window.dispatchEvent(new CustomEvent(PROFILE_SAVED_EVENT)); } catch { /* no window to tell */ }
}

/** A field's value in its three states: still reading, unreadable, or what the store holds. */
function Value({ read, value, missing, testid }) {
  if (read?.status === 'loading') return <Skeleton h={12} w="55%" className="mt-1" />;
  if (read?.status === 'unreadable') return <span data-testid={testid} className="text-red-700 dark:text-red-300">Unreadable</span>;
  if (value === null || value === undefined || String(value).trim() === '') {
    return <span data-testid={testid}><Unrecorded reason={missing}>Not recorded</Unrecorded></span>;
  }
  return <span data-testid={testid}>{value}</span>;
}

/**
 * The edit cycle every editable card shares: open with a draft, save only what
 * changed, and keep the form open on the route's refusal with each error on
 * its own field.
 */
function useEditor() {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  return {
    editing, draft, errors, busy, outcome,
    begin(initial) { setDraft(initial); setErrors({}); setOutcome(null); setEditing(true); },
    cancel() { setEditing(false); setErrors({}); },
    field(key) {
      return { value: draft[key] ?? '', onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value })) };
    },
    upper(key) {
      return { value: draft[key] ?? '', onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value.toUpperCase().slice(0, 2) })) };
    },
    async commit(patch, save) {
      if (!Object.keys(patch).length) { setEditing(false); setOutcome({ tone: 'ok', text: 'Nothing changed.' }); return; }
      setBusy(true);
      setOutcome(null);
      let errs;
      try { errs = (await save(patch)) || {}; } catch (e) { errs = fieldErrorsFrom(e); }
      setBusy(false);
      const { _form, ...byField } = errs;
      if (!_form && !Object.keys(byField).length) {
        setEditing(false);
        setErrors({});
        setOutcome({ tone: 'ok', text: 'Saved.' });
        return;
      }
      setErrors(byField);
      setOutcome({ tone: 'error', text: _form || 'Some fields were not saved. Each one says why.' });
    },
  };
}

function EditActions({ ed, onSave }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
      <button type="button" className={BTN.ghost} onClick={ed.cancel} disabled={ed.busy}>Cancel</button>
      <button type="button" className={BTN.primary} onClick={onSave} disabled={ed.busy} data-testid="button-profile-save">
        {ed.busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function EditButton({ onClick, disabled, title, testid }) {
  return (
    <button type="button" className={BTN.link} onClick={onClick} disabled={disabled} title={title} data-testid={testid}>Edit</button>
  );
}

const PERSONAL_KEYS = ['name', 'profile_slug', 'locale', 'phone_e164', 'city', 'country'];

/** Personal details: the account name, username, email, phone, location and language. */
export function PersonalDetailsCard({ account, identity, details, onSave }) {
  const ed = useEditor();
  const ready = identity.status === 'ready' && details.status === 'ready';
  const id = identity.data || {};
  const det = details.data || {};
  const current = { name: account?.name || '', profile_slug: id.profile_slug || '', locale: id.locale || '', phone_e164: '', city: det.city || '', country: det.country || '' };
  const shownAs = String(id.display_name || '').trim();
  const locales = LOCALES.some(([k]) => k === ed.draft.locale) || !ed.draft.locale ? LOCALES : [[ed.draft.locale, ed.draft.locale], ...LOCALES];
  const normalizedPhone = normalizePhoneInput(ed.draft.phone_e164, ed.draft.country ?? det.country);
  const save = async (patch) => {
    if (patch.phone_e164) {
      const parsed = normalizePhoneInput(patch.phone_e164, ed.draft.country ?? det.country);
      if (!parsed) return { phone_e164: PHONE_ERROR };
      patch = { ...patch, phone_e164: parsed.e164 };
    }
    return onSave(patch);
  };
  return (
    <PanelCard
      title="Personal details"
      data-testid="card-personal-details"
      action={!ed.editing && (
        <EditButton
          onClick={() => ed.begin(current)}
          disabled={!ready}
          title={ready ? undefined : 'Editing opens once your details are read.'}
          testid="button-edit-personal"
        />
      )}
    >
      {ed.editing ? (
        <div>
          <FieldRow label="Full name" htmlFor="ac-name" control error={ed.errors.name}>
            <input id="ac-name" className={INPUT} maxLength={120} {...ed.field('name')} />
          </FieldRow>
          <FieldRow label="Username" htmlFor="ac-username" control error={ed.errors.profile_slug}
            hint="3 to 32 lowercase letters, numbers or hyphens. Saved on your account; your public profile link (/u/…) does not use it yet.">
            <input id="ac-username" className={INPUT} maxLength={32} {...ed.field('profile_slug')} placeholder="jane-doe" />
          </FieldRow>
          <FieldRow label="Email" hint="Change it under Email, further down this page: a change is confirmed from both addresses.">
            {account?.email || <Unrecorded>Not recorded</Unrecorded>}
          </FieldRow>
          <FieldRow label="Phone" htmlFor="ac-phone" control error={ed.errors.phone_e164}
            hint={det.has_phone ? 'A number is saved. Type a new one to replace it, or leave this empty to keep it.' : 'Your mobile number, any country.'}>
            <input id="ac-phone" className={`${INPUT} font-mono`} inputMode="tel" {...ed.field('phone_e164')} placeholder={det.has_phone ? phoneLabel(det) : phonePlaceholder(ed.draft.country ?? det.country)} />
            {normalizedPhone && <p className="text-xs text-gray-500" role="status">We'll save {normalizedPhone.international}.</p>}
          </FieldRow>
          <FieldRow label="City" htmlFor="ac-city" control error={ed.errors.city}>
            <input id="ac-city" className={INPUT} maxLength={100} {...ed.field('city')} />
          </FieldRow>
          <FieldRow label="Country" htmlFor="ac-country" control error={ed.errors.country || ed.errors.postal_code} hint="Two-letter code, e.g. CH.">
            <input id="ac-country" className={`${INPUT} w-20 font-mono uppercase`} {...ed.upper('country')} placeholder="CH" />
          </FieldRow>
          <FieldRow label="Language" htmlFor="ac-locale" control error={ed.errors.locale}>
            <select id="ac-locale" className={INPUT} {...ed.field('locale')}>
              <option value="">Not set</option>
              {locales.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FieldRow>
          <Outcome outcome={ed.outcome} />
          <EditActions ed={ed} onSave={() => ed.commit(changedFields(current, ed.draft, PERSONAL_KEYS), save)} />
        </div>
      ) : (
        <div>
          <FieldRow label="Full name" hint={shownAs && shownAs !== account?.name ? `Other members see “${shownAs}”, your profile's display name.` : null}>
            <Value value={account?.name} missing="no name is set on this account" testid="value-full-name" />
          </FieldRow>
          <FieldRow label="Username">
            <Value read={identity} value={id.profile_slug} missing="no username has been chosen" testid="value-username" />
          </FieldRow>
          <FieldRow label="Email">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Value value={account?.email} missing="no email is on this account" testid="value-email" />
              {account?.email && <Pill tone={account.email_verified ? 'ok' : 'warn'}>{account.email_verified ? 'Verified' : 'Unverified'}</Pill>}
            </span>
          </FieldRow>
          <FieldRow label="Phone">
            <Value read={details} value={phoneLabel(det)} missing="no phone number is saved" testid="value-phone" />
          </FieldRow>
          <FieldRow label="Location">
            <Value read={details} value={locationLabel(det)} missing="no city or country is saved" testid="value-location" />
          </FieldRow>
          <FieldRow label="Language">
            <Value read={identity} value={localeLabel(id.locale) || id.locale} missing="no language is set" testid="value-language" />
          </FieldRow>
          <Outcome outcome={ed.outcome} />
          {identity.status === 'unreadable' && <Unreadable what="Your username and language" claim={identity.message || 'This is not a claim that none is set.'} onRetry={identity.reload} />}
          {details.status === 'unreadable' && <Unreadable what="Your phone and location" claim={details.message || 'This is not a claim that none is saved.'} onRetry={details.reload} />}
        </div>
      )}
    </PanelCard>
  );
}

const IDENTITY_KEYS = ['full_legal_name', 'date_of_birth', 'nationality', 'tax_residency_country'];

/** Identity: the legal-name block Trust Center reads. */
export function IdentityCard({ identity, details, onSave }) {
  const ed = useEditor();
  const ready = identity.status === 'ready' && details.status === 'ready';
  const id = identity.data || {};
  const det = details.data || {};
  const current = {
    full_legal_name: id.full_legal_name || '',
    date_of_birth: id.date_of_birth || '',
    nationality: id.nationality || '',
    tax_residency_country: det.tax_residency_country || '',
  };
  return (
    <PanelCard
      title="Identity"
      aside="Used by Trust Center"
      data-testid="card-identity"
      action={!ed.editing && (
        <EditButton onClick={() => ed.begin(current)} disabled={!ready} title={ready ? undefined : 'Editing opens once your identity is read.'} testid="button-edit-identity" />
      )}
    >
      {ed.editing ? (
        <div>
          <FieldRow label="Legal name" htmlFor="ac-legal" control error={ed.errors.full_legal_name}>
            <input id="ac-legal" className={INPUT} maxLength={200} {...ed.field('full_legal_name')} />
          </FieldRow>
          <FieldRow label="Date of birth" htmlFor="ac-dob" control error={ed.errors.date_of_birth} hint="You must be 18 or older.">
            <input id="ac-dob" type="date" className={INPUT} {...ed.field('date_of_birth')} />
          </FieldRow>
          <FieldRow label="Nationality" htmlFor="ac-nat" control error={ed.errors.nationality} hint="Two-letter code, e.g. CH.">
            <input id="ac-nat" className={`${INPUT} w-20 font-mono uppercase`} {...ed.upper('nationality')} />
          </FieldRow>
          <FieldRow label="Tax residence" htmlFor="ac-taxres" control error={ed.errors.tax_residency_country} hint="Two-letter code.">
            <input id="ac-taxres" className={`${INPUT} w-20 font-mono uppercase`} {...ed.upper('tax_residency_country')} />
          </FieldRow>
          <Outcome outcome={ed.outcome} />
          <EditActions ed={ed} onSave={() => ed.commit(changedFields(current, ed.draft, IDENTITY_KEYS), onSave)} />
        </div>
      ) : (
        <div>
          <FieldRow label="Legal name"><Value read={identity} value={id.full_legal_name} missing="no legal name is saved" testid="value-legal-name" /></FieldRow>
          <FieldRow label="Date of birth"><Value read={identity} value={dayLabel(id.date_of_birth)} missing="no date of birth is saved" testid="value-dob" /></FieldRow>
          <FieldRow label="Nationality"><Value read={identity} value={countryLabel(id.nationality)} missing="no nationality is saved" testid="value-nationality" /></FieldRow>
          <FieldRow label="Tax residence"><Value read={details} value={countryLabel(det.tax_residency_country)} missing="no tax residence is saved" testid="value-tax-residence" /></FieldRow>
          <Outcome outcome={ed.outcome} />
          {identity.status === 'unreadable' && <Unreadable what="Your identity" claim={identity.message || 'This is not a claim that it is empty.'} onRetry={identity.reload} />}
          {details.status === 'unreadable' && <Unreadable what="Your tax residence" claim={details.message || 'This is not a claim that none is saved.'} onRetry={details.reload} />}
        </div>
      )}
    </PanelCard>
  );
}

const ADDRESS_KEYS = ['address_line1', 'address_line2', 'state_or_region', 'postal_code'];

/** One line for the saved address: street lines, then city, region, postal code and country. */
function addressLine(p) {
  const parts = [p.address_line1, p.address_line2, p.city, p.state_or_region, p.postal_code, countryLabel(p.country)]
    .map((v) => String(v ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Address and tax ID: the contract fields the other cards don't hold. The
 * personal profile route stores them, as it stores Identity's; city and
 * country are edited in Personal details, so this card shows them and does
 * not edit them twice. The tax ID is encrypted at rest: the route serves its
 * last four digits only, and an empty box keeps the saved one.
 */
export function AddressTaxCard({ personal, onSave }) {
  const ed = useEditor();
  const p = personal.data || {};
  const current = {
    address_line1: p.address_line1 || '',
    address_line2: p.address_line2 || '',
    state_or_region: p.state_or_region || '',
    postal_code: p.postal_code || '',
    tax_id_number: '',
  };
  const taxLabel = p.has_tax_id ? `•••• ${p.tax_id_last4 || '••••'}` : null;
  const save = (patch) => {
    const out = { ...patch };
    if (!String(out.tax_id_number ?? '').trim()) delete out.tax_id_number;
    return onSave(out);
  };
  return (
    <PanelCard
      title="Address and tax ID"
      aside="Used for contracts"
      data-testid="card-address-tax"
      action={!ed.editing && (
        <EditButton onClick={() => ed.begin(current)} disabled={personal.status !== 'ready'}
          title={personal.status === 'ready' ? undefined : 'Editing opens once your address is read.'} testid="button-edit-address" />
      )}
    >
      {personal.status === 'loading' ? <LoadingRows lines={2} />
        : personal.status === 'unreadable' ? (
          <Unreadable what="Your address and tax ID" claim={personal.message || 'This is not a claim that none is saved.'} onRetry={personal.reload} />
        ) : ed.editing ? (
          <div>
            <FieldRow label="Address line 1" htmlFor="ac-addr1" control error={ed.errors.address_line1}>
              <input id="ac-addr1" className={INPUT} maxLength={200} {...ed.field('address_line1')} />
            </FieldRow>
            <FieldRow label="Address line 2" htmlFor="ac-addr2" control error={ed.errors.address_line2}>
              <input id="ac-addr2" className={INPUT} maxLength={200} {...ed.field('address_line2')} />
            </FieldRow>
            <FieldRow label="State or region" htmlFor="ac-region" control error={ed.errors.state_or_region}>
              <input id="ac-region" className={INPUT} maxLength={100} {...ed.field('state_or_region')} />
            </FieldRow>
            <FieldRow label="Postal code" htmlFor="ac-postal" control error={ed.errors.postal_code} hint="City and country are in Personal details.">
              <input id="ac-postal" className={`${INPUT} w-32 font-mono`} maxLength={20} {...ed.field('postal_code')} />
            </FieldRow>
            <FieldRow label="Tax ID" htmlFor="ac-taxid" control error={ed.errors.tax_id_number}
              hint={p.has_tax_id ? 'One is saved. Type a new one to replace it, or leave this empty to keep it.' : 'Encrypted at rest.'}>
              <input id="ac-taxid" className={`${INPUT} font-mono`} maxLength={64} autoComplete="off" {...ed.field('tax_id_number')} placeholder={taxLabel || ''} />
            </FieldRow>
            <Outcome outcome={ed.outcome} />
            <EditActions ed={ed} onSave={() => ed.commit(changedFields(current, ed.draft, [...ADDRESS_KEYS, 'tax_id_number']), save)} />
          </div>
        ) : (
          <div>
            <FieldRow label="Address"><Value read={personal} value={addressLine(p)} missing="no address is saved" testid="value-address" /></FieldRow>
            <FieldRow label="Tax ID"><Value read={personal} value={taxLabel} missing="no tax ID is saved" testid="value-tax-id" /></FieldRow>
            <Outcome outcome={ed.outcome} />
          </div>
        )}
    </PanelCard>
  );
}

/** Public archetype: the archetype your profile shows, and whether other members may see it. */
export function PublicArchetypeCard({ role, history, published, onToggle }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const arch = history.status === 'ready' ? latestArchetype(history.data?.items, role) : null;
  const on = published.status === 'ready' && published.data?.published === true;
  const toggle = async (next) => {
    setBusy(true);
    setOutcome(null);
    try {
      await onToggle(next);
      setOutcome({ tone: 'ok', text: next ? 'Published on your profile.' : 'Taken off your profile.' });
    } catch (e) {
      setOutcome({ tone: 'error', text: e?.message || 'Your choice was not saved.' });
    } finally { setBusy(false); }
  };
  return (
    <PanelCard title="Public archetype" data-testid="card-public-archetype">
      {history.status === 'loading' ? <LoadingRows lines={2} />
        : history.status === 'unreadable' ? (
          <Unreadable what="Your profile" claim={history.message || 'This is not a claim that you have no archetype.'} onRetry={history.reload} />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {arch ? (
                <div className="text-[13.5px] font-semibold text-axal-ink dark:text-gray-100" data-testid="value-archetype">
                  {arch.label}{' '}
                  {arch.confidencePct !== null && (
                    <span className="font-mono text-[11.5px] font-medium text-axal-violet-deep dark:text-violet-300" title="How sure the profile is of this archetype">{arch.confidencePct}%</span>
                  )}
                </div>
              ) : (
                <div className="text-[13px]" data-testid="value-archetype">
                  <Unrecorded reason="no archetype has been scored from your answers yet">Not recorded</Unrecorded>
                  <span className="text-axal-muted dark:text-gray-400"> · no archetype has been scored from your answers yet. <Link to="/studio" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Answer the profiling questions in Studio</Link></span>
                </div>
              )}
              <div className="mt-0.5 text-xs text-axal-muted dark:text-gray-400" data-testid="value-archetype-published">
                {published.status === 'ready' ? (on ? 'Published on my profile' : 'Not shown on my profile') : published.status === 'loading' ? 'Reading your choice…' : null}
              </div>
            </div>
            {published.status === 'ready' && (
              <Switch checked={on} onChange={toggle} disabled={busy} label="Publish my archetype on my profile" data-testid="switch-archetype-published" />
            )}
          </div>
        )}
      {published.status === 'unreadable' && (
        <Unreadable what="Whether your archetype is published" claim={published.message || 'This is not a claim that it is hidden.'} onRetry={published.reload} />
      )}
      <Outcome outcome={outcome} />
    </PanelCard>
  );
}

const HISTORY_SHOWN = 8;

/** Change history: one line per profile snapshot, and "Ask me again". */
export function ChangeHistoryCard({ history, fetchReask = () => api.profileReask() }) {
  const [all, setAll] = useState(false);
  const [reask, setReask] = useState({ status: 'idle', data: null, message: '' });
  const lines = history.status === 'ready' ? historyLines(history.data?.items) : [];
  const shown = all ? lines : lines.slice(0, HISTORY_SHOWN);
  const ask = async () => {
    setReask({ status: 'loading', data: null, message: '' });
    try { setReask({ status: 'ready', data: await fetchReask(), message: '' }); }
    catch (e) { setReask({ status: 'unreadable', data: null, message: e?.message || '' }); }
  };
  const due = reask.data;
  return (
    <PanelCard
      title="Change history"
      data-testid="card-change-history"
      action={<button type="button" className={BTN.ghost} onClick={ask} disabled={reask.status === 'loading'} data-testid="button-ask-again">{reask.status === 'loading' ? 'Reading…' : 'Ask me again'}</button>}
      footer="“Ask me again” lists the answers old enough to be asked again. Studio asks them; nothing changes from here."
    >
      {reask.status === 'ready' && due && (
        <div className="mb-3 rounded-axal-sm bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-ink dark:bg-violet-900/20 dark:text-gray-100" data-testid="reask-result">
          {Number(due.count) > 0 ? (
            <>
              <p>
                {due.count} of your answers {Number(due.count) === 1 ? 'is' : 'are'} due to be asked again
                {Number.isFinite(Number(due.reask_after_days)) ? ` (answered more than ${due.reask_after_days} days ago)` : ''}. Studio asks {Number(due.count) === 1 ? 'it' : 'them'} next.
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-axal-muted dark:text-gray-300">
                {(Array.isArray(due.items) ? due.items : []).slice(0, 3).map((q) => <li key={q.question_id}>{q.prompt}</li>)}
              </ul>
              <Link to="/studio" className="mt-1.5 inline-block font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Answer them in Studio</Link>
            </>
          ) : (
            <p>None of your answers is old enough to ask again{Number.isFinite(Number(due.reask_after_days)) ? `; an answer comes back after ${due.reask_after_days} days` : ''}.</p>
          )}
        </div>
      )}
      {reask.status === 'unreadable' && (
        <div className="mb-3"><Unreadable what="Which answers are due again" claim={reask.message || 'This is not a claim that none is due.'} onRetry={ask} /></div>
      )}
      {history.status === 'loading' ? <LoadingRows lines={3} />
        : history.status === 'unreadable' ? (
          <Unreadable what="Your profile history" claim={history.message || 'This is not a claim that nothing changed.'} onRetry={history.reload} />
        ) : lines.length === 0 ? (
          <p className="py-1 text-[13px] text-axal-muted dark:text-gray-400" data-testid="history-empty">No change to your profile has been recorded yet.</p>
        ) : (
          <>
            <ol className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="history-lines">
              {shown.map((l) => (
                <li key={l.id} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2.5 py-2 text-[13px]">
                  <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{dayLabel(l.when) || <Unrecorded>No date</Unrecorded>}</span>
                  <span className="text-axal-ink dark:text-gray-100">{l.what}</span>
                </li>
              ))}
            </ol>
            {lines.length > HISTORY_SHOWN && (
              <button type="button" className={`${BTN.link} mt-1`} onClick={() => setAll((v) => !v)}>
                {all ? 'Show fewer' : `Show all ${lines.length}`}
              </button>
            )}
          </>
        )}
    </PanelCard>
  );
}

/**
 * The section's container: five reads, four writers, and the archetype's
 * publish consent. `data` is the root settings payload the page already holds
 * (name, email, role); `onAccountChange` merges a name change back into it.
 */
export default function ProfileIdentityCanvas({ data, onAccountChange, onSaved }) {
  const identity = useAccountRead(() => api.getIdentitySettings());
  const details = useAccountRead(() => api.getProfileDetails());
  const personal = useAccountRead(() => api.getPersonalProfile());
  const history = useAccountRead(() => api.profileHistory());
  const published = useAccountRead(() => api.archetypePublished());
  const { reload: reloadIdentity } = identity;
  const { reload: reloadDetails } = details;
  const { reload: reloadPersonal } = personal;

  // A save in the editors below this block re-reads what these cards show.
  useEffect(() => {
    const reread = () => { reloadIdentity(); reloadDetails(); reloadPersonal(); };
    window.addEventListener(PROFILE_SAVED_EVENT, reread);
    return () => window.removeEventListener(PROFILE_SAVED_EVENT, reread);
  }, [reloadIdentity, reloadDetails, reloadPersonal]);

  const wrote = () => { onSaved?.(); announceSaved(); };

  const savePersonal = async (patch) => {
    const parts = splitPersonalPatch(patch);
    const errors = {};
    let any = false;
    if (Object.keys(parts.account).length) {
      try { await api.updateSettings(parts.account); onAccountChange?.(parts.account); any = true; }
      catch (e) { errors.name = e?.message || 'Your name was not saved.'; }
    }
    if (Object.keys(parts.identity).length) {
      try { identity.set(await api.updateIdentitySettings(parts.identity)); any = true; }
      catch (e) { Object.assign(errors, fieldErrorsFrom(e)); }
    }
    if (Object.keys(parts.details).length) {
      try { details.set(await api.updateProfileDetails(parts.details)); any = true; }
      catch (e) { Object.assign(errors, fieldErrorsFrom(e)); }
    }
    if (any) wrote();
    return errors;
  };

  const saveIdentity = async (patch) => {
    const { tax_residency_country: taxRes, ...idPatch } = patch;
    const errors = {};
    let any = false;
    if (Object.keys(idPatch).length) {
      try { identity.set(await api.updateIdentitySettings(idPatch)); any = true; }
      catch (e) { Object.assign(errors, fieldErrorsFrom(e)); }
    }
    if (taxRes !== undefined) {
      try { details.set(await api.updateProfileDetails({ tax_residency_country: taxRes })); any = true; }
      catch (e) { Object.assign(errors, fieldErrorsFrom(e)); }
    }
    if (any) wrote();
    return errors;
  };

  const saveAddress = async (patch) => {
    try {
      personal.set(await api.updatePersonalProfile(patch));
      wrote();
      return {};
    } catch (e) {
      return fieldErrorsFrom(e);
    }
  };

  const togglePublished = async (next) => {
    const res = await api.setArchetypePublished(next);
    published.set({ published: res?.published === true });
  };

  return (
    <div className="@container space-y-3" data-testid="account-profile-canvas">
      <PersonaFollowUpCheck />
      <div className="grid items-start gap-3 @2xl:grid-cols-2">
        <div className="space-y-3">
          <PersonalDetailsCard account={data} identity={identity} details={details} onSave={savePersonal} />
          <AddressTaxCard personal={personal} onSave={saveAddress} />
        </div>
        <div className="space-y-3">
          <IdentityCard identity={identity} details={details} onSave={saveIdentity} />
          <PublicArchetypeCard role={data?.role} history={history} published={published} onToggle={togglePublished} />
        </div>
      </div>
      <ChangeHistoryCard history={history} />
    </div>
  );
}
