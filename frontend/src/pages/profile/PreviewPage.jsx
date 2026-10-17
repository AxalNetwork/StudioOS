/**
 * D702 (#1664) — What others see, `/profile/preview` (board S9m, SMP:154-157),
 * from `GET /api/profile/preview` (decisions 2 and 3). The Worker runs each
 * audience's own reads and reports what they returned; this page draws that
 * and decides nothing. A field no read serves draws no row, a masked one
 * "••••", and Interviews is never a row: no read serves an interview count.
 *
 * `?audience=` stays in the URL, investors by default, and the three tabs are a
 * `role="tablist"`. The notes are the Worker's sentences, one per fact.
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { profileApi } from '../../lib/api/profile';
import { PhoneRows, Unreadable } from '../../ui';
import { useProject } from '../cycles/CycleRoute';
import ProfileFrame, { ProfileCard, ProfileSection, useProfileRead } from './ProfileFrame';
import { AUDIENCES, PROFILE_PAGES, SERVED_TO_LABEL, audienceOf, figureView } from './profileModel';
import { ventureBlocker } from './VenturePage';

/** The segmented control (SMP:26): three tabs, the open one in white. */
export function AudienceTabs({ audience, onChange }) {
  return (
    <div role="tablist" aria-label="Audience" className="mx-[22px] mb-[18px] grid grid-cols-3 gap-1 rounded-xl bg-[#f4f3f7] p-1 dark:bg-gray-900">
      {AUDIENCES.map((a) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          aria-selected={audience === a.id ? 'true' : 'false'}
          onClick={() => onChange(a.id)}
          className={`flex min-h-9 items-center justify-center rounded-[9px] text-[12.5px] font-bold ${audience === a.id
            ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-800 dark:text-violet-300'
            : 'text-[#615c6e] dark:text-gray-400'}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** Copies the full https:// address; says so, or says it could not. */
async function copyText(url) {
  try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
}

/** One public address row: the address without its scheme, whom it is served to, and Copy. */
export function addressRow(kind, addr, copied, onCopy) {
  const what = kind === 'profile' ? 'Your profile' : 'Your venture';
  if (!addr?.url) return { key: kind, title: what, notRecorded: true, notRecordedReason: addr?.reason || 'No public address', description: addr?.reason || null };
  return {
    key: kind,
    title: addr.url.replace(/^https:\/\//, ''),
    description: `${what} · ${SERVED_TO_LABEL[addr.served_to] || addr.served_to}. ${addr.reason}`,
    value: copied === kind ? 'Copied' : copied === `${kind}:failed` ? 'Copy failed' : 'Copy',
    onClick: () => onCopy(kind, addr.url),
    testid: `preview-address-${kind}`,
  };
}

/** The body for one audience's preview. */
export function PreviewView({ read, audience }) {
  const [copied, setCopied] = useState(null);
  if (read.status === 'loading' || read.status === 'idle') {
    return <p className="px-[22px] text-[13px] text-gray-600 dark:text-gray-400">Reading what {audience} see…</p>;
  }
  if (read.status !== 'ready') {
    return <div className="px-[22px]"><Unreadable what="What others see" claim="Nothing about your venture has changed." onRetry={read.reload} /></div>;
  }
  const d = read.data;
  const label = AUDIENCES.find((a) => a.id === audience)?.label.toLowerCase() || audience;
  const heading = d.card?.person_name && d.card?.venture_name
    ? `${d.card.person_name} · Founder of ${d.card.venture_name}`
    : (d.card?.venture_name || d.card?.person_name || 'Nothing is shown');
  const figures = figureView(d.figures).map((f) => (f.notRecorded
    ? { key: f.key, title: f.label, notRecorded: true, notRecordedReason: 'Served, with no value recorded' }
    : { key: f.key, title: f.label, value: f.value }));
  const onCopy = async (kind, url) => setCopied((await copyText(url)) ? kind : `${kind}:failed`);
  return (
    <>
      <ProfileSection title={`As ${label} see you`} testid="preview-card">
        <ProfileCard heading={heading} chips={[d.card?.archetype?.label, d.card?.sector].filter(Boolean)} />
      </ProfileSection>
      <PhoneRows groups={[{
        label: 'Figures', rows: figures, testid: 'preview-figures',
        note: (d.notes || []).length ? <span className="flex flex-col gap-1">{d.notes.map((n) => <span key={n}>{n}</span>)}</span> : null,
      }]} />
      <PhoneRows groups={[{
        label: 'Public addresses', testid: 'preview-addresses',
        rows: [addressRow('profile', d.addresses?.profile, copied, onCopy), addressRow('venture', d.addresses?.venture, copied, onCopy)],
      }]} />
    </>
  );
}

export default function PreviewPage() {
  const [params, setParams] = useSearchParams();
  const audience = audienceOf(params.toString());
  const project = useProject();
  const pid = project.status === 'ready' ? project.projectId : null;
  const read = useProfileRead(() => profileApi.preview(pid, audience), [pid, audience], { enabled: !!pid });
  const blocker = ventureBlocker(project, read);
  const choose = (id) => setParams((old) => { const next = new URLSearchParams(old); next.set('audience', id); return next; }, { replace: true });
  return (
    <ProfileFrame page={PROFILE_PAGES.preview}>
      <AudienceTabs audience={audience} onChange={choose} />
      {blocker
        ? <p className="px-[22px] text-[13.5px] text-gray-700 dark:text-gray-300" role="status" data-testid="preview-blocked">{blocker}</p>
        : <PreviewView read={project.status === 'loading' ? { status: 'loading' } : read} audience={audience} />}
    </ProfileFrame>
  );
}
