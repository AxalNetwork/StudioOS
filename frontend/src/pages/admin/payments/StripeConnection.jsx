import React, { useState } from 'react';
import { Columns } from '../../../ui/Charts';
import {
  DELIVERIES_UNREAD, DIALOGS_WAIT, STRIPE_UNREAD, WEBHOOK_UNREAD,
  deliveryColumns, deliveryTable, keysMatch, modeWord, silentHoursText, stampText,
} from './payModel';
import {
  AMBER, BIG, CARD, EYE, GHOST, H2, MONO, PILL, SUB, Reading, Unread, usePayPhone,
} from './payUi';

/**
 * D1008 / D1014 (#2833) — PAY5, Stripe connection, complete: the account, the
 * publishable key with its mismatch, the webhook with the events the platform
 * acts on, deliveries per hour with the hour that has no log, and the
 * catalogue mirror. Each block answers from its own read, alone.
 *
 * The three buttons open part 5's dialogs (#2832). Until they exist each is
 * drawn, disabled, with the sentence saying where the work is done today
 * (D1014 §2): a button that opened nothing would be a lie, and hiding it would
 * hide the canvas.
 */

export function keysLine(k) {
  if (k.state === 'match') return 'Keys match';
  if (k.state === 'differ') return `Keys differ: the publishable key is ${modeWord(k.key)}`;
  if (k.state === 'nokey') return 'No publishable key set';
  if (k.state === 'unknownkey') return 'The publishable key is in no known mode';
  if (k.state === 'noaccount') return 'No secret key at deploy';
  return 'The key\'s mode was not checked';
}

/** A part-5 button: drawn, disabled, and saying why. */
function Waits({ children, testId }) {
  return (
    <span className="flex flex-col gap-1">
      <button type="button" className={`${GHOST} self-start`} disabled aria-describedby={`${testId}-why`} data-testid={testId}>{children}</button>
      <span id={`${testId}-why`} className={SUB}>{DIALOGS_WAIT}</span>
    </span>
  );
}

const LEGEND = [
  ['Accepted', 'bg-axal-violet dark:bg-[#a78bfa]', ''],
  ['Not accepted', 'bg-[#f59e0b]', ''],
  ['No log', 'border border-dashed border-axal-muted dark:border-gray-400', ''],
];

const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : null);
/** The day's totals; a count the read did not carry is "not recorded", never 0. */
export function totalsText(d) {
  const n = count(d?.deliveries);
  const bad = count(d?.not_2xx);
  return `${n ?? 'Not recorded'} deliveries · ${bad ?? 'not recorded'} not accepted`;
}

/** Deliveries per hour (PAY5): the chart on a computer, the table on a phone or on request. */
function Deliveries({ deliveries, summary, reload }) {
  const phone = usePayPhone();
  const [view, setView] = useState('chart');
  const [all, setAll] = useState(false);
  const d = deliveries?.data;
  const asTable = phone || view === 'table';
  const hook = summary?.data?.webhook;
  const last = d?.last ?? (hook?.available ? hook.last : null);
  const silent = d ? silentHoursText(d.hours) : null;
  const table = d ? deliveryTable(d.hours) : [];
  const shown = all ? table : table.slice(0, 6);
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-8`} aria-labelledby="pay-h-deliveries" data-testid="pay-deliveries">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pay-h-deliveries" className={H2}>Deliveries, last 24 hours</h2>
        {deliveries?.status === 'ready' && !phone && (
          <div className="flex gap-1" role="radiogroup" aria-label="Show as" data-testid="pay-deliveries-view">
            {[['chart', 'Chart'], ['table', 'Table']].map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)}
                className={`min-h-[30px] rounded-full border px-3 text-[12px] font-semibold ${view === k ? 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-700 dark:bg-violet-900/40 dark:text-gray-100' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>{label}</button>
            ))}
          </div>
        )}
      </div>
      {deliveries?.status === 'loading' && <Reading />}
      {deliveries?.status === 'error' && <Unread text={DELIVERIES_UNREAD} onRetry={reload} testId="pay-deliveries-unread" />}
      {deliveries?.status === 'ready' && (
        <>
          <span className={SUB} data-testid="pay-deliveries-totals">{totalsText(d)}</span>
          {asTable ? (
            <div data-testid="pay-deliveries-table">
              <table className="w-full border-collapse text-[12.5px]">
                <caption className="sr-only">Webhook deliveries per hour, newest first</caption>
                <thead>
                  <tr className={EYE}>
                    <th scope="col" className="py-1.5 pr-3 text-left font-bold">Hour (UTC)</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-bold">Accepted</th>
                    <th scope="col" className="py-1.5 text-right font-bold">Not accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-700" data-testid="pay-deliveries-row">
                      <td className={`py-1.5 pr-3 ${MONO} text-axal-ink dark:text-gray-100`}>{r.hour}</td>
                      <td className={`py-1.5 pr-3 text-right ${MONO} ${r.logged ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{r.accepted}</td>
                      <td className={`py-1.5 text-right ${MONO} ${r.logged ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{r.refused}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {table.length > 6 && (
                <button type="button" className="mt-1 text-[12px] font-bold text-axal-violet dark:text-violet-300" onClick={() => setAll((v) => !v)} data-testid="pay-deliveries-all">
                  {all ? 'Show the newest 6' : `Showing 6 of ${table.length} hours, newest first · Show all`}
                </button>
              )}
            </div>
          ) : (
            <div role="img" aria-label={`Webhook deliveries per hour over the last 24 hours. ${silent || 'Every hour was logged.'}`} data-testid="pay-deliveries-chart">
              <Columns rows={deliveryColumns(d.hours)} height={180} />
              <ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-[11.5px] text-axal-muted dark:text-gray-400" aria-hidden="true">
                {LEGEND.map(([t, sw]) => <li key={t} className="flex items-center gap-1.5"><span className={`inline-block h-2.5 w-2.5 rounded-[2px] ${sw}`} />{t}</li>)}
              </ul>
            </div>
          )}
          <span className={`${MONO} text-[12.5px] text-axal-ink dark:text-gray-100`} data-testid="pay-deliveries-last">{last ? `Last delivery: ${stampText(last.at) || last.at} · ${last.status_code ?? 'no status'} · ${last.latency_ms ?? '—'} ms` : 'No delivery logged yet.'}</span>
          <span className={SUB}>Read from the request log: the time this platform took, not Stripe&apos;s round trip.{silent ? ` ${silent}` : ''}</span>
        </>
      )}
    </section>
  );
}

export default function StripeConnection({ reads, reload }) {
  const { config, summary, webhook, deliveries } = reads;
  const k = keysMatch(config?.data, summary?.data);
  const mirror = summary?.data?.catalog;
  const endpoints = webhook?.data?.endpoints || [];
  const ours = endpoints.filter((e) => e.is_ours);
  return (
    <div className="grid grid-cols-12 gap-3.5">
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pay-account">
        <h2 className={H2}>Account</h2>
        {config?.status === 'loading' && <Reading />}
        {config?.status === 'error' && <Unread text={STRIPE_UNREAD} onRetry={reload} testId="pay-account-unread" />}
        {config?.status === 'ready' && (
          <>
            <span className={BIG}>{modeWord(config.data?.mode)}</span>
            <span className={SUB}>{config.data?.mode === 'unconfigured' ? 'Stripe is not connected on this platform yet. HQ adds the account\'s keys at deploy.' : 'Payments go to HQ\'s Stripe account. The mode is read from the secret key, which this page never shows.'}</span>
          </>
        )}
      </section>
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pay-key">
        <h2 className={H2}>Publishable key</h2>
        {config?.status === 'loading' && <Reading />}
        {config?.status === 'error' && <Unread text={STRIPE_UNREAD} onRetry={reload} testId="pay-key-unread" />}
        {config?.status === 'ready' && (
          <>
            <span className={`${MONO} text-[14px] text-axal-ink dark:text-gray-100`}>{config.data?.configured ? config.data?.publishable_key : 'Not set'}</span>
            <span className={k.state === 'differ' ? AMBER : SUB} data-testid="pay-key-match">{k.state === 'differ' ? `The publishable key is ${modeWord(k.key)}, the account is ${modeWord(k.account)}. Checkout and token packs will fail until they match.` : keysLine(k)}</span>
            <Waits testId="pay-key-replace">Replace key…</Waits>
          </>
        )}
      </section>

      <section className={`${CARD} col-span-12 flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pay-h-webhook" data-testid="pay-webhook">
        <h2 id="pay-h-webhook" className={H2}>Webhook</h2>
        {webhook?.status === 'loading' && <Reading />}
        {webhook?.status === 'error' && <Unread text={WEBHOOK_UNREAD} onRetry={reload} testId="pay-webhook-unread" />}
        {webhook?.status === 'ready' && (
          <>
            <span className={SUB}>Stripe sends events to this platform at this address.</span>
            <span className={`${MONO} break-all text-[12.5px] text-axal-ink dark:text-gray-100`}>{webhook.data?.our_url}</span>
            {endpoints.length === 0 && <span className={AMBER}>Stripe has no webhook endpoint yet.</span>}
            {ours.length === 0 && <Waits testId="pay-webhook-register">Register a new endpoint…</Waits>}
            {endpoints.map((e) => (
              <div key={e.id} className={`rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700 ${e.is_ours ? '' : 'opacity-70'}`} data-testid={`pay-endpoint-${e.is_ours ? 'ours' : 'other'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`${MONO} break-all text-[12px] text-axal-ink dark:text-gray-100`}>{e.url}</span>
                  <span className={PILL}>{e.status === 'enabled' ? 'Enabled' : e.status === 'disabled' ? 'Disabled' : 'Not recorded'}</span>
                  {e.is_ours ? <span className={PILL}>This platform&apos;s endpoint</span> : <span className={SUB}>Not used by this platform.</span>}
                </div>
                {e.is_ours && (
                  <>
                    <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
                      {(webhook.data?.required_events || []).map((ev) => {
                        const miss = (e.missing_events || []).includes(ev);
                        return <li key={ev} className={`text-[12px] ${miss ? 'text-axal-amber-deep dark:text-amber-200' : 'text-axal-ink dark:text-gray-100'}`}><span aria-hidden="true">{miss ? '✕' : '✓'}</span> <span className={`${MONO} break-all`}>{ev}</span>{miss ? ' — missing' : ''}</li>;
                      })}
                    </ul>
                    {(e.missing_events || []).length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        <span className={SUB}>{e.missing_events.length} missing.</span>
                        <Waits testId={`pay-webhook-add-${e.id}`}>Add the missing events</Waits>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </section>

      <Deliveries deliveries={deliveries} summary={summary} reload={reload} />
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-4`} data-testid="pay-mirror">
        <h2 className={H2}>Catalogue mirror</h2>
        {summary?.status === 'loading' && <Reading />}
        {summary?.status === 'error' && <Unread text="Could not be read. The mirror was not checked." onRetry={reload} testId="pay-mirror-unread" />}
        {summary?.status === 'ready' && (mirror?.available ? (
          <>
            <span className={`${MONO} text-[12.5px] text-axal-ink dark:text-gray-100`}>{mirror.products.active} active of {mirror.products.all} products · {mirror.prices.active} active of {mirror.prices.all} prices</span>
            <span className={SUB}>Last written {stampText(mirror.last_written_at) || 'never'}.</span>
            <span className={SUB}>{mirror.sync_basis}</span>
          </>
        ) : <span className={SUB}>Not recorded: {mirror?.reason}</span>)}
      </section>
    </div>
  );
}
