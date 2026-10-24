import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import {
  FIRM_LINKS_NOTE, LIST_CLAIM, dataOf, firmChangeCopy, firmCounts, firmSavedLine, refusalText,
} from './partnersDeskModel';
import { AMBER, CARD, Done, INPUT, ReadState, Refusal, SUB, TD, TH } from './parts';

/**
 * D923 (#2370) — Firm links, off the canvas, at its own address until #2369's
 * Firms tab takes it (part 9). Attaching a partner sign-in to the firm record
 * it belongs to: every partner surface resolves the caller through
 * `users.partner_id` and nothing else (D57). The admin names the account and
 * the firm; nothing is matched for them.
 *
 * A change now asks before it saves (#2370's small fix): the select opens a
 * confirm, and the save's result is a line on the page, never a toast. Counts
 * are of the first 500 accounts at the cap.
 */
export default function FirmLinks({ reads }) {
  const [onlyUnattached, setOnlyUnattached] = useState(true);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [saved, setSaved] = useState(null);
  const data = dataOf(reads.links);
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  const firms = Array.isArray(data?.firms) ? data.firms : [];
  const rows = onlyUnattached ? accounts.filter((a) => a?.partner_id === null || a?.partner_id === undefined) : accounts;
  const counts = data ? firmCounts(data) : null;
  const firmById = (id) => firms.find((f) => String(f.id) === String(id)) || null;

  const ask = (account, value) => {
    setRefusal(null);
    setPending({ account, firm: value === '' ? null : firmById(value), current: account.partner_id ? firmById(account.partner_id) || { name: account.firm_company || account.firm_name } : null });
  };
  const close = () => { if (!busy) { setPending(null); setRefusal(null); } };
  const save = async () => {
    setBusy(true); setRefusal(null);
    try {
      const reply = await api.adminPartners.setFirmLink(pending.account.id, pending.firm ? Number(pending.firm.id) : null);
      setSaved(firmSavedLine(reply));
      setPending(null);
      reads.reload();
    } catch (e) {
      setRefusal(refusalText(e, 'firm'));
    } finally {
      setBusy(false);
    }
  };
  const copy = pending ? firmChangeCopy(pending.account, pending.firm, pending.current) : null;

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Firm links" data-testid="partners-firm-links">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">Firm links</h2>
        <label className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
          <input type="checkbox" checked={onlyUnattached} onChange={(e) => setOnlyUnattached(e.target.checked)} data-testid="partners-firm-only" />
          Only accounts with no firm
        </label>
      </div>
      <p className={`m-0 max-w-3xl ${SUB}`}>{FIRM_LINKS_NOTE}</p>
      {saved ? <Done testId="partners-firm-saved"><span>{saved}</span></Done> : null}
      <ReadState read={reads.links} what="The partner accounts" claim={LIST_CLAIM} onRetry={reads.reload} testId="partners-firm-read" />
      {counts ? (
        <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="partners-firm-counts">
          {counts.text}
          {counts.cover ? <span className={`ml-2 ${AMBER}`}>{counts.cover}</span> : null}
        </p>
      ) : null}
      {data ? (
        rows.length ? (
          <div className="-mx-[18px] overflow-x-auto px-[18px]">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]" data-testid="partners-firm-table">
              <caption className="sr-only">Partner accounts and the firm each is attached to</caption>
              <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th scope="col" className={TH}>Account</th><th scope="col" className={TH}>Firm</th><th scope="col" className={TH}>Attach to</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`partners-firm-row-${a.id}`}>
                    <td className={TD}>
                      <span className="font-bold">{String(a.name || '').trim() || a.email}</span>
                      {String(a.name || '').trim() ? <span className={`block ${SUB}`}>{a.email}</span> : null}
                    </td>
                    <td className={TD}>{a.partner_id ? (a.firm_company || a.firm_name || 'Firm name not recorded') : <span className={`text-[11px] font-bold uppercase tracking-[.06em] ${AMBER}`}>No firm</span>}</td>
                    <td className={TD}>
                      <label className="flex flex-col">
                        <span className="sr-only">{`Attach ${String(a.name || '').trim() || a.email} to a firm`}</span>
                        <select value={a.partner_id ?? ''} disabled={busy} onChange={(e) => ask(a, e.target.value)} className={INPUT} data-testid={`partners-firm-select-${a.id}`}>
                          <option value="">No firm</option>
                          {firms.map((f) => <option key={f.id} value={String(f.id)}>{`${f.company || f.name}${Number(f.accounts) > 0 ? ` · ${f.accounts} signed in` : ''}`}</option>)}
                        </select>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`m-0 ${SUB}`} data-testid="partners-firm-none">{onlyUnattached ? 'Every partner account read is attached to a firm.' : 'No partner accounts on record.'}</p>
        )
      ) : null}

      {pending ? (
        <Lightbox label={copy.title} title={copy.title} onClose={close} testId="partners-firm-confirm"
          footer={(
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className={actionPrimary} onClick={save} disabled={busy} data-testid="partners-firm-save">{busy ? 'Saving…' : copy.action}</button>
              </div>
              <Refusal text={refusal} testId="partners-firm-refusal" />
            </div>
          )}>
          <p className="m-0 px-5 py-4 text-[13px] leading-normal text-axal-ink dark:text-gray-100" data-testid="partners-firm-confirm-body">{copy.body}</p>
        </Lightbox>
      ) : null}
    </section>
  );
}
