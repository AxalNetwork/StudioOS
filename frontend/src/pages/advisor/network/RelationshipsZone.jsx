import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import {
  NothingYet, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  ghostButtonClass, inputClass,
} from '../expertise/kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';

/**
 * Network · Relationships — the book, and the referrals beside it.
 *
 * TWO STORES, DELIBERATELY NOT JOINED. The canvas draws referral state on the
 * relationship card itself ("4 referrals in motion" on a row). That join does
 * not exist and cannot be faked: `referral_submissions` (migration 175) records
 * `referred_name` and `referred_org` as FREE TEXT and carries no referred-user
 * id — verified against the migration and every later ALTER. Matching a
 * referral to a relationship would mean matching on a typed name, which is
 * wrong often enough that the row would occasionally attribute one person's
 * referral to another. So the count is real and ships; the per-row chip does
 * not exist, and the page says why.
 *
 * WHAT IS ABSENT RATHER THAN BLANK. The zone's own intro promises "what you
 * last actually did together, and how recently". `partner_relationships`
 * (created at `routes/partnernet.ts:59`) has no `last_interaction_at`, no
 * interaction count and no event type beyond `created`/`updated`. There is no
 * "Last touch" column here and no "going cold" count, because both would be
 * invented. A missing column is honest; a column full of em-dashes is not.
 */

// The worker's own vocabulary (`routes/partnernet.ts` REL_TYPES) — a PATCH
// carrying anything else is rejected, so the picker offers exactly these.
const REL_TYPES = [
  ['advisor_founder', 'Advisor · founder'],
  ['advisor_mentee', 'Advisor · mentee'],
  ['co_investor', 'Co-investor'],
  ['operator_partner', 'Operator partner'],
  ['strategic_alliance', 'Strategic alliance'],
];
const REL_TYPE_LABEL = Object.fromEntries(REL_TYPES);

/** Statuses where the referrer is still waiting on someone. */
const IN_MOTION = new Set([
  'submitted', 'under_review', 'more_info_needed', 'qualified',
  'in_conversation', 'converted', 'reward_eligible',
]);

function RelationshipRow({ row, onSaved }) {
  const [type, setType] = useState(row.relationship_type || '');
  const [strength, setStrength] = useState(String(row.strength_score ?? ''));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const dirty = type !== (row.relationship_type || '')
    || String(row.strength_score ?? '') !== strength;

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const body = {};
      if (type && type !== row.relationship_type) body.relationship_type = type;
      const n = Number(strength);
      if (Number.isFinite(n) && String(row.strength_score ?? '') !== strength) {
        body.strength_score = Math.max(0, Math.min(100, n));
      }
      await api.updateRelationship(row.id, body);
      setNote({ ok: true, text: 'Saved.' });
      onSaved?.();
    } catch (e) {
      setNote({ ok: false, text: e?.message || 'Could not save this change.' });
    } finally {
      setBusy(false);
    }
  };

  const person = row.other?.name || row.other?.email;

  return (
    <Card padding="md" className="mt-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold tracking-tight">
            {person || <Unrecorded>Name not recorded</Unrecorded>}
          </div>
          <div className="mt-0.5 text-[11.5px] text-axal-ink-3">
            {row.other?.name && row.other?.email ? row.other.email : null}
          </div>
        </div>
        <Pill tone="neutral">{REL_TYPE_LABEL[row.relationship_type] || row.relationship_type || 'Untyped'}</Pill>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Type</span>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Untyped</option>
            {REL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            Strength (0–100)
          </span>
          <input className={inputClass} type="number" min="0" max="100" value={strength}
            onChange={(e) => setStrength(e.target.value)} />
        </label>
        <button type="button" className={ghostButtonClass} disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <SaveNote note={note} />
    </Card>
  );
}

function ReferralRow({ row }) {
  return (
    <Card padding="md" className="mt-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold tracking-tight">{row.referred_name}</div>
          <div className="mt-0.5 text-[11.5px] text-axal-ink-3">
            {row.referred_org || <Unrecorded>No organisation recorded</Unrecorded>}
          </div>
        </div>
        <Pill tone={IN_MOTION.has(row.status) ? 'ok' : 'neutral'}>{row.status_label || row.status}</Pill>
      </div>
      {(row.next_step || row.reward_label) && (
        <div className="mt-2 space-y-1 text-[12px] leading-relaxed text-axal-ink-2">
          {row.next_step && <p><span className="font-semibold">Next: </span>{row.next_step}</p>}
          {row.reward_label && <p><span className="font-semibold">Reward: </span>{row.reward_label}</p>}
        </div>
      )}
    </Card>
  );
}

export default function RelationshipsZone() {
  const [state, setState] = useState({ loading: true, error: null, rows: [], referrals: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Read them together but fail them apart: a referral outage must not make
      // the relationship book claim to be empty, and the reverse.
      const [rel, ref] = await Promise.allSettled([
        api.partnerRelationships(),
        api.referralSubmissions(),
      ]);
      if (rel.status === 'rejected') throw rel.reason;
      setState({
        loading: false,
        error: null,
        rows: Array.isArray(rel.value) ? rel.value : [],
        referrals: ref.status === 'fulfilled' && Array.isArray(ref.value) ? ref.value : null,
      });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The relationship book did not load.', rows: [], referrals: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const inMotion = useMemo(
    () => (state.referrals || []).filter((r) => IN_MOTION.has(r.status)).length,
    [state.referrals],
  );

  return (
    <div className="space-y-6">
      <section>
        <ZoneHeading
          title="Relationship book"
          blurb="Links between StudioOS accounts, strongest first. Both sides see the row."
        />
        <ZoneBody
          actions={advisorZoneActions('network/relationships', { view: { header: ['Person', 'Email', 'Type', 'Status', 'Referred by', 'Referred org', 'Next step'], rows: state.rows, cells: (r) => [r.other?.name, r.other?.email, r.relationship_type, r.status, r.referred_name, r.referred_org, r.next_step] } })}
          loading={state.loading}
          error={state.error}
          isEmpty={!state.rows.length}
          onRetry={load}
          empty={(
            <NothingYet
              title="No relationships are recorded against your account"
              body={
                'This store only holds links between two StudioOS accounts, and it has no person '
                + 'picker — the only way to add a row today is to type another user’s internal id, '
                + 'and doing so puts a row with a strength score into their book without asking them. '
                + 'Adding from here waits on a picker and a consent step; neither exists yet.'
              }
            />
          )}
        >
          {state.rows.map((r) => <RelationshipRow key={r.id} row={r} onSaved={load} />)}
        </ZoneBody>
        <StatedLimit title="No last touch, and therefore no “going cold”">
          The store records what a relationship is and how strong you rated it — not when you last
          spoke. There is no interaction date, no interaction count, and the only history it keeps is
          that the row was created and edited. The column is absent rather than empty because an
          empty one would read as “you have not spoken”, which is not something this page can know.
        </StatedLimit>
      </section>

      <section>
        <ZoneHeading
          title="Referrals you have made"
          blurb={
            state.referrals == null
              ? 'The referral pipeline did not load.'
              : `${state.referrals.length} submitted · ${inMotion} still in motion`
          }
          action={<Link to="/referrals" className="text-[12px] text-emerald-700 underline">Make a referral →</Link>}
        />
        {state.referrals == null ? (
          <Card variant="dashed" padding="lg">
            <h3 className="text-sm font-extrabold tracking-tight">The referral pipeline did not load</h3>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-ink-2">
              The relationship book above read fine; this one did not. No count is shown rather than
              a zero, because a zero here would say you have referred nobody.
            </p>
          </Card>
        ) : state.referrals.length === 0 ? (
          <NothingYet
            title="You have not submitted a referral"
            body="Referrals are tracked with a status and a reward label, and the status is what the counts above read."
          />
        ) : (
          state.referrals.map((r) => <ReferralRow key={r.uid} row={r} />)
        )}
        <StatedLimit title="Why a referral is not shown on a relationship row">
          A referral records the person’s name and organisation as text you typed — there is no link
          from it to a StudioOS account. Attaching one to a row above would mean matching on that
          typed name, which would sooner or later credit the wrong person. The counts are real; the
          per-row attribution is not, so it is not drawn.
        </StatedLimit>
      </section>
    </div>
  );
}
