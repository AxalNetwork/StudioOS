/**
 * D702 (#1664) — Visibility, `/profile/visibility` (board S10m, SMP:159-161):
 * "Changes apply at once." Every control writes on change, needs no Save,
 * rolls back on a refusal and says why.
 *
 *   · Profile visibility: one `fieldset` of radios over `PUT
 *     /settings/privacy`'s `visibility`. They show the visibility the profile
 *     is SERVED with (the route's effective value), so a member who never
 *     chose sees Public, with the line that says so (decision 5).
 *   · Directory and matching: four `role="switch"` buttons (decision 6).
 *     Show me in the directory is `show_in_directory`; Appear in co-founder
 *     matching is `matching_opt_in`, which also governs member introductions
 *     and best-fit matches and keeps its completeness gate; Let investors find
 *     my venture is the venture's `investor_findable` (on until the founder
 *     chooses, decision 4); Show my archetype to members is
 *     `/profile/archetype-published`, reworded because no profile page shows
 *     the archetype and D602's member matches do.
 *
 * The rows are controls, not links, so this page draws its two sections
 * itself, in `PhoneRows`' section and row metrics.
 */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { profileApi } from '../../lib/api/profile';
import { Unreadable } from '../../ui';
import { useProject } from '../cycles/CycleRoute';
import ProfileFrame, { useProfileRead } from './ProfileFrame';
import { NOT_CHOSEN_LINE, PROFILE_PAGES, VISIBILITY_OPTIONS } from './profileModel';
import { NO_VENTURE } from './VenturePage';

export const MATCHING_SUB = 'Also member introductions and best-fit matches';
export const FINDABLE_SUB = 'Through introductions only';

const TITLE = 'text-[10px] font-extrabold uppercase tracking-wide text-gray-700 dark:text-gray-300';
const ROW = 'flex min-h-[56px] w-full items-center gap-3 border-b border-[#f0eff3] py-[9px] text-left dark:border-gray-800';

/** A toggle row: the switch, its sub, and the line that says why it failed or is disabled. */
export function SwitchRow({ id, title, sub, on, disabled = false, busy = false, why = null, error = null, onChange }) {
  return (
    <div className={ROW} data-testid={`visibility-${id}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-gray-900 dark:text-gray-100" id={`visibility-${id}-label`}>{title}</div>
        {sub && <div className="mt-0.5 text-[12px] text-[#615c6e] dark:text-gray-400">{sub}</div>}
        {why && <div className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-300">{why}</div>}
        {error && <div role="alert" className="mt-0.5 text-[12px] font-semibold text-red-700 dark:text-red-300">{error}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on ? 'true' : 'false'}
        aria-labelledby={`visibility-${id}-label`}
        aria-busy={busy ? 'true' : undefined}
        disabled={disabled || busy}
        onClick={() => onChange(!on)}
        className={`relative h-6 w-10 flex-none rounded-full disabled:opacity-50 ${on ? 'bg-violet-600' : 'bg-[#d4d1dc] dark:bg-gray-600'}`}
      >
        <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white ${on ? 'right-[3px]' : 'left-[3px]'}`} />
      </button>
    </div>
  );
}

/**
 * The page's two sections. `privacy` is `GET /settings/privacy` (with the
 * venture when there is one) and `published` `GET /profile/archetype-published`;
 * `write(key, value)` makes the one write a control needs and resolves to the
 * route's reply, or throws its refusal.
 */
export function VisibilityView({ privacy, published, hasVenture, write }) {
  const [pending, setPending] = useState({});
  const [errors, setErrors] = useState({});
  if (privacy.status === 'loading' || privacy.status === 'idle') {
    return <p className="px-[22px] text-[13px] text-gray-600 dark:text-gray-400">Loading your visibility…</p>;
  }
  if (privacy.status !== 'ready') {
    return <div className="px-[22px]"><Unreadable what="Your visibility" claim="Nothing about who can see you has changed." onRetry={privacy.reload} /></div>;
  }
  const p = privacy.data;
  const valueOf = (key, fallback) => (key in pending ? pending[key] : fallback);
  const change = async (key, value) => {
    setPending((x) => ({ ...x, [key]: value }));
    setErrors((x) => ({ ...x, [key]: null }));
    try {
      await write(key, value);
    } catch (e) {
      const why = e?.data?.errors?.[key];
      setErrors((x) => ({ ...x, [key]: why ? `${e.message} ${why}` : (e?.message || 'That change was not saved. Try again.') }));
    } finally {
      setPending((x) => { const n = { ...x }; delete n[key]; return n; });
    }
  };
  const visibility = valueOf('visibility', p.visibility);
  const matching = valueOf('matching_opt_in', !!p.matching_opt_in);
  const matchingBlocked = !p.matching_eligible && !matching;
  const pub = published.status === 'ready' ? valueOf('archetype_published', published.data?.published === true) : null;
  return (
    <>
      <section className="px-[22px] pb-[18px]" data-testid="visibility-profile">
        <fieldset>
          <legend className={`${TITLE} mb-2`}>Profile visibility</legend>
          <div className="border-t border-[#f0eff3] dark:border-gray-800">
            {VISIBILITY_OPTIONS.map((o) => (
              <label key={o.value} className={`${ROW} cursor-pointer`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-gray-900 dark:text-gray-100">{o.label}</span>
                  <span className="block text-[12px] text-[#615c6e] dark:text-gray-400">{o.sub}</span>
                </span>
                <input
                  type="radio"
                  name="profile-visibility"
                  value={o.value}
                  checked={visibility === o.value}
                  disabled={'visibility' in pending}
                  onChange={() => change('visibility', o.value)}
                  className="h-5 w-5 accent-violet-600"
                />
              </label>
            ))}
          </div>
        </fieldset>
        {!p.visibility_chosen && <p className="mt-2 text-[12px] text-[#615c6e] dark:text-gray-400" data-testid="visibility-not-chosen">{NOT_CHOSEN_LINE}</p>}
        {errors.visibility && <p role="alert" className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300">{errors.visibility}</p>}
      </section>
      <section className="px-[22px] pb-[18px]" data-testid="visibility-directory">
        <h2 className={`${TITLE} mb-2`}>Directory and matching</h2>
        <div className="border-t border-[#f0eff3] dark:border-gray-800">
          <SwitchRow id="directory" title="Show me in the directory" on={valueOf('show_in_directory', !!p.show_in_directory)}
            busy={'show_in_directory' in pending} error={errors.show_in_directory} onChange={(v) => change('show_in_directory', v)} />
          <SwitchRow id="matching" title="Appear in co-founder matching" sub={MATCHING_SUB} on={matching}
            busy={'matching_opt_in' in pending} disabled={matchingBlocked} error={errors.matching_opt_in}
            why={matchingBlocked ? `Complete at least ${p.matching_min_pct ?? 60}% of your profile to turn this on${typeof p.profile_completion_pct === 'number' ? ` (currently ${p.profile_completion_pct}%).` : '.'}` : null}
            onChange={(v) => change('matching_opt_in', v)} />
          <SwitchRow id="findable" title="Let investors find my venture" sub={FINDABLE_SUB}
            on={hasVenture ? valueOf('investor_findable', p.investor_findable !== false) : false}
            disabled={!hasVenture} why={hasVenture ? null : NO_VENTURE}
            busy={'investor_findable' in pending} error={errors.investor_findable} onChange={(v) => change('investor_findable', v)} />
          {published.status === 'ready'
            ? <SwitchRow id="archetype" title="Show my archetype to members" on={pub} busy={'archetype_published' in pending}
                error={errors.archetype_published} onChange={(v) => change('archetype_published', v)} />
            : (
              <div className={ROW} data-testid="visibility-archetype">
                <div className="min-w-0 flex-1 text-[14px] font-semibold text-gray-900 dark:text-gray-100">Show my archetype to members</div>
                {published.status === 'loading'
                  ? <span className="text-[12px] text-gray-600 dark:text-gray-400">Loading…</span>
                  : <Unreadable what="Whether yours is published" claim="" onRetry={published.reload} />}
              </div>
            )}
        </div>
      </section>
    </>
  );
}

export default function VisibilityPage() {
  const project = useProject();
  const pid = project.status === 'ready' ? project.projectId : null;
  const privacy = useProfileRead(() => profileApi.privacy(pid), [pid], { enabled: project.status !== 'loading' });
  const published = useProfileRead(() => api.archetypePublished());
  const write = async (key, value) => {
    if (key === 'archetype_published') {
      const r = await api.setArchetypePublished(value);
      published.set(r);
      return r;
    }
    const r = await profileApi.setPrivacy(pid, { [key]: value });
    privacy.set(r);
    return r;
  };
  return (
    <ProfileFrame page={PROFILE_PAGES.visibility}>
      <VisibilityView privacy={privacy} published={published} hasVenture={!!pid} write={write} />
    </ProfileFrame>
  );
}
