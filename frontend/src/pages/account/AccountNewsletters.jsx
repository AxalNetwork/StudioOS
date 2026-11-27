import { useState } from 'react';
import { newsletterApi } from '../../lib/api/newsletter';
import { reportError } from '../../lib/log';
import { EmptyState, Pill, Unreadable } from '../../ui';
import { LoadingRows, Outcome, PanelCard, Switch, useAccountRead } from './AccountCenter';
import { memberGroups, memberSaveError, sentToLine } from '../site/newsletterModel';

/**
 * D813 (#2259), board D1 — Account › Notifications › Newsletters.
 *
 * The member's topics from D810's `GET /api/me/newsletters`, as switches:
 * the website's six, then the ones the member's role adds (the partner letter
 * for an investor or LP, testing calls). Each switch saves on its own with
 * `PUT /api/me/newsletters` and redraws from the answer, so the card always
 * shows what the Worker holds. A refused switch goes back and says why.
 *
 * It replaces the old weekly-insights toggle on the Insights page: D810 keeps
 * that store in step with the `insights` topic.
 */
function TopicRow({ topic, busy, onToggle, role }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5 max-sm:min-h-[44px]" data-testid={`member-nl-${topic.key}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
          {topic.label}
          {role && <Pill tone="neutral">For your role</Pill>}
        </div>
        {topic.description && <p className="mt-0.5 text-[12px] leading-snug text-axal-muted dark:text-gray-400">{topic.description}</p>}
      </div>
      <Switch checked={topic.enabled} disabled={busy} label={topic.label} onChange={(on) => onToggle(topic.key, on)}
        data-testid={`member-nl-switch-${topic.key}`} />
    </li>
  );
}

/** The card, given its read. Separate from the loader so a test can draw every state. */
export function NewslettersCard({ read, busyKey, outcome, onToggle }) {
  const groups = read.status === 'ready' ? memberGroups(read.data) : { general: [], role: [] };
  const empty = read.status === 'ready' && !groups.general.length && !groups.role.length;
  const line = read.status === 'ready' ? sentToLine(read.data?.email) : '';
  return (
    <PanelCard title="Newsletters" data-testid="card-newsletters" footer={line || null}>
      {read.status === 'loading' ? <LoadingRows lines={3} />
        : read.status === 'unreadable' ? (
          <Unreadable what="Your newsletters" claim="This is not a claim that you receive none." onRetry={read.reload} />
        ) : empty ? (
          <EmptyState size="sm" data-testid="member-nl-empty" title="No newsletter is offered on your account yet." />
        ) : (
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
            {groups.general.map((t) => <TopicRow key={t.key} topic={t} busy={busyKey !== null} onToggle={onToggle} />)}
            {groups.role.map((t) => <TopicRow key={t.key} topic={t} busy={busyKey !== null} onToggle={onToggle} role />)}
          </ul>
        )}
      <div className="mt-2"><Outcome outcome={outcome} /></div>
    </PanelCard>
  );
}

export default function AccountNewsletters() {
  const read = useAccountRead(() => newsletterApi.mine());
  const [busyKey, setBusyKey] = useState(null);
  const [outcome, setOutcome] = useState(null);

  async function toggle(key, on) {
    setBusyKey(key);
    setOutcome(null);
    try {
      const r = await newsletterApi.saveMine({ [key]: on });
      read.set(r);
      setOutcome({ tone: 'ok', text: 'Saved.' });
    } catch (e) {
      reportError('account_newsletters_save_failed', e);
      setOutcome({ tone: 'error', text: memberSaveError(e) });
    } finally { setBusyKey(null); }
  }

  return <NewslettersCard read={read} busyKey={busyKey} outcome={outcome} onToggle={toggle} />;
}
