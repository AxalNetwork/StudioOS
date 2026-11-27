/**
 * D702 (#1664) — You, `/profile` (board S6m, SMP:133-138): what members read
 * about the founder, from `GET /api/profile/me` (decision 7). The archetype
 * row reads what the archetype card reads (`api.bestFit.me()` through
 * `cardArchetype` and `archetypeLock`), so the two never disagree.
 *
 * Edit opens the editor that owns each part: `/account/profile` for the
 * person, Bio, Background and Links; the co-founder editor for Founder
 * preferences; the archetype card for the archetype. Nothing is copied here.
 */
import React from 'react';
import { api } from '../../lib/api';
import { profileApi } from '../../lib/api/profile';
import { PhoneRows, Unreadable } from '../../ui';
import { archetypeLock, lockedLine } from '../../lib/archetypeLock';
import { cardArchetype } from '../../lib/archetypeCardV2';
import { archetypeMeta } from '../../lib/assessmentMeta';
import { confidencePct } from '../ArchetypeCardPage';
import ProfileFrame, { EditAction, ProfileSection, ProfileText, useProfileRead } from './ProfileFrame';
import { PROFILE_PAGES, initials } from './profileModel';

export const PROFILE_EDITOR = '/account/profile';
export const COFOUNDER_EDITOR = '/build/team?mode=workspace&tab=cofounder';

/** A member-typed link is drawn as a link only when it is an http(s) address; anything else is shown as text. */
export function safeLink(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

const nr = (title, reason, extra = {}) => ({ title, description: reason, notRecorded: true, notRecordedReason: reason, ...extra });

/** The Archetype row: the card's own reading, its lock, or why there is none. */
export function archetypeRow(fit) {
  if (fit.status === 'loading') return { title: 'Reading your archetype…' };
  if (fit.status !== 'ready') return nr('Archetype', 'Your archetype could not be read', { to: '/studio/archetype', chevron: true });
  const lock = archetypeLock(fit.data);
  if (lock) return { title: 'Archetype', description: lockedLine(lock), to: '/studio/archetype', chevron: true, testid: 'you-archetype-locked' };
  const a = cardArchetype(fit.data);
  if (!a) return nr('Archetype', 'Answer a few archetype questions with Eadwyn to reveal it', { to: '/studio/archetype', chevron: true });
  const meta = archetypeMeta(a.slug);
  const pct = confidencePct(a.confidence);
  const line = [meta?.tagline, pct != null ? `${pct}%` : null].filter(Boolean).join(' · ');
  return { title: a.label || meta?.label || a.slug, description: line || null, to: '/studio/archetype', chevron: true, testid: 'you-archetype' };
}

/** The page's body from its two reads; exported so a test can draw each state. */
export function YouView({ me, fit }) {
  if (me.status === 'loading') return <p className="px-[22px] text-[13px] text-gray-600 dark:text-gray-400">Loading your profile…</p>;
  if (me.status !== 'ready') {
    return <div className="px-[22px]"><Unreadable what="Your profile" claim="Nothing on it has changed." onRetry={me.reload} /></div>;
  }
  const d = me.data;
  const edit = (to, testid) => <EditAction to={to} testid={testid} />;
  const bg = [
    ...(d.background?.experience || []).map((e) => ({ title: e.line, description: e.period || null })),
    ...(d.background?.education || []).map((e) => ({ title: e.line, description: e.year || null })),
  ];
  const p = d.preferences || {};
  const prefs = p.recorded
    ? [
        p.looking_for ? { title: 'Looking for a co-founder', value: p.looking_for } : nr('Looking for a co-founder', 'Not set yet'),
        p.commitment_label ? { title: 'Commitment', value: p.commitment_label } : nr('Commitment', 'Not set yet'),
        p.location ? { title: 'Location', value: p.location } : nr('Location', 'Not set yet'),
      ]
    : [nr('Founder preferences', p.reason || 'No co-founder profile yet')];
  return (
    <>
      <ProfileSection testid="you-person">
        <div className="flex items-center gap-3 rounded-[14px] border border-[#ececf1] p-3.5 dark:border-gray-800">
          <span className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full border border-[#ddd0fb] bg-[#f4f0fe] text-[15px] font-extrabold text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300" aria-hidden="true">
            {initials(d.person?.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-extrabold tracking-[-.015em] text-gray-900 dark:text-gray-100">{d.person?.name || 'Your name is not set'}</div>
            <div className="mt-0.5 text-[12.5px] text-[#615c6e] dark:text-gray-400" data-testid="you-role-line">{d.person?.role_line || 'Founder'}</div>
          </div>
          {edit(PROFILE_EDITOR, 'you-edit-person')}
        </div>
      </ProfileSection>
      <ProfileSection title="Bio" action={edit(PROFILE_EDITOR, 'you-edit-bio')} testid="you-bio">
        <ProfileText text={d.bio} empty="No bio yet" />
      </ProfileSection>
      <PhoneRows groups={[{ label: 'Background', action: edit(PROFILE_EDITOR, 'you-edit-background'), rows: bg, testid: 'you-background',
        note: bg.length ? null : 'No background added yet.' }]} />
      <PhoneRows groups={[{ label: 'Links', action: edit(PROFILE_EDITOR, 'you-edit-links'), testid: 'you-links',
        rows: (d.links || []).map((l) => (l.url
          ? { key: l.key, title: l.label, description: l.url.replace(/^https?:\/\//, ''), href: safeLink(l.url) || undefined }
          : nr(l.label, 'No link added yet', { key: l.key }))) }]} />
      <PhoneRows groups={[{ label: 'Founder preferences', action: edit(COFOUNDER_EDITOR, 'you-edit-preferences'), rows: prefs, testid: 'you-preferences' }]} />
      <PhoneRows groups={[{ label: 'Archetype', rows: [archetypeRow(fit)], testid: 'you-archetype-section' }]} />
    </>
  );
}

export default function YouPage() {
  const me = useProfileRead(() => profileApi.me());
  const fit = useProfileRead(() => api.bestFit.me());
  return (
    <ProfileFrame page={PROFILE_PAGES.you}>
      <YouView me={me} fit={fit} />
    </ProfileFrame>
  );
}
