import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import {
  CAPS, DEAL_TYPES, EMPTY_LINE, EMPTY_TITLE, INVITATION_SORTS, LINK_LAPSED, LIST_CLAIM, NOT_OFFERED, SENT_WITHIN, STAGE_CHIPS,
  WITHIN_INVITATIONS, atCap, dealTypeWord, filterInvitations, invitationHref, invitationRow, isStale, listOf, noMatchLine,
  pageOf, rangeText, stagesFromSearch,
} from './partnersDeskModel';
import {
  AMBER, CARD, Chip, CopyButton, INPUT, LINK, Pager, ReadState, RowMenu, StageCell, SUB, TD, TH,
} from './parts';

/**
 * D923 (#2370) — Invitations (PI2): R1 under Guards L and I. Search (name or
 * email), stage chips, deal type offered, invited by, sent within and the
 * sort run over the loaded rows; below the cap they are exact, at it the
 * pager says what it covers. Enter on a row opens it. The Email column and
 * Export CSV wait for parts 1 and 7. D929: `?stage=` (Overview's C1) sets the
 * stage chips it opens with.
 */

const COLS = ['Invitee', 'Offered', 'Stage', 'Invited by', 'Sent', 'Opened', 'Expires', 'Result', ''];

export default function PartnersInvitations({ reads, now, actions }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [q, setQ] = useState('');
  const [stages, setStages] = useState(() => stagesFromSearch(search));
  const [type, setType] = useState('');
  const [invitedBy, setInvitedBy] = useState('');
  const [sentWithin, setSentWithin] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const list = listOf(reads.invitations);
  const isCapped = atCap(list, CAPS.invitations);
  const all = (list || []).map((inv) => ({ inv, row: invitationRow(inv, { proposed: reads.deals.proposed, now }) }));
  const rows = filterInvitations(all, { q, stages, type, invitedBy, sentWithin, sort, now });
  const shown = pageOf(rows, page);
  const inviters = [...new Set(all.map((r) => r.row.invitedBy))].sort((a, b) => a.localeCompare(b));
  const filtered = Boolean(q.trim() || stages.length || type || invitedBy || sentWithin);
  const reset = (fn) => (v) => { fn(v); setPage(1); };
  const clear = () => { setQ(''); setStages([]); setType(''); setInvitedBy(''); setSentWithin(''); setPage(1); };
  const toggle = (key) => { setStages((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key])); setPage(1); };
  const open = (id) => navigate(invitationHref(id));

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Invitations" data-testid="partners-invitations">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col">
          <span className="sr-only">Search name or email</span>
          <input type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search name or email" className={INPUT} data-testid="partners-inv-search" />
        </label>
        <label className="flex flex-col">
          <span className="sr-only">Deal type offered</span>
          <select value={type} onChange={(e) => reset(setType)(e.target.value)} className={INPUT} data-testid="partners-inv-type">
            <option value="">Deal type offered: any</option>
            {DEAL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.word}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="sr-only">Invited by</span>
          <select value={invitedBy} onChange={(e) => reset(setInvitedBy)(e.target.value)} className={INPUT} data-testid="partners-inv-by">
            <option value="">Invited by: anyone</option>
            {inviters.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="sr-only">First sent within</span>
          <select value={sentWithin} onChange={(e) => reset(setSentWithin)(e.target.value)} className={INPUT} data-testid="partners-inv-within">
            <option value="">First sent: any time</option>
            {SENT_WITHIN.map((d) => <option key={d} value={String(d)}>{`First sent within ${d} days`}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="sr-only">Sort</span>
          <select value={sort} onChange={(e) => reset(setSort)(e.target.value)} className={INPUT} data-testid="partners-inv-sort">
            {INVITATION_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Stage">
        {STAGE_CHIPS.map((c) => <Chip key={c.key} on={stages.includes(c.key)} onClick={() => toggle(c.key)} testId={`partners-inv-chip-${c.key}`}>{c.word}</Chip>)}
      </div>

      <ReadState read={reads.invitations} what="The invitations" claim={LIST_CLAIM} onRetry={reads.reload} testId="partners-inv-read" />

      {list ? (
        list.length === 0 && !isStale(reads.invitations) ? (
          <div className="flex flex-col items-start gap-2 py-4" data-testid="partners-inv-first-use">
            <p className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{EMPTY_TITLE}</p>
            <p className={`m-0 ${SUB}`}>{EMPTY_LINE}</p>
            <button type="button" className={actionPrimary} onClick={actions.newInvitation}>New invitation</button>
          </div>
        ) : (
          <>
            {rows.length ? (
              <div className="-mx-[18px] overflow-x-auto px-[18px]">
                <table className="w-full min-w-[1080px] border-collapse text-[12.5px]" data-testid="partners-inv-table">
                  <caption className="sr-only">Every invitation read, 25 a page. Select a row, or press Enter on it, to open it.</caption>
                  <thead>
                    <tr className="border-b border-axal-hairline dark:border-gray-700">
                      {COLS.map((c, i) => <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.rows.map(({ inv, row }) => (
                      <tr key={row.id} tabIndex={0} onClick={() => open(row.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(row.id); } }}
                        className="cursor-pointer border-b border-axal-hairline text-axal-ink hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
                        data-testid={`partners-inv-row-${row.id}`}>
                        <td className={TD}>
                          <Link to={`/admin/partner-invitations/invitations/${row.id}`} onClick={(e) => e.stopPropagation()}
                            className={`font-bold leading-snug hover:text-axal-violet dark:hover:text-violet-300 ${row.named ? 'text-axal-ink dark:text-gray-100' : 'italic text-axal-muted dark:text-gray-400'}`}>{row.name}</Link>
                          <span className={`block ${SUB}`}>{row.email}</span>
                        </td>
                        <td className={TD}>
                          {row.offered.unreadable ? <span className="text-red-700 dark:text-red-300">Could not be read</span> : (
                            <span className="flex flex-col gap-0.5">
                              <span>{row.offered.shown.map(dealTypeWord).join(' · ')}</span>
                              {row.offered.others.length ? <span className={SUB}>{`${row.offered.others.map(dealTypeWord).join(', ')}: ${NOT_OFFERED}`}</span> : null}
                            </span>
                          )}
                        </td>
                        <td className={TD}><StageCell stage={row.stage} testId={`partners-inv-stage-${row.id}`} /></td>
                        <td className={TD}>{row.invitedBy}</td>
                        <td className={`${TD} whitespace-nowrap font-mono text-[11.5px]`}>
                          {row.sent}
                          {row.resent ? <span className={`block font-sans ${SUB}`}>{`Resent ${row.resent}`}</span> : null}
                        </td>
                        <td className={`${TD} whitespace-nowrap font-mono text-[11.5px] ${row.opened === 'Not opened' ? 'text-axal-muted dark:text-gray-400' : ''}`}>{row.opened}</td>
                        <td className={`${TD} min-w-[150px]`}>
                          <span className={`font-mono text-[11.5px] ${row.expires.tone === 'amber' ? `font-bold ${AMBER}` : ''}`}>{row.expires.text}</span>
                          {row.expires.warn ? <span className={`block text-[11px] font-semibold ${AMBER}`}>{row.expires.warn}</span> : null}
                        </td>
                        <td className={TD}>
                          {row.dealId !== null ? (
                            <span className="flex flex-col gap-0.5">
                              <Link to={`/admin/partner-invitations/deals/${row.dealId}`} onClick={(e) => e.stopPropagation()} className={LINK}>{`Deal #${row.dealId}`}</Link>
                              {row.member ? <span className={SUB}>Member record</span> : null}
                            </span>
                          ) : <span className="text-axal-muted dark:text-gray-400">No deal</span>}
                        </td>
                        <td className={`${TD} text-right`}>
                          <RowMenu name={row.named ? row.name : row.email} testId={`partners-inv-menu-${row.id}`} items={row.actions.includes('open')
                            ? [{ key: 'open', label: 'Open', onSelect: () => open(row.id) }]
                            : [
                              row.stage.lapsed || !row.link
                                ? { key: 'copy', label: row.stage.lapsed ? LINK_LAPSED : 'Link not recorded', disabled: true }
                                : { key: 'copy', render: <CopyButton text={row.link} label="Copy link" testId={`partners-inv-copy-${row.id}`} /> },
                              { key: 'resend', label: 'Resend', onSelect: () => actions.resend(inv) },
                              { key: 'revoke', label: 'Revoke', onSelect: () => actions.revoke(inv) },
                            ]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5" data-testid="partners-inv-none">
                <span className={SUB}>{filtered ? noMatchLine(q, isCapped) : 'No invitations.'}</span>
                {filtered ? <button type="button" className={LINK} onClick={clear}>{q.trim() ? 'Clear the search' : 'Clear filters'}</button> : null}
              </div>
            )}
            <Pager shown={shown} range={rangeText(shown, isCapped ? WITHIN_INVITATIONS : null)} onPage={setPage} testId="partners-inv-range" />
          </>
        )
      ) : null}
    </section>
  );
}
