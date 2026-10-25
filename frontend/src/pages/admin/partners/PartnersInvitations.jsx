import React, { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { PhoneSheet, actionGhost, actionPrimary, usePhoneWidth } from '../../../ui';
import {
  DEAL_TYPES, EMPTY_LINE, EMPTY_TITLE, INVITATION_SORTS, LINK_LAPSED, LIST_CLAIM, NOT_OFFERED, SENT_WITHIN, STAGE_CHIPS,
  dealTypeWord, invitationHref, invitationRow, isStale, listOf, rangeText, stagesFromSearch,
} from './partnersDeskModel';
import {
  EXPORT_FAILED, EXPORT_PAGE, csvName, emailCell, exportQuery, exportingLine, filtersOn, invitersOf, listQuery, listReply,
  noServerMatch, serverPage, toCsv,
} from './invitationsModel';
import { useInvitationList } from './useInvitationList';
import {
  AMBER, CARD, Chip, CopyButton, INPUT, LINK, Pager, ReadState, Refusal, RowMenu, StageCell, SUB, TD, TH,
} from './parts';

/**
 * D950 (#2726) — Invitations (PI2; PI11b on a phone), on part 3's server list
 * (D926). Search (name or email), the stage chips with Lapsed, the type
 * offered, the inviter, the first send, the sort and the page are all the
 * Worker's, so the total is exact and nothing says what it covered: Guard L
 * is gone from this tab, and so is Guard I (a stored stage is the stage
 * reached since D924). A filter change is one debounced request
 * (`useInvitationList`). The Email column is part 1's latest send: Sent, Not
 * sent with its reason on hover, or Not recorded before migration 547. Export
 * CSV reads the current view page by page from the server; the file never
 * carries the invitation link or its token. D929: `?stage=` (Overview's C1)
 * sets the chips it opens with.
 *
 * On a phone (PI11b) the rows are cards, the filters sit in a bottom sheet
 * behind Filters, and the sort stays a select. A record opens as a page over
 * this tab, which stays mounted under it (PartnerInvitations.jsx), so the
 * filters and page are there on the way back.
 */

const COLS = ['Invitee', 'Offered', 'Stage', 'Email', 'Invited by', 'Sent', 'Opened', 'Expires', 'Result', ''];

/** The file, handed to the browser. A browser that refuses throws, and the page says so. */
function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function EmailCell({ inv, testId }) {
  const cell = emailCell(inv);
  return (
    <span title={cell.title} className={cell.key === 'not_sent' ? `font-semibold ${AMBER}` : cell.key === 'sent' ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'} data-testid={testId}>
      {cell.text}
      <span className="sr-only">{cell.key === 'sent' ? '' : `, ${cell.title}`}</span>
    </span>
  );
}

function rowMenu(row, inv, actions, open) {
  return row.actions.includes('open')
    ? [{ key: 'open', label: 'Open', onSelect: () => open(row.id) }]
    : [
      row.stage.lapsed || !row.link
        ? { key: 'copy', label: row.stage.lapsed ? LINK_LAPSED : 'Link not recorded', disabled: true }
        : { key: 'copy', render: <CopyButton text={row.link} label="Copy link" testId={`partners-inv-copy-${row.id}`} /> },
      { key: 'resend', label: 'Resend', onSelect: () => actions.resend(inv) },
      { key: 'revoke', label: 'Revoke', onSelect: () => actions.revoke(inv) },
    ];
}

export default function PartnersInvitations({ reads, now, actions }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const phone = usePhoneWidth();
  const [q, setQ] = useState('');
  const [stages, setStages] = useState(() => stagesFromSearch(search));
  const [type, setType] = useState('');
  const [invitedBy, setInvitedBy] = useState('');
  const [sentWithin, setSentWithin] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [exporting, setExporting] = useState(null);
  const filterButton = useRef(null);
  const filters = { q, stages, type, invitedBy, sentWithin, sort };
  const list = useInvitationList(listQuery({ ...filters, page }), reads.tick + retry);
  const shown = serverPage(list.data, page);
  const inviters = invitersOf(listOf(reads.invitations), list.data?.items);
  const filtered = filtersOn(filters);
  const reset = (fn) => (v) => { fn(v); setPage(1); };
  const clear = () => { setQ(''); setStages([]); setType(''); setInvitedBy(''); setSentWithin(''); setPage(1); };
  const toggle = (key) => { setStages((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key])); setPage(1); };
  const open = (id) => navigate(invitationHref(id));
  const rows = shown.rows.map((inv) => ({ inv, row: invitationRow(inv, { now, repair: false }) }));
  const firstUse = list.data && list.data.total === 0 && !filtered && !isStale(list);
  const activeFilters = [stages.length, type, invitedBy, sentWithin].filter(Boolean).length;

  /** Every page of the current view, from the server; any page that fails makes no file. */
  const exportCsv = async () => {
    if (exporting?.state === 'reading') return;
    const query = exportQuery(filters);
    const items = [];
    setExporting({ state: 'reading', done: 0, total: list.data ? list.data.total : null });
    try {
      let total = null;
      for (let offset = 0; total === null || offset < total; offset += EXPORT_PAGE) {
        const reply = listReply(await api.adminPartners.listInvitations({ ...query, limit: EXPORT_PAGE, offset }));
        total = reply.total;
        items.push(...reply.items);
        setExporting({ state: 'reading', done: items.length, total });
        if (!reply.items.length) break;
      }
      if (items.length < total) throw new Error('The export ended before its total.');
      download(csvName(now), toCsv(items, now));
      setExporting({ state: 'done', count: items.length });
    } catch {
      setExporting({ state: 'failed' });
    }
  };

  const filterControls = (
    <>
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
          {inviters.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col">
        <span className="sr-only">First sent within</span>
        <select value={sentWithin} onChange={(e) => reset(setSentWithin)(e.target.value)} className={INPUT} data-testid="partners-inv-within">
          <option value="">First sent: any time</option>
          {SENT_WITHIN.map((d) => <option key={d} value={String(d)}>{`First sent within ${d} days`}</option>)}
        </select>
      </label>
    </>
  );
  const chips = (
    <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Stage">
      {STAGE_CHIPS.map((c) => <Chip key={c.key} on={stages.includes(c.key)} onClick={() => toggle(c.key)} testId={`partners-inv-chip-${c.key}`}>{c.word}</Chip>)}
    </div>
  );
  const sortSelect = (
    <label className="flex flex-col">
      <span className="sr-only">Sort</span>
      <select value={sort} onChange={(e) => reset(setSort)(e.target.value)} className={INPUT} data-testid="partners-inv-sort">
        {INVITATION_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
      </select>
    </label>
  );

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Invitations" data-testid="partners-invitations">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col">
          <span className="sr-only">Search name or email</span>
          <input type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search name or email" className={INPUT} data-testid="partners-inv-search" />
        </label>
        {phone ? (
          <button ref={filterButton} type="button" className={`${INPUT} font-semibold`} onClick={() => setSheet(true)} data-testid="partners-inv-filters">
            {activeFilters ? `Filters · ${activeFilters}` : 'Filters'}
          </button>
        ) : filterControls}
        {sortSelect}
        <button type="button" className={actionGhost} onClick={exportCsv} disabled={exporting?.state === 'reading' || !list.data} data-testid="partners-inv-export">Export CSV</button>
      </div>
      {phone ? null : chips}
      {exporting?.state === 'reading' ? <p role="status" className={`m-0 ${SUB}`} data-testid="partners-inv-export-state">{exportingLine(exporting.done, exporting.total)}</p> : null}
      {exporting?.state === 'done' ? <p role="status" className={`m-0 ${SUB}`} data-testid="partners-inv-export-state">{`Exported ${exporting.count === 1 ? '1 invitation' : `${exporting.count.toLocaleString('en-US')} invitations`}. The file has no invitation links.`}</p> : null}
      {exporting?.state === 'failed' ? <Refusal text={EXPORT_FAILED} testId="partners-inv-export-failed" /> : null}

      {sheet ? (
        <PhoneSheet label="Filters" title="Filters" onClose={() => setSheet(false)} opener={filterButton}>
          <div className="flex flex-col gap-3 px-1 pb-4" data-testid="partners-inv-sheet">
            {filterControls}
            {chips}
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className={LINK} onClick={clear} disabled={!filtered}>Clear filters</button>
              <button type="button" className={actionPrimary} onClick={() => setSheet(false)} data-testid="partners-inv-sheet-done">{list.data ? `Show ${list.data.total === 1 ? '1 invitation' : `${list.data.total.toLocaleString('en-US')} invitations`}` : 'Show invitations'}</button>
            </div>
          </div>
        </PhoneSheet>
      ) : null}

      <ReadState read={list} what="The invitations" claim={LIST_CLAIM} onRetry={() => setRetry((n) => n + 1)} testId="partners-inv-read" />

      {list.data ? (
        firstUse ? (
          <div className="flex flex-col items-start gap-2 py-4" data-testid="partners-inv-first-use">
            <p className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{EMPTY_TITLE}</p>
            <p className={`m-0 ${SUB}`}>{EMPTY_LINE}</p>
            <button type="button" className={actionPrimary} onClick={actions.newInvitation}>New invitation</button>
          </div>
        ) : (
          <>
            {rows.length && phone ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="partners-inv-cards">
                {rows.map(({ inv, row }) => (
                  <li key={row.id} tabIndex={0} onClick={() => open(row.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(row.id); } }}
                    className="flex cursor-pointer items-start gap-2 rounded-[10px] border border-axal-hairline px-3 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet dark:border-gray-700"
                    data-testid={`partners-inv-row-${row.id}`}>
                    <span className="flex min-h-[44px] min-w-0 flex-1 flex-col gap-1" data-testid={`partners-inv-card-${row.id}`}>
                      <Link to={invitationHref(row.id)} onClick={(e) => e.stopPropagation()} className={`text-[14px] font-bold leading-snug ${row.named ? 'text-axal-ink dark:text-gray-100' : 'italic text-axal-muted dark:text-gray-400'}`}>{row.name}</Link>
                      <span className={SUB}>{row.email}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                        <StageCell stage={row.stage} compact testId={`partners-inv-stage-${row.id}`} />
                        <span className="text-axal-muted dark:text-gray-400">·</span>
                        <EmailCell inv={inv} testId={`partners-inv-email-${row.id}`} />
                      </span>
                      <span className={SUB}>{`Sent ${row.sent} · ${row.expires.text}`}</span>
                    </span>
                    <RowMenu name={row.named ? row.name : row.email} testId={`partners-inv-menu-${row.id}`} items={rowMenu(row, inv, actions, open)} />
                  </li>
                ))}
              </ul>
            ) : null}
            {rows.length && !phone ? (
              <div className="-mx-[18px] overflow-x-auto px-[18px]">
                <table className="w-full min-w-[1160px] border-collapse text-[12.5px]" data-testid="partners-inv-table">
                  <caption className="sr-only">Every invitation that matches, 25 a page. Select a row, or press Enter on it, to open it.</caption>
                  <thead>
                    <tr className="border-b border-axal-hairline dark:border-gray-700">
                      {COLS.map((c, i) => <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ inv, row }) => (
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
                        <td className={`${TD} whitespace-nowrap`}><EmailCell inv={inv} testId={`partners-inv-email-${row.id}`} /></td>
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
                          <RowMenu name={row.named ? row.name : row.email} testId={`partners-inv-menu-${row.id}`} items={rowMenu(row, inv, actions, open)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!rows.length ? (
              <div className="flex flex-wrap items-center gap-2.5" data-testid="partners-inv-none">
                <span className={SUB}>{filtered ? noServerMatch(q) : shown.total ? 'No invitations on this page.' : 'No invitations.'}</span>
                {filtered ? <button type="button" className={LINK} onClick={clear}>{q.trim() ? 'Clear the search' : 'Clear filters'}</button> : null}
                {!filtered && shown.total ? <button type="button" className={LINK} onClick={() => setPage(1)}>First page</button> : null}
              </div>
            ) : null}
            <Pager shown={shown} range={rangeText(shown)} onPage={setPage} testId="partners-inv-range" />
          </>
        )
      ) : null}
    </section>
  );
}
