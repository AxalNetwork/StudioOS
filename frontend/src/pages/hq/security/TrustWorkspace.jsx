import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import { reportError } from '../../../lib/log';
import { trustCenterAdminApi } from '../../../lib/api/trustContent.js';
import StatusBadge from './StatusBadge.jsx';
import TrustPublishDialog from './TrustActions.jsx';
import {
  KYC_HREF, OBLIGATIONS_HREF, TRUST_CONTENT_HREF, kycBlock, noticesBlock, publishingBlock, sanctionsBlock,
} from './trustModel.js';

/**
 * D4803 (#4803, canvas SE07a) — "Screening, obligations and what the public
 * Trust Center says."
 *
 *   sanctions    on request, per entity; unreviewed hits lead; its own store
 *   KYC          a separate store and a separate block, with a link to the
 *                review queue
 *   publishing   the published revision, how many blocks differ, Review
 *                changes… (`TrustActions.jsx`, Scope → Review → Result with
 *                the per-block diff) and the editor for the change history
 *   notices      subscribers, and per notice what the sweep recorded
 *                (queued, sending, sent, failed); mail not configured says so
 *   obligations  linked, not duplicated
 *   explanation  the previous zones, behind "How this is measured"
 *
 * The Trust Center read is this workspace's own (`trustCenterAdminApi.read`,
 * the editor's read), so it fails on its own and never blanks sanctions.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 text-[12.5px] font-bold sm:min-h-[34px]';
const BTN_PLAIN = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const BTN_PRIMARY = `${BTN} border-violet-700 bg-violet-700 text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-700`;
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline dark:text-violet-300';

function Block({ id, title, state, label, testid, children }) {
  return (
    <section aria-labelledby={id} className={`${CARD} flex flex-col gap-3`} data-testid={testid} data-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">{title}</h3>
        {state !== 'pending' && <StatusBadge state={state} label={label} />}
      </div>
      {children}
    </section>
  );
}

const Facts = ({ rows }) => (
  <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[140px_minmax(0,1fr)]">
    {rows.map(([k, v]) => (
      <React.Fragment key={k}>
        <dt className="font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
        <dd className="min-w-0 break-words text-axal-ink dark:text-gray-100">{v}</dd>
      </React.Fragment>
    ))}
  </dl>
);
const Reading = () => <p className="text-[12px] text-axal-faint dark:text-gray-400">Reading…</p>;
const Unread = ({ reason }) => <p className="text-[12px] text-axal-muted dark:text-gray-300">{reason} This is not a zero.</p>;

export default function TrustWorkspace({ overview, unreadable, onRetry, api = trustCenterAdminApi, children }) {
  const [read, setRead] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const opener = useRef(null);
  const load = useCallback(() => {
    setRead(null);
    api.read().then(setRead, (e) => {
      reportError('security-trust', e);
      setRead({ unreadable: true, reason: 'The Trust Center content could not be read.' });
    });
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const s = sanctionsBlock(overview ? overview.sanctions : null);
  const k = kycBlock(overview);
  const p = publishingBlock(read);
  const n = noticesBlock(read);

  return (
    <div className="flex flex-col gap-4" data-testid="trust-workspace">
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-white">Trust</h2>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-300">Screening, obligations and what the public Trust Center says.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {unreadable ? (
          <div className="lg:col-span-2">
            <Unreadable what="Sanctions and KYC" claim="This is not a claim that there are no hits or no one awaiting review." onRetry={onRetry} />
          </div>
        ) : (
          <>
            <Block id="trust-sanctions-h" title="Sanctions screening" state={s.state} label={s.label} testid="trust-sanctions">
              {s.state === 'pending' && <Reading />}
              {s.state === 'unavailable' && <Unread reason={s.reason} />}
              {s.facts.length > 0 && <Facts rows={s.facts} />}
              {s.href && <a href={s.href} className={LINK}>Screening history →</a>}
            </Block>
            <Block id="trust-kyc-h" title="KYC" state={k.state} label={k.label} testid="trust-kyc">
              {k.state === 'pending' && <Reading />}
              {k.state === 'unavailable' && <Unread reason={k.reason} />}
              {k.rows.length > 0 && <Facts rows={k.rows.map(([a, b]) => [a, String(b)])} />}
              <p className="text-[12px] text-axal-muted dark:text-gray-300">Identity checks are a separate process from sanctions, read from a separate store.</p>
              <Link to={KYC_HREF} className={LINK}>Open the KYC queue →</Link>
            </Block>
          </>
        )}

        <Block id="trust-publish-h" title="Trust Center publishing" state={p.state} label={p.label} testid="trust-publishing">
          {p.state === 'pending' && <Reading />}
          {p.state === 'unavailable' && <Unreadable what="The Trust Center content" claim="This is not a claim that nothing is waiting to publish." onRetry={load} />}
          {p.published && <Facts rows={[['Published', p.published], ['Draft', p.draft]]} />}
          {p.published && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" ref={opener} onClick={() => setPublishing(true)} disabled={!p.canReview} className={BTN_PRIMARY} data-testid="trust-review">Review changes…</button>
              <Link to={TRUST_CONTENT_HREF} className={LINK}>Edit drafts and change history →</Link>
            </div>
          )}
        </Block>

        <Block id="trust-notices-h" title="Subprocessor notices" state={n.state} label={n.state === 'measured_zero' ? 'No notices in 90 days' : undefined} testid="trust-notices">
          {n.state === 'pending' && <Reading />}
          {n.subscribers && <Facts rows={[['Subscribers', n.subscribers]]} />}
          {n.state === 'unavailable' && <Unread reason={n.reason} />}
          {n.mailConfigured === false && (
            <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-200" data-testid="trust-mail-off">
              Mail is not configured on this Worker, so no notice is sent until it is.
            </p>
          )}
          {n.rows.length > 0 && (
            <ul className="flex flex-col gap-2" data-testid="trust-notice-rows">
              {n.rows.map((r) => (
                <li key={r.uid} className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <b className="min-w-0 break-words">{r.name} · {r.started ? 'started' : 'starts'} {r.starts}</b>
                    <StatusBadge state={r.state} label={r.word} />
                  </span>
                  <small className="text-axal-muted dark:text-gray-300">{r.counts.map(([a, b]) => `${a} ${b}`).join(' · ')}</small>
                </li>
              ))}
            </ul>
          )}
          {n.rows.length > 0 && <p className="text-[11.5px] text-axal-faint dark:text-gray-400">Sent means the mail provider accepted it. Whether it reached an inbox is not recorded.</p>}
        </Block>

        <section aria-labelledby="trust-obligations-h" className={`${CARD} flex flex-col gap-2 lg:col-span-2`} data-testid="trust-obligations">
          <h3 id="trust-obligations-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Trust obligations</h3>
          <p className="text-[12px] text-axal-muted dark:text-gray-300">Owned commitments with evidence and review dates live on the obligations page; nothing here duplicates them.</p>
          <Link to={OBLIGATIONS_HREF} className={`${BTN_PLAIN} self-start`}>Open obligations →</Link>
        </section>
      </div>

      {publishing && read && !read.unreadable && (
        <TrustPublishDialog
          read={read}
          api={api}
          returnFocus={opener.current}
          onClose={() => setPublishing(false)}
          onPublished={load}
          onReread={load}
        />
      )}

      {children && (
        <details className={`${CARD} text-[12px]`} data-testid="trust-how">
          <summary className="cursor-pointer font-semibold text-axal-ink dark:text-gray-100">How this is measured</summary>
          <div className="mt-3">{children}</div>
        </details>
      )}
    </div>
  );
}
