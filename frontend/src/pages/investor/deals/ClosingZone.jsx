import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';
import { SearchInput } from '../../advisor/network/kit';
import { dealStage, dealMoneyExact } from '../../../lib/dealFlow';
import {
  LOADING, UNREADABLE, ready, closingRows, closingKpis, paperWord, figureWord,
  EMPTY_TITLE, EMPTY_BODY, WAITS_ON_OVERVIEW,
} from './closingListModel';
import { useAuth } from '../../../hooks/useAuthSync';
import { exportView } from '../../../lib/csvExport';
import FromMercury from '../FromMercury';
import ClosingWorkspace from './ClosingWorkspace';
import { transferBody, verifierOptions } from './closingWorkspaceModel';

/**
 * Deals · Closing — canvas **ID4**, `/deals/closing`. COLLECTION.
 *
 * DEALS V2 (D4815 part 8, #5911, canvas DX8, board DE08 A): the page is a
 * deal-first list now. The strip is the canvas's five figures (Deals at
 * closing, Paper executed, Signatures outstanding, Blocking conditions,
 * Transfers recorded) and the list has one row per deal at closing, with its
 * investment, closing progress, signatures outstanding, open conditions,
 * transfer state and Open. Both come from `closingListModel.js`, the one
 * place that joins the reads below, so moving to `GET
 * /api/deals/closing-overview` (#6157) changes that file only. Paper reads
 * in the agreement lifecycle's words: a completed envelope is Executed.
 *
 * WHAT WAS HERE: three hard-coded rows with a tick and two circles — "Deal
 * reached closing · Recorded", "Signatures and documents · Check deal room",
 * "Wire confirmation · Not recorded here" — and a link out. Two of the three
 * were captions rather than facts: nothing was read to produce them, and they
 * said the same thing on every deal at closing.
 *
 * THE OPS ROW'S FIRST REASON IS FALSE, which makes three zones in a row.
 * `Apply template` was marked unbuilt because "no closing templates are
 * stored". `legal_templates` ships 21 seeded rows with `merge_fields`,
 * `version` and `is_active`, and three of them are the closing paper this
 * artboard names by name — `safe` (SAFE Agreement), `spa` (Stock Purchase
 * Agreement) and `subscription` (Subscription Agreement). The gap is one layer
 * ABOVE the templates: nothing stores a closing CHECKLIST for a template to be
 * applied TO. That is a different sentence and it points somewhere real.
 *
 * `Record wire` is true but was imprecise, and the imprecision costs the next
 * reader a lookup: `capital_calls` DOES carry `amount`, `status`, `due_date`
 * and `paid_date` — but that is an LP paying INTO the fund, not the fund
 * wiring OUT to a company. Different direction, different counterparty. The
 * reason now says which.
 *
 * THE READS ARE ALL SCOPED AT THEIR OWN ROUTES. ID3 ended on the rule that a
 * second copy of a scoped query is how a tenancy hole reopens. The deals come
 * from `api.listDeals` (`mine`), the paper from `api.esignList` —
 * `esign.get('/')`, which puts `esignEnvelopeScope` in the WHERE clause
 * unconditionally — the open conditions from `api.icConditions` (the decision
 * scope, D461), and the transfers from `api.dealsTransfers` (the deal
 * relationship predicate, D462). The page joins them on `deal_id` in the
 * browser rather than asking the worker for a second view of rows it already
 * exposes.
 *
 * THE CHECKLIST IS THE ARTBOARD'S NOW. ID4 draws a "Closing checklist" and
 * migration 335 stores one: one checklist per deal, applied from a closing
 * template, its items pending | done | blocked | skipped. The default item
 * set is the owner's call, so an applied checklist starts empty and the page
 * says so. The paper instrument stays beside it — the executed envelopes and
 * their signature state are a different record, and the packet export indexes
 * them.
 */

const UNAVAILABLE = Symbol('unavailable');

/**
 * A figure from the model, in words: recorded is its text; unreadable says
 * Unreadable (never 0); loading says Reading…; unrecorded says Not recorded.
 */
function FigureText({ figure, className = '' }) {
  if (figure.state === 'recorded') return <span className={className}>{figure.text}</span>;
  if (figure.state === 'unreadable') {
    return <span className={`font-semibold text-red-700 dark:text-red-300 ${className}`} title={figure.reason || undefined}>Unreadable</span>;
  }
  if (figure.state === 'loading') return <span className="text-gray-500 dark:text-gray-400">Reading…</span>;
  return <NotRecorded />;
}

/** The strip tile, in the anatomy every artboard shares. */
export function KpiTile({ kpi }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`closing-kpi-${kpi.key}`}>
      <Eyebrow>{kpi.label}</Eyebrow>
      <div className="mt-1.5 font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
        <FigureText figure={kpi} />
      </div>
      {kpi.reason ? <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{kpi.reason}</div> : null}
    </div>
  );
}

/** One count on a deal row: the figure, then what it counts. */
function DealFraction({ figure, one, many, testid }) {
  const word = figure.state === 'recorded' && figure.value === 1 ? one : many;
  return (
    <div className="flex items-baseline gap-1.5 md:flex-col md:items-start md:gap-0" data-testid={testid}>
      <b className="font-mono text-[15px] text-axal-ink dark:text-gray-100"><FigureText figure={figure} /></b>
      <small className="text-[10.5px] text-gray-600 dark:text-gray-400">{word}</small>
    </div>
  );
}

/** The transaction tag: a teal-edged tag, the canvas's Transaction family. */
function TransferTag({ figure, testid }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-[4px] border border-l-[3px] border-gray-200 border-l-teal-600 bg-white px-2 py-0.5 text-[10.5px] font-semibold text-gray-800 dark:border-gray-700 dark:border-l-teal-400 dark:bg-gray-900 dark:text-gray-200"
      data-testid={testid}
    >
      <FigureText figure={figure} />
    </span>
  );
}

/** One deal at closing (DE08 A): investment and progress, the two counts, the transfer tag, Open. */
export function ClosingDealRow({ row, onOpen }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-[10px] border border-axal-hairline bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900 md:flex-row md:items-center md:gap-5"
      data-testid={`closing-deal-${row.id}`}
    >
      <div className="min-w-0 flex-1">
        <b className="text-[14px] text-axal-ink dark:text-gray-100">{row.name}</b>
        <div className="mt-0.5 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid={`closing-deal-${row.id}-line`}>
          {row.investment.state === 'recorded'
            ? <span>{row.investment.text} investment</span>
            : <span>Investment <FigureText figure={row.investment} /></span>}
          {' · closing progress '}
          <FigureText figure={row.progress} />
          {row.progress.state === 'unrecorded' && row.progress.reason ? <span> ({row.progress.reason})</span> : null}
        </div>
      </div>
      <DealFraction figure={row.signatures} one="signature outstanding" many="signatures outstanding" testid={`closing-deal-${row.id}-signatures`} />
      <DealFraction figure={row.conditions} one="open condition" many="open conditions" testid={`closing-deal-${row.id}-conditions`} />
      <TransferTag figure={row.transfer} testid={`closing-deal-${row.id}-transfer`} />
      <button
        type="button"
        onClick={() => onOpen(row.href)}
        data-testid={`button-open-closing-${row.id}`}
        aria-label={`Open ${row.name}`}
        className="min-h-[44px] self-start rounded-[7px] bg-axal-violet-deep px-4 py-1.5 text-[11.5px] font-bold text-white hover:bg-axal-violet dark:bg-violet-500 dark:text-white dark:hover:bg-violet-400 md:min-h-0 md:self-center"
      >
        Open
      </button>
    </div>
  );
}

/** The row's one control, in the cell whose subject it acts on. */
function OpenDeal({ id, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(`/deals/${id}`)}
      className="text-[10.5px] font-semibold text-axal-violet-deep underline underline-offset-2 hover:text-axal-violet dark:text-violet-300"
    >
      Open deal room
    </button>
  );
}

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

/**
 * How an envelope's status reads. `completed` is the only one that means the
 * paper is executed; every other value is a stage on the way there, and none
 * of them is a failure, so none is drawn in red.
 */
const STATUS_TONE = { completed: 'ok', sent: 'info', draft: 'neutral', declined: 'danger', voided: 'warn' };

/** The three closing templates, as the legal library names them. */
const TEMPLATE_LABEL = {
  safe: 'SAFE Agreement',
  spa: 'Stock Purchase Agreement',
  subscription: 'Subscription Agreement',
};

/** A checklist item's state, as migration 335 CHECKs it. */
const ITEM_STATE_CLASS = {
  pending: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
  blocked: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
  skipped: 'border-gray-200 bg-transparent text-gray-500 dark:border-gray-700 dark:text-gray-500',
};

export default function InvestorClosingZone() {
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  // D6866: `?deal=<id>` opens that deal's closing workspace (DX17 to DX22) in place of the list.
  const [params, setParams] = useSearchParams();
  const workspaceDeal = Number(params.get('deal')) || null;
  // Bumped after a transfer is recorded, so the workspace reads its tabs again.
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [deals, setDeals] = useState(null);
  const [envelopes, setEnvelopes] = useState(null);
  const [conditions, setConditions] = useState(null);
  const [transfers, setTransfers] = useState(null);
  const [checklists, setChecklists] = useState({});
  const [wireForm, setWireForm] = useState(null);
  // D6889: the Admins a phone verifier is picked from (`GET /users?role=admin`,
  // an Admin's read). Read once, when an Admin first opens Record transfer.
  const [verifiers, setVerifiers] = useState(null);
  const wireOpen = !!wireForm;
  const isAdminUser = user?.role === 'admin';
  useEffect(() => {
    if (!wireOpen || !isAdminUser || verifiers !== null) return;
    api.listUsers('admin').then((r) => setVerifiers(Array.isArray(r) ? r : (r?.items || [])), () => setVerifiers(UNAVAILABLE));
  }, [wireOpen, isAdminUser, verifiers]);
  const [templateForm, setTemplateForm] = useState(null);
  const [itemForms, setItemForms] = useState({});
  const [actionError, setActionError] = useState('');
  const [view, setView] = useState('close');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setDeals(null);
    setEnvelopes(null);
    setConditions(null);
    setTransfers(null);
    setChecklists({});
    api.listDeals(undefined, 'mine').then(
      (r) => setDeals(Array.isArray(r) ? r : (r?.items || [])),
      () => setDeals(UNAVAILABLE),
    );
    api.esignList().then(
      (r) => setEnvelopes(r?.envelopes || []),
      () => setEnvelopes(UNAVAILABLE),
    );
    // The Blocking chip's store (migration 334): the open conditions on every
    // decision this account may see, each carrying the deal it could block.
    api.icConditions('open').then(
      (r) => setConditions(Array.isArray(r?.items) ? r.items : []),
      () => setConditions(UNAVAILABLE),
    );
    // The Wires chip's store (migration 335): every transfer this account may
    // read, scoped at the route.
    api.dealsTransfers().then(
      (r) => setTransfers(Array.isArray(r?.items) ? r.items : []),
      () => setTransfers(UNAVAILABLE),
    );
  }, []);
  useEffect(() => { load(); }, [load]);

  const dealsReady = deals !== null && deals !== UNAVAILABLE;
  const envReady = envelopes !== null && envelopes !== UNAVAILABLE;
  const condReady = conditions !== null && conditions !== UNAVAILABLE;
  const wiresReady = transfers !== null && transfers !== UNAVAILABLE;
  // The write controls are the operator's (partner/admin): the routes refuse
  // an investor, so the page must not offer them one.
  const canOperate = user?.role === 'admin' || user?.role === 'partner';
  /**
   * THE PACKET IS A JOIN: it indexes envelopes against the deals at closing,
   * so it needs both reads. The strip's own joins are the model's
   * (`closingKpis`), which names whichever read is missing.
   */
  const joinedReady = dealsReady && envReady;

  /**
   * THE MODEL'S READS. Each list is LOADING, UNREADABLE or `ready(items)`;
   * `checklists` maps a deal id to its checklist (undefined while it is read,
   * UNREADABLE when it failed, null when none is applied). This is the one
   * hand-off to `closingListModel.js`: when `GET /api/deals/closing-overview`
   * (#6157) lands, these reads become that one.
   */
  const reads = useMemo(() => {
    const asRead = (v) => (v === null ? LOADING : v === UNAVAILABLE ? UNREADABLE : ready(v));
    return { deals: asRead(deals), envelopes: asRead(envelopes), conditions: asRead(conditions), transfers: asRead(transfers) };
  }, [deals, envelopes, conditions, transfers]);
  const checklistReads = useMemo(
    () => Object.fromEntries(Object.entries(checklists).map(([id, v]) => [id, v === UNAVAILABLE ? UNREADABLE : v])),
    [checklists],
  );
  const kpis = useMemo(() => closingKpis(reads), [reads]);
  const dealList = useMemo(() => closingRows(reads, checklistReads), [reads, checklistReads]);

  /** The deals this stage is about, from the shared stage map rather than a status test. */
  const closing = useMemo(
    () => (dealsReady ? deals.filter((d) => dealStage(d) === 'closing') : []),
    [dealsReady, deals],
  );

  /** Every envelope raised against one of them, joined on the deal it names. */
  const rows = useMemo(() => {
    if (!envReady) return [];
    const ids = new Set(closing.map((d) => d.id));
    const byId = new Map(closing.map((d) => [d.id, d]));
    return envelopes
      .filter((e) => e.deal_id != null && ids.has(e.deal_id))
      .map((e) => ({ ...e, deal: byId.get(e.deal_id) || null }));
  }, [envReady, envelopes, closing]);

  /**
   * Executed means COMPLETED, and nothing else counts.
   *
   * `signed_count` reaching `recipient_count` is not the same fact: a
   * counter-signature can be recorded while the envelope is still open, and an
   * envelope with no recipients at all would read as fully signed under a
   * ratio. The status column is what the system acts on, so it is what the
   * strip counts.
   */
  const executed = useMemo(() => rows.filter((e) => e.status === 'completed'), [rows]);

  /**
   * THE BLOCKING VIEW'S ROWS. A blocking item is a Commit condition that is
   * still open (migration 334), narrowed to the deals at closing — the
   * hand-off the artboard's note describes ("arrived from the Commit vote").
   * A condition on a deal at any other stage is the Commit room's to show.
   */
  const blockingRows = useMemo(() => {
    if (!condReady) return [];
    const ids = new Set(closing.map((d) => d.id));
    return conditions.filter((cond) => cond.deal_id != null && ids.has(cond.deal_id));
  }, [condReady, conditions, closing]);

  /** Search narrows what the chip chose — the Blocking view included. */
  const visibleBlocking = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blockingRows;
    return blockingRows.filter((cond) => {
      const deal = closing.find((d) => d.id === cond.deal_id);
      return `${cond.body || ''} ${cond.decision_title || ''} ${deal?.project_name || ''}`
        .toLowerCase().includes(q);
    });
  }, [blockingRows, query, closing]);

  /**
   * THE WIRES VIEW'S ROWS (migration 335): the recorded transfers on the deals
   * at closing. The platform records the movement of money; it does not move
   * it — a row here is what someone recorded, with who and when.
   */
  const wireRows = useMemo(() => {
    if (!wiresReady) return [];
    const ids = new Set(closing.map((d) => d.id));
    return transfers.filter((t) => ids.has(t.deal_id));
  }, [wiresReady, transfers, closing]);

  const visibleWires = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return wireRows;
    return wireRows.filter((t) => `${t.project_name || ''} ${t.reference || ''}`.toLowerCase().includes(q));
  }, [wireRows, query]);

  // The checklist per closing deal, loaded once the deals are known. Each
  // read is the per-deal route; a deal with none gets the apply control.
  useEffect(() => {
    if (!dealsReady) return;
    let alive = true;
    (async () => {
      const entries = await Promise.all(deals.filter((d) => dealStage(d) === 'closing').map(async (d) => {
        try {
          const r = await api.dealClosingChecklist(d.id);
          return [d.id, r?.checklist || null];
        } catch { return [d.id, UNAVAILABLE]; }
      }));
      if (alive) setChecklists(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [dealsReady, deals]);

  async function submitWire() {
    if (!wireForm) return;
    const cents = Math.round(Number(wireForm.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setWireForm({ ...wireForm, error: 'Enter the amount in dollars — it is stored as integer cents.' });
      return;
    }
    setWireForm({ ...wireForm, busy: true, error: '' });
    try {
      // D6889: the verifier goes only with a phone-verified transfer; the
      // Worker checks it names an Admin and its refusal shows as given.
      await api.dealTransferRecord(wireForm.dealId, transferBody({ ...wireForm, cents }));
      setWireForm(null);
      load();
      setWorkspaceKey((k) => k + 1);
    } catch (cause) {
      // The conditions gate refuses with 409 `open_conditions_block_transfer`;
      // e.message is the route's own sentence and names the count.
      setWireForm({ ...wireForm, busy: false, error: cause?.message || 'The transfer could not be recorded.' });
    }
  }

  async function submitTemplate() {
    if (!templateForm) return;
    setTemplateForm({ ...templateForm, busy: true, error: '' });
    try {
      await api.dealClosingChecklistApply(templateForm.dealId, templateForm.slug);
      setTemplateForm(null);
      load();
    } catch (cause) {
      setTemplateForm({ ...templateForm, busy: false, error: cause?.message || 'The template could not be applied.' });
    }
  }

  async function setItemState(dealId, itemUid, state) {
    setActionError('');
    try {
      const r = await api.dealClosingChecklistSetItem(dealId, itemUid, { state });
      setChecklists((current) => ({ ...current, [dealId]: r?.checklist || current[dealId] }));
    } catch (cause) {
      setActionError(cause?.message || 'The item could not be updated.');
    }
  }

  async function addItem(dealId) {
    const form = itemForms[dealId];
    const label = String(form?.label || '').trim();
    if (!label) return;
    setItemForms((current) => ({ ...current, [dealId]: { ...form, busy: true } }));
    setActionError('');
    try {
      const r = await api.dealClosingChecklistAddItem(dealId, label);
      setChecklists((current) => ({ ...current, [dealId]: r?.checklist || current[dealId] }));
      setItemForms((current) => ({ ...current, [dealId]: { label: '', busy: false } }));
    } catch (cause) {
      setItemForms((current) => ({ ...current, [dealId]: { ...form, busy: false } }));
      setActionError(cause?.message || 'The item could not be added.');
    }
  }

  const recordWire = !canOperate
    ? { onClick: () => {}, disabled: true, title: 'Recording a transfer is an operator’s act — a partner or an admin records it.' }
    : !closing.length
      ? { onClick: () => {}, disabled: true, title: 'No deal is at closing, so there is nothing to record a transfer against.' }
      : { onClick: () => { setActionError(''); setWireForm({ dealId: closing[0].id, amount: '', reference: '', phoneVerified: false, phoneVerifiedBy: '', note: '', busy: false, error: '' }); } };

  const applyTemplate = !canOperate
    ? { onClick: () => {}, disabled: true, title: 'Applying a closing template is an operator’s act — a partner or an admin applies it.' }
    : !closing.length
      ? { onClick: () => {}, disabled: true, title: 'No deal is at closing, so there is nothing to apply a template to.' }
      : { onClick: () => { setActionError(''); setTemplateForm({ dealId: closing[0].id, slug: 'safe', busy: false, error: '' }); } };

  /**
   * EXPORT PACKET — the index of the executed paper, from the reads this page
   * already made. A packet is evidence, not a payment instruction: what is
   * executed, when, and how many of its recipients signed.
   */
  const exportPacket = useMemo(() => {
    if (!joinedReady) return { onClick: () => {}, disabled: true, title: 'The signature archive could not be read, so no packet can be indexed from it.' };
    if (!executed.length) return { onClick: () => {}, disabled: true, title: 'No envelope on these deals is executed yet — a packet indexes executed paper.' };
    return {
      onClick: () => exportView({
        scope: 'deals',
        zone: 'closing-packet',
        header: ['Document', 'Deal', 'Executed', 'Signatures'],
        rows: executed,
        cells: (e) => [
          e.document_title || e.document_type || '',
          e.deal?.project_name || `Deal #${e.deal_id}`,
          day(e.completed_at) || '',
          Number.isFinite(Number(e.recipient_count)) && Number(e.recipient_count) > 0
            ? `${e.signed_count ?? 0} of ${e.recipient_count}`
            : 'no recipient recorded',
        ],
      }),
    };
  }, [joinedReady, executed]);

  /**
   * SEARCH NARROWS WHAT THE CHIP CHOSE. On This close it narrows the deal
   * rows by the deal's name; on Documents it narrows the paper by the
   * document's title and the deal it belongs to, which is joined on.
   */
  const visibleDeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dealList.rows;
    return dealList.rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [dealList, query]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((e) => {
      const hay = `${e.document_title || ''} ${e.document_type || ''} ${e.deal?.project_name || ''}`;
      return hay.toLowerCase().includes(q);
    });
  }, [rows, query]);

  const rowActions = investorZoneActions('deals/closing', {
    handlers: { applyTemplate, exportPacket, recordWire },
    view: view === 'wires'
      ? {
          header: ['Deal', 'Amount', 'Reference', 'Phone-verified', 'Recorded'],
          rows: visibleWires,
          cells: (t) => [
            t.project_name || `Deal #${t.deal_id}`,
            dealMoneyExact(Number(t.amount_cents) / 100) || '',
            t.reference || '',
            t.phone_verified ? 'yes' : 'no',
            day(t.recorded_at) || '',
          ],
        }
      : view === 'close'
      ? {
          header: ['Deal', 'Investment', 'Closing progress', 'Signatures outstanding', 'Open conditions', 'Transfer'],
          rows: visibleDeals,
          cells: (r) => [r.name, figureWord(r.investment), figureWord(r.progress), figureWord(r.signatures), figureWord(r.conditions), figureWord(r.transfer)],
        }
      : {
          header: ['Document', 'Deal', 'State', 'Signatures', 'Executed'],
          rows: visible,
          cells: (e) => [
            e.document_title || e.document_type || '',
            e.deal?.project_name || `Deal #${e.deal_id}`,
            paperWord(e.status),
            `${e.signed_count ?? ''}/${e.recipient_count ?? ''}`,
            day(e.completed_at) || '',
          ],
        },
  });

  const wirePanel = wireForm ? (
        <div className="rounded-[10px] border border-amber-300 bg-amber-50/70 p-3 mb-3 dark:border-amber-900 dark:bg-amber-950/25" data-testid="panel-record-wire">
          <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100">Record a transfer</p>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
            The platform records the movement of money; it does not move it. An open IC condition on the deal refuses this write.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Deal
              <select
                value={wireForm.dealId}
                onChange={(e) => setWireForm({ ...wireForm, dealId: Number(e.target.value) })}
                data-testid="select-wire-deal"
                className="mt-1 w-full rounded-[7px] border border-gray-200 bg-white px-2 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {closing.map((d) => <option key={d.id} value={d.id}>{d.project_name || `Deal #${d.id}`}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Amount (dollars)
              <input
                value={wireForm.amount}
                onChange={(e) => setWireForm({ ...wireForm, amount: e.target.value })}
                inputMode="decimal"
                placeholder="250000"
                data-testid="input-wire-amount"
                className="mt-1 w-full rounded-[7px] border border-gray-200 bg-white px-2 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
            <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Reference
              <input
                value={wireForm.reference}
                onChange={(e) => setWireForm({ ...wireForm, reference: e.target.value })}
                placeholder="Bank reference, if one was issued"
                data-testid="input-wire-reference"
                className="mt-1 w-full rounded-[7px] border border-gray-200 bg-white px-2 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-700 dark:text-gray-300 mt-5">
              <input
                type="checkbox"
                checked={wireForm.phoneVerified}
                onChange={(e) => setWireForm({ ...wireForm, phoneVerified: e.target.checked, phoneVerifiedBy: e.target.checked ? wireForm.phoneVerifiedBy : '' })}
                data-testid="check-wire-phone"
              />
              Instructions verified by phone
            </label>
            {isAdminUser ? (
              <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 md:col-span-2">Who confirmed them by phone <span className="font-normal text-gray-500 dark:text-gray-400">· an Admin, optional</span>
                <select
                  value={wireForm.phoneVerifiedBy}
                  disabled={!wireForm.phoneVerified || !Array.isArray(verifiers)}
                  onChange={(e) => setWireForm({ ...wireForm, phoneVerifiedBy: e.target.value })}
                  data-testid="select-wire-verifier"
                  className="mt-1 w-full min-h-[44px] rounded-[7px] border border-gray-200 bg-white px-2 py-1.5 text-[12px] disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 md:min-h-0"
                >
                  <option value="">Not recorded</option>
                  {(Array.isArray(verifiers) ? verifierOptions(verifiers, user) : []).map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
                </select>
                <span className="mt-0.5 block font-normal text-gray-500 dark:text-gray-400" data-testid="wire-verifier-note">
                  {verifiers === UNAVAILABLE ? 'The list of Admins could not be read, so no verifier can be named. The transfer still records.'
                    : verifiers === null ? 'Reading the Admins…'
                      : !wireForm.phoneVerified ? 'Tick “verified by phone” to name who confirmed it.'
                        : 'It may be you. Left as Not recorded, the transfer still records.'}
                </span>
              </label>
            ) : null}
          </div>
          <textarea
            rows={2}
            value={wireForm.note}
            onChange={(e) => setWireForm({ ...wireForm, note: e.target.value })}
            aria-label="Transfer note"
            placeholder="Note (optional)"
            data-testid="input-wire-note"
            className="mt-2 w-full rounded-[7px] border border-gray-200 bg-white p-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          {wireForm.error && (
            <p className="mt-2 text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-wire-error">{wireForm.error}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submitWire}
              disabled={wireForm.busy}
              data-testid="button-submit-wire"
              className="rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              {wireForm.busy ? 'Recording…' : 'Record the transfer'}
            </button>
            <button type="button" onClick={() => setWireForm(null)} className="rounded-[7px] px-[11px] py-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
          </div>
        </div>
  ) : null;

  const bothFailed = deals === UNAVAILABLE && envelopes === UNAVAILABLE;

  if (workspaceDeal) {
    const deal = dealsReady ? deals.find((d) => Number(d.id) === workspaceDeal) || null : null;
    return (
      <>
        {wirePanel}
        <ClosingWorkspace
          key={workspaceKey}
          dealId={workspaceDeal}
          deal={deal}
          user={user}
          onBack={() => setParams({})}
          onRecordTransfer={(id) => { setActionError(''); setWireForm({ dealId: id, amount: '', reference: '', phoneVerified: false, phoneVerifiedBy: '', note: '', busy: false, error: '' }); }}
        />
      </>
    );
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="investor"
        filters={investorZoneFilters('deals/closing', {
          value: view,
          onChange: setView,
          // A count beside a failed read would read as a figure the store
          // disclaimed, so every chip drops the clause when its read failed
          // rather than printing one. This close counts deals, not paper.
          counts: {
            close: dealsReady ? closing.length : undefined,
            documents: joinedReady ? rows.length : undefined,
            blocking: condReady ? blockingRows.length : undefined,
            wires: wiresReady ? wireRows.length : undefined,
          },
        })}
        actions={rowActions}
      />
      <div className="mb-3 flex" data-testid="closing-search">
        <SearchInput value={query} onChange={setQuery} placeholder="Search deal or document" />
      </div>
      {actionError && (
        <p className="mb-3 text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-closing-action-error">{actionError}</p>
      )}
      {/* RECORD WIRE — a transfer OUT to the company, recorded. The amount is
          typed in dollars and stored as integer cents; the phone-verified flag
          is the artboard's own fraud note (email-only verification is how
          funds get defrauded). An open Commit condition refuses the write —
          the route's 409 sentence renders in the form. */}
      {wireForm ? wirePanel : null}
      {/* APPLY TEMPLATE — the closing checklist for a deal, from one of the
          three closing templates. No default items are seeded: the default
          set is the owner's call, and the checklist says so until then. */}
      {templateForm && (
        <div className="rounded-[10px] border border-amber-300 bg-amber-50/70 p-3 mb-3 dark:border-amber-900 dark:bg-amber-950/25" data-testid="panel-apply-template">
          <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100">Apply a closing template</p>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
            Creates the deal’s closing checklist from the template. The default item set is the owner’s call — none is seeded yet, so items are added by hand until then.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Deal
              <select
                value={templateForm.dealId}
                onChange={(e) => setTemplateForm({ ...templateForm, dealId: Number(e.target.value) })}
                data-testid="select-template-deal"
                className="mt-1 w-full rounded-[7px] border border-gray-200 bg-white px-2 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {closing.map((d) => <option key={d.id} value={d.id}>{d.project_name || `Deal #${d.id}`}{checklists[d.id] ? ' — checklist applied' : ''}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Template
              <select
                value={templateForm.slug}
                onChange={(e) => setTemplateForm({ ...templateForm, slug: e.target.value })}
                data-testid="select-template-slug"
                className="mt-1 w-full rounded-[7px] border border-gray-200 bg-white px-2 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                <option value="safe">SAFE Agreement</option>
                <option value="spa">Stock Purchase Agreement</option>
                <option value="subscription">Subscription Agreement</option>
              </select>
            </label>
          </div>
          {templateForm.error && (
            <p className="mt-2 text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-template-error">{templateForm.error}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submitTemplate}
              disabled={templateForm.busy}
              data-testid="button-submit-template"
              className="rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              {templateForm.busy ? 'Applying…' : 'Apply the template'}
            </button>
            <button type="button" onClick={() => setTemplateForm(null)} className="rounded-[7px] px-[11px] py-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
          </div>
        </div>
      )}
      <ZoneBody
        loading={deals === null && envelopes === null}
        error={bothFailed ? 'Neither the deal record nor the signature archive could be read.' : ''}
        onRetry={load}
        isEmpty={dealsReady && closing.length === 0}
        empty={<NothingYet title={EMPTY_TITLE} body={EMPTY_BODY} />}
      >
        <div className="space-y-6">
          {/* ══ THE DE08 STRIP (DX8) — five figures from `closingKpis`. A
              figure whose read failed says Unreadable and names the read;
              it is never 0. ══ */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="closing-strip">
            {kpis.map((kpi) => <KpiTile key={kpi.key} kpi={kpi} />)}
          </div>

          {/* ══ THE DEAL-FIRST LIST (DE08 A) — one row per deal at closing,
              from `closingRows`. Open goes to the deal; the closing workspace
              (DE08b) is the next part. ══ */}
          {view === 'close' && (
            dealList.state === 'unreadable' ? (
              <p className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300" role="alert" data-testid="status-closing-deals-unreadable">
                The deal record could not be read. That is not a claim that no deal is in closing.
                <button type="button" onClick={load} className="ml-1 inline-flex min-h-[44px] items-center gap-1 underline md:min-h-0">Try again</button>
              </p>
            ) : dealList.state === 'ready' ? (
              <section className="space-y-2" data-testid="closing-deals" aria-label="Deals at closing">
                {visibleDeals.length === 0 ? (
                  <p className="text-[12px] text-gray-600 dark:text-gray-400">No deal at closing matches the search.</p>
                ) : visibleDeals.map((r) => (
                  <ClosingDealRow key={r.id} row={r} onOpen={navigate} />
                ))}
              </section>
            ) : null
          )}

          {/* ══ THE CLOSING CHECKLIST (migration 335) — one per deal, applied
              from a closing template. THE DEFAULT ITEM SET IS THE OWNER'S
              CALL: applying creates the checklist and items are added by hand
              until the owner names the defaults, which the empty state says
              rather than seeding a list nobody signed off. ══ */}
          {view === 'close' && dealsReady && closing.length > 0 && (
            <section className="space-y-3" data-testid="closing-checklists">
              {/* The checklist is the closing workspace's (DE08b, the next
                  part of DX8); it stays here until that workspace has a
                  route, so no capability is lost to the list. */}
              <h3 className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Closing checklists</h3>
              {closing.map((d) => {
                const list = checklists[d.id];
                return (
                  <div key={d.id} className="rounded-[10px] border border-axal-hairline bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900" data-testid={`checklist-deal-${d.id}`}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Eyebrow>{d.project_name || `Deal #${d.id}`}</Eyebrow>
                      {list && list !== UNAVAILABLE ? (
                        <span className="ml-auto text-[10px] text-gray-500 dark:text-gray-400">
                          {list.items.filter((i) => i.state === 'done').length} of {list.items.length} done
                          {list.template_slug ? ` · ${TEMPLATE_LABEL[list.template_slug] || list.template_slug}` : ''}
                        </span>
                      ) : null}
                    </div>
                    {list === UNAVAILABLE ? (
                      <p className="mt-2 text-[11.5px] text-red-700 dark:text-red-300" role="alert">
                        The checklist could not be read. That is not a claim that nothing is on it.
                        <button type="button" onClick={load} className="ml-1 underline">Retry</button>
                      </p>
                    ) : !list ? (
                      <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
                        No closing checklist is applied to this deal.{canOperate ? ' Apply a template above — the SAFE, the stock purchase agreement or the subscription agreement.' : ''}
                        {' '}The default item set is the owner’s call, so a fresh checklist starts empty and items are added by hand.
                      </p>
                    ) : (
                      <>
                        {list.items.length === 0 ? (
                          <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid={`checklist-empty-${d.id}`}>
                            Applied and empty: the default item set is the owner’s call, so nothing is seeded. Add the items counsel will check.
                          </p>
                        ) : (
                          <div className="mt-2 divide-y divide-gray-50 dark:divide-gray-800/60">
                            {list.items.map((item) => (
                              <div key={item.uid} className="flex flex-wrap items-center gap-2 py-2" data-testid={`checklist-item-${item.uid}`}>
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${ITEM_STATE_CLASS[item.state] || ITEM_STATE_CLASS.pending}`}>{item.state}</span>
                                <span className="min-w-0 flex-1 text-[12px] text-gray-800 dark:text-gray-200">
                                  {item.label}
                                  {item.note ? <small className="block text-[10.5px] text-gray-500 dark:text-gray-400">{item.note}</small> : null}
                                </span>
                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                  {item.state === 'done' && item.done_at ? `${day(item.done_at)}${item.done_by_name ? ` · ${item.done_by_name}` : ''}` : ''}
                                </span>
                                {canOperate && item.state !== 'done' && (
                                  <span className="inline-flex gap-1.5">
                                    <button type="button" onClick={() => setItemState(d.id, item.uid, 'done')} data-testid={`button-item-done-${item.uid}`} className="text-[10.5px] font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400">Done</button>
                                    <button type="button" onClick={() => setItemState(d.id, item.uid, item.state === 'blocked' ? 'pending' : 'blocked')} data-testid={`button-item-blocked-${item.uid}`} className="text-[10.5px] font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-400">{item.state === 'blocked' ? 'Unblock' : 'Block'}</button>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {canOperate && (
                          <div className="mt-2 flex gap-2">
                            <input
                              value={itemForms[d.id]?.label || ''}
                              onChange={(e) => setItemForms((current) => ({ ...current, [d.id]: { label: e.target.value, busy: false } }))}
                              placeholder="Add an item counsel will check"
                              aria-label={`Add a checklist item for ${d.project_name || `deal ${d.id}`}`}
                              data-testid={`input-checklist-item-${d.id}`}
                              className="min-w-0 flex-1 rounded-[7px] border border-gray-200 bg-white px-2 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                            />
                            <button
                              type="button"
                              onClick={() => addItem(d.id)}
                              disabled={itemForms[d.id]?.busy || !String(itemForms[d.id]?.label || '').trim()}
                              data-testid={`button-checklist-add-${d.id}`}
                              className="rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                            >
                              Add item
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* ══ THE BLOCKING VIEW — open Commit conditions on these deals ══ */}
          {view === 'blocking' && (
            !condReady ? (
              <p className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300" role="alert" data-testid="status-blocking-unreadable">
                The conditions record could not be read. That is not a claim that nothing is blocking.
                <button type="button" onClick={load} className="ml-1 inline-flex items-center gap-1 underline">Retry</button>
              </p>
            ) : (
              <Instrument
                testid="closing-blocking"
                title="Blocking"
                meta="Open conditions carried from the Commit vote"
                cols="2fr 1.1fr 1.2fr .9fr"
                head={['Condition', 'Deal', 'Decision', 'Open since']}
                rows={visibleBlocking.map((cond) => ({
                  key: cond.uid,
                  cells: [
                    { text: cond.body },
                    {
                      text: closing.find((d) => d.id === cond.deal_id)?.project_name || `Deal #${cond.deal_id}`,
                      node: cond.deal_id ? <OpenDeal id={cond.deal_id} onOpen={navigate} /> : undefined,
                    },
                    { text: cond.decision_title || cond.decision_uid },
                    day(cond.created_at) ? { text: day(cond.created_at) } : { nr: true },
                  ],
                }))}
                note={
                  'A blocking item is a Commit condition that is still open — recorded in the commit room, '
                  + 'not typed here, which is why it can gate the wire: a condition that lived only in the '
                  + 'minutes is a condition nobody enforces. The decision’s author or an admin marks one met '
                  + 'or waived there.'
                }
              />
            )
          )}

          {/* ══ THE WIRES VIEW — the recorded transfers out (migration 335) ══ */}
          {view === 'wires' && (
            !wiresReady ? (
              <p className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300" role="alert" data-testid="status-wires-unreadable">
                The transfers record could not be read. That is not a claim that no money has moved.
                <button type="button" onClick={load} className="ml-1 inline-flex items-center gap-1 underline">Retry</button>
              </p>
            ) : (
              <Instrument
                testid="closing-wires"
                title="Recorded transfers"
                meta="Recorded, not moved here — the platform records the movement of money"
                cols="1.2fr .9fr 1.1fr .9fr 1fr"
                head={['Deal', 'Amount', 'Reference', 'Phone-verified', 'Recorded']}
                rows={visibleWires.map((t) => ({
                  key: t.uid,
                  cells: [
                    {
                      text: t.project_name || `Deal #${t.deal_id}`,
                      node: <OpenDeal id={t.deal_id} onOpen={navigate} />,
                    },
                    { text: dealMoneyExact(Number(t.amount_cents) / 100) || '', sub: t.note || undefined },
                    t.reference ? { text: t.reference } : { nr: true },
                    t.phone_verified
                      ? { text: '', pill: 'phone-verified', pillTone: 'ok' }
                      : { text: 'not recorded', sub: 'email-only verification is how funds get defrauded' },
                    { text: day(t.recorded_at) || '', sub: t.recorded_by_name ? `by ${t.recorded_by_name}` : undefined },
                  ],
                }))}
                note={
                  'Every row is a transfer someone recorded, with who and when. An open IC condition on the '
                  + 'deal refuses the recording — the wire waits on the commit room, which is the conditions '
                  + 'store doing its job.'
                }
              />
            )
          )}

          {/* ══ THE COLLECTION THIS STAGE ACTUALLY HAS ══════════════════════ */}
          {view === 'documents' && !joinedReady && deals !== null && envelopes !== null && (
            <p className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300" role="alert" data-testid="status-paper-unreadable">
              {dealsReady ? 'The signature archive could not be read.' : 'The deal record could not be read.'} That is not a claim that no paper is raised.
              <button type="button" onClick={load} className="ml-1 inline-flex items-center gap-1 underline">Retry</button>
            </p>
          )}
          {view === 'documents' && joinedReady && (
          <Instrument
            testid="closing-paper"
            title="Closing paper"
            meta="Every envelope on a deal at closing, drafts included"
            cols="1.6fr 1.1fr .8fr .8fr 1fr"
            head={['Document', 'Deal', 'State', 'Signatures', 'Executed']}
            rows={visible.map((e) => ({
              key: e.id,
              cells: [
                {
                  text: e.document_title || e.document_type || '',
                  sub: e.document_title && e.document_type ? e.document_type : undefined,
                },
                {
                  text: e.deal?.project_name || `Deal #${e.deal_id}`,
                  node: <OpenDeal id={e.deal_id} onOpen={navigate} />,
                },
                { text: '', pill: paperWord(e.status), pillTone: STATUS_TONE[e.status] || 'neutral' },
                Number.isFinite(Number(e.recipient_count)) && Number(e.recipient_count) > 0
                  ? { text: `${e.signed_count ?? 0} of ${e.recipient_count}` }
                  : { nr: true, sub: 'no recipient recorded' },
                day(e.completed_at) ? { text: day(e.completed_at) } : { nr: true, sub: 'not executed' },
              ],
            }))}
            note={
              'This is the paper: every envelope raised against a deal at closing, with how many of its '
              + 'recipients have signed and when it was executed. An envelope is executed only when its '
              + 'STATUS says completed; a signature count reaching its recipient count '
              + 'is a different fact, and an envelope that records no recipient at all would read as fully '
              + 'signed under a ratio, so it renders as unrecorded instead.'
            }
          />
          )}

          <ZoneDraft
            surface="deals/closing"
            railOption="draft:closing-cover-note"
            label="Proposal · closing packet cover note"
            accept="Open the note"
            run="Draft the note"
            foot="Screened before it leaves the firm."
            empty="A cover for counsel: what is executed, what is still out, and what the record does not cover — stating plainly that the platform records the movement of money rather than moving it."
            nothingToDraft="No deal is at closing, so there is no packet to write a cover for."
          />

          <StatedLimit title="What closing does not record">
            <p data-testid="closing-waits-on-overview">
              <strong>The list is joined here, from five reads.</strong> The
              deals, the paper, the open conditions and the transfers are read
              once each, and each deal at closing has its checklist read on its
              own. The investment is the round&rsquo;s confirmed commitments.
              One closing read is planned to replace them and add what they do
              not carry: {WAITS_ON_OVERVIEW.join('; ')}.
            </p>
            <p>
              <strong>The checklist above is the closing store, not the
              diligence one.</strong> The two checklist stores that predate it
              — <code>dd_checklist_items</code> and{' '}
              <code>diligence_checklists</code> — belong to DILIGENCE and are
              not read here: showing them would relabel diligence work as
              closing work on a screen a fund hands to counsel. What this page
              draws is migration 335&rsquo;s own tables.
            </p>
            <p className="mt-2">
              <strong>The checklist store exists now; its default item set is
              the owner&rsquo;s call.</strong> <code>legal_templates</code>{' '}
              ships the SAFE agreement, the stock purchase agreement and the
              subscription agreement, and <em>Apply template</em> applies one
              to a deal&rsquo;s closing checklist (migration 335). What nobody
              has signed off is the list of items a fresh checklist starts
              with — so one starts empty and items are added by hand, and this
              paragraph is where that decision is named as missing.
            </p>
            <p className="mt-2">
              <strong>A wire out is recorded, not moved.</strong>{' '}
              <code>deal_transfers</code> records a transfer out to a company —
              integer cents, a reference, a phone-verified flag, who recorded
              it — and an open Commit condition on the deal refuses the
              recording. <code>capital_calls</code> remains the other direction
              (an LP paying INTO the fund). The platform records the movement
              of money it is told about; it does not move it.
            </p>
            <p className="mt-2">
              <strong>Blocking is real, and lives in the commit room.</strong>{' '}
              A blocking item is a Commit condition that is still open —
              recorded against the decision in{' '}
              <a className="underline underline-offset-2" href="/deals/commit">the commit room</a>{' '}
              and read here, never typed locally. The artboard&rsquo;s note says
              its blocking item &ldquo;arrived from the Commit vote&rdquo;; that
              hand-off is the store now (migration 334), and the{' '}
              <em>Blocking</em> chip above lists every open one on a deal at
              closing.
            </p>
          </StatedLimit>
        </div>
        {/* D840 (#2349): the investor's own outgoing wires, proposed against their commitments; recorded only on Accept. */}
        <FromMercury section="closing" />
      </ZoneBody>
    </>
  );
}
