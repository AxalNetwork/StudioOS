// D716 (#1860) — "My notices" on the LP workspace: the notices the Fund issued
// to this LP, newest first, and one notice at a time in the list's place.
// A capital-call notice opens on the amount due and the due date (L12 `pCall`);
// its frozen, masked wire instructions sit behind the phone check that
// #1859's `WireDetails` draws, imported here so the sentence exists once.
//
// The figures are the notice as issued (GET /api/fund-notices/mine/:uid),
// drawn through `lib/lpNoticesModel.js`. The PDF is fetched only when the LP
// taps PDF. Nothing here stores anything in the browser.
import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { Unreadable } from '../ui';
import { fundNoticesApi } from '../lib/api/fundNotices';
import {
  NOTICE_COPY,
  callHead,
  callLineId,
  genericHead,
  gateReducer,
  initialGate,
  instructionsOffer,
  keyFigureRows,
  paymentRows,
  rowText,
  tableRows,
} from '../lib/lpNoticesModel';
import { WireGate } from './SpinoutLabLpCommitment';

const CARD = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900';
const LBL = 'text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.09em] text-[#7d7889] dark:text-gray-400';
const ROW = 'flex min-h-[40px] items-center justify-between gap-3 border-b border-[#f0eff3] dark:border-gray-800 text-[14px] text-gray-900 dark:text-gray-100';
const MUTED = 'text-[12px] text-gray-500 dark:text-gray-400';

/**
 * Fetches the kept PDF once and saves it. Called only from the PDF button.
 * `save` defaults to an `<a download>` click on an object URL, revoked a
 * second later.
 */
export async function openNoticePdf(uid, { api = fundNoticesApi, save = saveBlob } = {}) {
  const { blob, filename } = await api.minePdfBlob(uid);
  save(blob, filename || `notice-${uid}.pdf`);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The list (decision 3). */
export function NoticeList({ notices, onOpen, opening }) {
  if (!notices.length) {
    return <div className={`${CARD} p-5 text-[12.5px] text-gray-500 dark:text-gray-400`} data-testid="status-no-notices">{NOTICE_COPY.empty}</div>;
  }
  return (
    <div className={`${CARD} overflow-hidden`}>
      {notices.map((n, i) => {
        const t = rowText(n);
        return (
          <button
            key={n.uid}
            type="button"
            onClick={() => onOpen(i)}
            className="flex min-h-[52px] w-full items-center gap-3 border-b border-gray-100 dark:border-gray-800 px-4 py-2.5 text-left last:border-b-0"
            data-testid={`notice-row-${i}`}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{t.title}</span>
                {n.superseded && (
                  <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600 dark:text-gray-300">{NOTICE_COPY.supersededPill}</span>
                )}
              </span>
              <span className="block text-[12px] text-gray-500 dark:text-gray-400">{opening === i ? NOTICE_COPY.opening : t.sub}</span>
              {n.instructions_changed && <span className="mt-0.5 block text-[12px] text-amber-700 dark:text-amber-400">{NOTICE_COPY.changed}</span>}
            </span>
            {t.amount && <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-gray-900 dark:text-gray-100">{t.amount}</span>}
            <span aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500">›</span>
          </button>
        );
      })}
    </div>
  );
}

/** A frozen table (decision 6): its title as an eyebrow, then label and value rows. */
export function FigureRows({ table }) {
  const rows = tableRows(table);
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      {table?.title && <div className={EYEBROW}>{table.title}</div>}
      {rows.map((r, i) => (
        <div key={i} className={`${ROW} ${r.total ? 'border-t-2 border-t-gray-300 dark:border-t-gray-600 font-extrabold' : ''}`}>
          <span>{r.label}</span>
          <span className="font-mono font-bold tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The frozen, masked block, drawn only once the box is ticked and the LP asked. */
export function WireInstructions({ notice }) {
  const rows = paymentRows(notice?.figures?.payment);
  const fromLine = callLineId(notice?.figures) != null;
  return (
    <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-3" data-testid="notice-wire-instructions">
      <div className={EYEBROW}>{NOTICE_COPY.wireLabel}</div>
      <div className={`${MUTED} mt-0.5`}>{NOTICE_COPY.asIssued(notice?.notice_date || notice?.figures?.notice_date || '')}</div>
      <dl className="mt-2 grid gap-y-1.5 text-[13px] text-gray-800 dark:text-gray-200 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {rows.map((r, i) => (
          <React.Fragment key={i}>
            <dt className="text-gray-500 dark:text-gray-400">{r.label}</dt>
            <dd className={`break-words ${r.mono ? 'font-mono tabular-nums' : ''}`}>{r.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {fromLine && (
        <a href="#my-commitment" className="mt-2 inline-block text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 underline">{NOTICE_COPY.goToCommitment}</a>
      )}
    </div>
  );
}

/**
 * One notice, controlled: the gate state and the PDF state come from the
 * caller, so a static render can draw every state.
 */
export function NoticeDetail({ notice, portal, gate, dispatch, pdf = {}, onPdf, onBack }) {
  const isCall = notice?.type === 'capital_call_notice';
  const head = isCall ? callHead(notice) : genericHead(notice);
  const figures = notice?.figures || {};
  const tables = Array.isArray(figures.tables) ? figures.tables : [];
  const offer = instructionsOffer(notice, portal);
  // #1859's gate, in its own vocabulary: the block is open in its `masked` step.
  const wire = { step: gate.shown ? 'masked' : 'gate', confirmed: gate.ticked };
  const tone = offer.reason === 'paid' ? 'text-emerald-700 dark:text-emerald-400'
    : offer.reason === 'superseded' ? 'text-gray-600 dark:text-gray-300'
      : 'text-amber-700 dark:text-amber-400';
  return (
    <div className={`${CARD} overflow-hidden md:max-w-[560px]`} data-testid="notice-detail">
      <div className="flex h-[44px] items-center justify-between border-b border-gray-100 dark:border-gray-800 px-[18px] text-[14px] font-bold text-gray-900 dark:text-gray-100">
        <button type="button" onClick={onBack} aria-label={NOTICE_COPY.back} className="truncate text-left">‹ {head.topLabel}</button>
        <button
          type="button"
          onClick={onPdf}
          disabled={!!pdf.busy}
          aria-label={NOTICE_COPY.downloadPdf}
          className="shrink-0 text-[12px] font-semibold text-[#4f46e5] dark:text-indigo-400 disabled:opacity-60"
        >
          {pdf.busy ? NOTICE_COPY.pdfBusy : NOTICE_COPY.pdf}
        </button>
      </div>
      {pdf.error && <p role="alert" className="px-[18px] pt-2 text-[12px] text-red-700 dark:text-red-400">{pdf.error}</p>}
      <div className="px-[18px] py-[14px]">
        {isCall ? (
          <div>
            <div className={EYEBROW}>{NOTICE_COPY.amountDue}</div>
            <div className="mt-1 text-[30px] font-extrabold tracking-[-.02em] tabular-nums text-gray-900 dark:text-gray-100">{head.amount}</div>
            <div className="mt-[14px] text-[13px] text-[#615c6e] dark:text-gray-400">{head.dueLine}</div>
          </div>
        ) : (
          <>
            {head.lpLine && <div className={MUTED}>{head.lpLine}</div>}
            <div className="mt-2">
              {keyFigureRows(figures).map((k, i) => (
                <div key={i} className={ROW}>
                  <span>{k.label}</span>
                  <span className={`font-bold ${k.mono ? 'font-mono tabular-nums' : ''}`}>{k.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {tables.map((t, i) => <FigureRows key={i} table={t} />)}
        {isCall && <div className={`${MUTED} mt-3`}>{NOTICE_COPY.noticeDate(notice?.notice_date || figures.notice_date || '')}</div>}

        {offer.offer ? (
          <>
            <WireGate
              wire={wire}
              onConfirm={(value) => dispatch({ type: 'tick', value })}
              onShow={() => dispatch({ type: 'show' })}
            />
            {gate.shown && gate.ticked && (
              <>
                <WireInstructions notice={notice} />
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'hide' })}
                  className="mt-2 min-h-[44px] w-full rounded-[14px] border border-gray-200 dark:border-gray-700 text-[14px] font-semibold text-gray-700 dark:text-gray-300"
                >
                  {NOTICE_COPY.hide}
                </button>
              </>
            )}
          </>
        ) : offer.sentence ? (
          <p className={`mt-4 text-[13px] font-semibold leading-[1.45] ${tone}`} data-testid="notice-no-check">{offer.sentence}</p>
        ) : null}
      </div>
      <div className="border-t border-gray-100 dark:border-gray-800 px-[18px] pb-[26px] pt-[12px]">
        <p className={MUTED}>{NOTICE_COPY.pdfLine}</p>
      </div>
    </div>
  );
}

/** The section (decision 1): the list, or one notice in its place. */
export function MyNotices({ portal }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [opening, setOpening] = useState(null);
  const [openErr, setOpenErr] = useState(null);
  const [gate, dispatch] = useReducer(gateReducer, undefined, initialGate);
  const [pdf, setPdf] = useState({ busy: false, error: '' });

  const reload = useCallback(async () => {
    setList(null);
    try {
      const r = await fundNoticesApi.mine();
      setList(Array.isArray(r?.notices) ? r.notices : false);
    } catch {
      setList(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const openAt = async (i) => {
    const n = list[i];
    dispatch({ type: 'reset' });
    setPdf({ busy: false, error: '' });
    setOpenErr(null);
    setOpening(i);
    try {
      setOpen(await fundNoticesApi.mineOne(n.uid));
    } catch {
      setOpen(null);
      setOpenErr(i);
    } finally {
      setOpening(null);
    }
  };
  const back = () => { dispatch({ type: 'reset' }); setOpen(null); setOpenErr(null); setPdf({ busy: false, error: '' }); };
  const onPdf = async () => {
    if (!open?.uid) return;
    setPdf({ busy: true, error: '' });
    try { await openNoticePdf(open.uid); setPdf({ busy: false, error: '' }); }
    catch (e) { setPdf({ busy: false, error: e?.message || 'The notice PDF could not be downloaded.' }); }
  };

  return (
    <section id="my-notices" data-testid="section-my-notices" className="scroll-mt-20">
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div className={LBL}>{NOTICE_COPY.listLabel}</div>
        <span className="text-[11.5px] text-gray-400 dark:text-gray-500">{NOTICE_COPY.listNote}</span>
      </div>
      {list === null ? (
        <div className={`${CARD} p-5 text-[12.5px] text-gray-500 dark:text-gray-400`}>{NOTICE_COPY.opening}</div>
      ) : list === false ? (
        <div className={`${CARD} p-5`} data-testid="status-notices-unreadable">
          <Unreadable what="Your notices" claim="This is not a claim that no notice was issued to you." onRetry={reload} />
        </div>
      ) : openErr != null ? (
        <div className={`${CARD} p-5`}>
          <button type="button" onClick={back} aria-label={NOTICE_COPY.back} className="mb-2 text-[14px] font-bold text-gray-900 dark:text-gray-100">‹</button>
          <Unreadable what="This notice" claim="This is not a claim that the notice was withdrawn." onRetry={() => openAt(openErr)} />
        </div>
      ) : open ? (
        <NoticeDetail notice={open} portal={portal} gate={gate} dispatch={dispatch} pdf={pdf} onPdf={onPdf} onBack={back} />
      ) : (
        <NoticeList notices={list} onOpen={openAt} opening={opening} />
      )}
    </section>
  );
}
