import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { adminLabApi } from '../../../lib/api/adminLab';
import { Chart, ChartTable, Legend, Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { dataOf, etDay, isFailed, refusalText } from './labDesksModel';
import {
  CARD, Chip, Dialog, EYE, Field, H2, INPUT, LINK, MONO, Pill, Radios, ReadState, SUB, Select, TD, TH, hasRows, useRead, useWrite,
} from './labParts';
import {
  GRACE_MAX, GRACE_MIN, GRACE_PRESETS, INCORPORATED_FILTERS, MODERATION_WORDS, PAGE_SIZE, PARTICIPANTS_PATH, PARTICIPANT_REFUSALS,
  REASON_MAX, SORTS, STATUS_FILTERS, STATUS_WORDS, THIS_WEEK_FILTERS, WEEK_FILTERS, CODE_RE,
  cannotDecide, cohortOptions, cohortWord, graceCopy, graceHours, historyRows, participantOf, participantRow,
  queryOf, reasonLeft, reasonOk, standingOf, stripText, thisWeekOf, toolsOf, unreadLines, weekCards, weekCopy, workspaceCopy,
} from './participantsModel';

/**
 * D949 (#2754) — Participants (SL7) and one participant (SL8), from D946's
 * read (`GET /api/admin/cohort/participants` and `…/:uid`). The Worker filters,
 * sorts and pages over every participant; this page asks for one page at a
 * time and draws what comes back:
 *   · the two segments, Needs a decision and Everyone, with the read's counts;
 *   · "Where [cohort] stands", a bar or its table;
 *   · search, cohort, status, week, this week, incorporated and the sort;
 *   · the table (cards on a phone), each row opening the founder at
 *     `/participants/:uid`, with ⋯'s Give grace, Change this week, Open
 *     workspace and Open moderation case;
 *   · SL8's drawer: the strip, the four weeks and their checklists, the tools,
 *     moderation and history.
 * Every change opens an in-page dialog (SL8a–c): grace (1–168 hours, a reason),
 * change the week (passed or failed, a reason), and open the workspace (a
 * reason of ten characters or more, and a recent authenticator code). No
 * browser pop-up. A read that failed says so; nothing is a zero for it.
 * A row's door to its founder is written out (`to={\`/admin/…/${uid}\`}`), so the
 * reachability walk finds `/participants/:uid`.
 */

const BTN_SM = 'inline-flex min-h-[32px] items-center rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

function Bar({ pct }) {
  return (
    <span aria-hidden="true" className="mt-1 block h-[5px] w-[70px] overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-700">
      <span className="block h-full bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}

/** ⋯ for one row: a disclosure of its four actions, each a dialog or a link. */
function RowMenu({ row, onAction }) {
  const [open, setOpen] = useState(false);
  const pick = (kind) => { setOpen(false); onAction(kind, row); };
  return (
    <span className="relative inline-block">
      <button type="button" aria-expanded={open} aria-label={`Actions for ${row.name}`} className={BTN_SM} onClick={() => setOpen((o) => !o)} data-testid={`lab-part-menu-${row.uid}`}>⋯</button>
      {open ? (
        <span className="absolute right-0 z-10 mt-1 flex min-w-[12rem] flex-col rounded-[10px] border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`lab-part-menu-${row.uid}-list`}>
          <button type="button" className="rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-axal-ground dark:hover:bg-gray-800" onClick={() => pick('grace')} data-testid={`lab-part-grace-${row.uid}`}>Give grace</button>
          <button type="button" className="rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-axal-ground dark:hover:bg-gray-800" onClick={() => pick('week')} data-testid={`lab-part-week-${row.uid}`}>Change this week</button>
          <button type="button" className="rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-axal-ground dark:hover:bg-gray-800" onClick={() => pick('workspace')} data-testid={`lab-part-workspace-${row.uid}`}>Open workspace</button>
          {row.moderation.muted ? null : (
            <Link to="/admin/spinout-moderation" className="rounded-[7px] px-2.5 py-2 text-[13px] hover:bg-axal-ground dark:hover:bg-gray-800" data-testid={`lab-part-case-${row.uid}`}>Open moderation case</Link>
          )}
        </span>
      ) : null}
    </span>
  );
}

function Standing({ data, cohort }) {
  const [table, setTable] = useState(false);
  const s = standingOf(data, cohortWord(cohort));
  if (!s) return null;
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="lab-h-standing" data-testid="lab-part-standing">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="lab-h-standing" className={H2}>{s.title}</h2>
        <button type="button" className={LINK} aria-pressed={table} onClick={() => setTable((t) => !t)} data-testid="lab-part-standing-toggle">{table ? 'View as chart' : 'View as table'}</button>
      </div>
      <span className={`${MONO} text-axal-muted dark:text-gray-400`}>{s.head}</span>
      {table
        ? <div data-testid="lab-part-standing-table"><ChartTable chart={s.chart} caption={s.alt} /></div>
        : <div role="img" aria-label={s.alt} data-testid="lab-part-standing-chart"><Chart chart={s.chart} /></div>}
      <Legend items={s.legend} />
      {s.lines.map((l) => <p key={l} className={`m-0 ${SUB}`}>{l}</p>)}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The three dialogs (SL8a–c)
 * ------------------------------------------------------------------ */

function ReasonField({ value, onChange, label, disabled, testId }) {
  return (
    <Field label={label}>
      <textarea value={value} rows={3} maxLength={REASON_MAX} disabled={disabled} onChange={(e) => onChange(e.target.value.slice(0, REASON_MAX))}
        className={`${INPUT} py-2 leading-normal`} data-testid={testId} />
    </Field>
  );
}

function GraceDialog({ row, onClose, onChanged, now }) {
  const [preset, setPreset] = useState(null);
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState('');
  const w = useWrite(onChanged, PARTICIPANT_REFUSALS, refusalText);
  const hours = preset === 'custom' ? graceHours(custom) : preset;
  const copy = graceCopy(row, hours, now);
  const ready = Boolean(hours) && reason.trim().length > 0;
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!ready} testId="lab-part-grace"
      onAction={() => w.run(() => api.adminCohortGrace({ user_id: row.userId, cycle_id: row.cycleId, week: row.decideWeek, hours, reason: reason.trim() }))}
      done={copy.done(w.reply)}>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={EYE}>Hours</legend>
        <span className="flex flex-wrap gap-2">
          {GRACE_PRESETS.map((h) => <Chip key={h} on={preset === h} onClick={() => setPreset(h)} testId={`lab-part-grace-${h}`}>{h}</Chip>)}
          <Chip on={preset === 'custom'} onClick={() => setPreset('custom')} testId="lab-part-grace-custom">{`Custom · ${GRACE_MIN} to ${GRACE_MAX}`}</Chip>
        </span>
        {preset === 'custom' ? (
          <input type="number" min={GRACE_MIN} max={GRACE_MAX} step={1} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Hours, 1 to 168"
            className={`${INPUT} w-32`} data-testid="lab-part-grace-hours" />
        ) : null}
      </fieldset>
      <ReasonField value={reason} onChange={setReason} label="Reason · required" disabled={Boolean(w.reply)} testId="lab-part-grace-reason" />
      <p className={`m-0 ${MONO}`} data-testid="lab-part-grace-cutoff">{copy.cutoff}</p>
    </Dialog>
  );
}

function WeekDialog({ row, onClose, onChanged }) {
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const w = useWrite(onChanged, PARTICIPANT_REFUSALS, refusalText);
  const copy = weekCopy(row);
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!decision || !reason.trim()} testId="lab-part-week"
      onAction={() => w.run(() => api.adminCohortOverride({ user_id: row.userId, cycle_id: row.cycleId, week: row.decideWeek, decision, reason: reason.trim() }))}
      done={copy.done(decision)}>
      <Radios name="lab-part-week" value={decision} onChange={setDecision} disabled={Boolean(w.reply)} testId="lab-part-week-choice"
        options={copy.options.map((o) => ({ value: o.value, label: `${o.label} · ${o.line}` }))} />
      <ReasonField value={reason} onChange={setReason} label="Reason · required" disabled={Boolean(w.reply)} testId="lab-part-week-reason" />
    </Dialog>
  );
}

function WorkspaceDialog({ row, onClose, onImpersonate }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const w = useWrite(() => {}, PARTICIPANT_REFUSALS, refusalText);
  const copy = workspaceCopy(row);
  const ready = reasonOk(reason) && CODE_RE.test(code);
  // The code is confirmed first (`POST /auth/step-up`), so the session the Worker opens is a recent one.
  const open = () => w.run(async () => {
    await api.stepUp(code);
    const res = await api.adminImpersonate(row.userId, reason.trim());
    if (onImpersonate) onImpersonate(res.token, res.user, '/spinout-lab');
    else navigate('/spinout-lab');
    return res;
  });
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!ready} testId="lab-part-workspace" onAction={open}>
      <ReasonField value={reason} onChange={setReason} label={copy.reasonLabel} disabled={w.busy} testId="lab-part-workspace-reason" />
      {reason.trim() && reasonLeft(reason) ? <p className={`m-0 ${SUB}`} data-testid="lab-part-workspace-left">{`${reasonLeft(reason)} more ${reasonLeft(reason) === 1 ? 'character' : 'characters'}.`}</p> : null}
      <Field label={copy.codeLabel}>
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={`${INPUT} w-40 font-mono tracking-[.3em]`} data-testid="lab-part-workspace-code" />
      </Field>
      <p className={`m-0 ${SUB}`}>{copy.codeSub}</p>
    </Dialog>
  );
}

/** Whichever dialog the admin opened, or the sentence that says why it cannot open. */
function ActionDialog({ dialog, onClose, onChanged, onImpersonate, now }) {
  const why = dialog.kind === 'workspace' ? (dialog.row.userId ? null : cannotDecide(dialog.row)) : cannotDecide(dialog.row);
  if (why) {
    return (
      <Lightbox label="Cannot change this" title="Cannot change this" onClose={onClose} testId="lab-part-cannot" pageBelow="lg"
        footer={<div className="flex justify-end"><button type="button" className={actionPrimary} onClick={onClose}>Close</button></div>}>
        <p className="m-0 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100" data-testid="lab-part-cannot-why">{why}</p>
      </Lightbox>
    );
  }
  if (dialog.kind === 'grace') return <GraceDialog row={dialog.row} onClose={onClose} onChanged={onChanged} now={now} />;
  if (dialog.kind === 'week') return <WeekDialog row={dialog.row} onClose={onClose} onChanged={onChanged} />;
  return <WorkspaceDialog row={dialog.row} onClose={onClose} onImpersonate={onImpersonate} />;
}

/* ------------------------------------------------------------------ *
 * One participant (SL8)
 * ------------------------------------------------------------------ */

function Drawer({ uid, tick, onClose, onAction, onRetry, now }) {
  const read = useRead(`participant:${uid}`, tick, () => adminLabApi.participant(uid).then((r) => {
    if (!r?.participant) throw new Error('The participant did not come back.');
    return r;
  }));
  const d = dataOf(read);
  const p = d?.participant;
  const row = p ? participantRow(p, now) : null;
  const weeks = d ? weekCards(d, now) : null;
  const tools = d ? toolsOf(d) : null;
  const history = d ? historyRows(d, now) : null;
  const tw = p ? thisWeekOf(p.this_week) : null;
  const notFound = isFailed(read) && Number(read.error?.status) === 404;
  return (
    <Lightbox label={p?.name || 'Participant'} title={p?.name || 'Participant'} sub={row ? [row.company, row.sector].filter(Boolean).join(' · ') : null}
      onClose={onClose} testId="lab-part-drawer" pageBelow="lg"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {row ? (
            <>
              <button type="button" className={actionGhost} onClick={() => onAction('grace', row)} data-testid="lab-part-drawer-grace">Give grace</button>
              <button type="button" className={actionGhost} onClick={() => onAction('week', row)} data-testid="lab-part-drawer-week">Change this week</button>
            </>
          ) : null}
          <button type="button" className={actionGhost} onClick={onClose}>Close</button>
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        {notFound ? <p className="m-0 text-[13px]" data-testid="lab-part-drawer-missing">No Lab participant has this address. They may have left the Lab.</p> : null}
        {notFound ? null : <ReadState read={read} what="This participant" claim="Nothing about them is shown while they cannot be read." onRetry={onRetry} testId="lab-part-drawer-read" />}
        {row ? (
          <>
            <span className="flex flex-wrap items-center gap-2">
              <Pill tone="muted">{STATUS_WORDS[p.status] || 'Status not read'}</Pill>
              {p.cohort ? <Pill tone="violet" glyph="◆">{cohortWord(p.cohort)}</Pill> : null}
              {tw ? <Pill tone={tw.tone} glyph={tw.glyph}>{tw.word}</Pill> : null}
              <button type="button" className={`${BTN_SM} ml-auto`} onClick={() => onAction('workspace', row)} data-testid="lab-part-drawer-workspace">Open workspace</button>
            </span>
            <p className={`m-0 rounded-[10px] border border-axal-hairline px-3 py-2 ${MONO} dark:border-gray-700`} data-testid="lab-part-strip">{stripText(p, now)}</p>
            {unreadLines(d).map((l) => <p key={l} role="status" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">{l}</p>)}
            {weeks === null ? (
              <p className={`m-0 ${SUB}`} data-testid="lab-part-weeks-none">{p.status === 'active' ? 'The weeks could not be read for this founder.' : 'Not in a cohort now, so there are no weeks to show.'}</p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2" data-testid="lab-part-weeks">
                {weeks.map((wk) => (
                  <section key={wk.week} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`lab-part-week-card-${wk.week}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{`Week ${wk.week}`}</h3>
                      <Pill tone={wk.status.tone}>{wk.status.word}</Pill>
                    </span>
                    <span className={`${MONO} text-axal-muted dark:text-gray-400`}>{wk.deadline ? `Deadline ${wk.deadline}` : 'Deadline not recorded'}</span>
                    {wk.items === null ? <span className={SUB}>The checklist could not be read.</span> : (
                      <ul className="m-0 flex list-none flex-col p-0">
                        {wk.items.map((it) => (
                          <li key={it.key} className="flex gap-2 border-t border-axal-hairline py-1 text-[12.5px] dark:border-gray-700">
                            <span aria-hidden="true" className={it.done ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-muted dark:text-gray-400'}>{it.done ? '✓' : '○'}</span>
                            <span>{it.word}<span className="sr-only">{it.done ? ', done' : ', not done'}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            )}
            <section className="flex flex-col gap-1.5" data-testid="lab-part-tools">
              <h3 className="m-0 text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">{tools ? tools.title : 'Tools unlocked'}</h3>
              {tools ? (
                <span className="flex flex-wrap gap-1.5">
                  {tools.tools.map((t) => <Pill key={t.key} tone={t.on ? 'violet' : 'muted'} glyph={t.on ? '✓' : '○'}>{t.on ? t.word : `${t.word} · locked`}</Pill>)}
                </span>
              ) : <span className={SUB}>Which tools are unlocked could not be read.</span>}
            </section>
            <section className="flex flex-col gap-1" data-testid="lab-part-moderation">
              <h3 className="m-0 text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">Moderation</h3>
              {p.moderation === undefined ? <span className={SUB}>Moderation cases could not be read.</span> : p.moderation === null ? <span className="text-[13px]">No open case</span> : (
                <span className="flex flex-wrap items-center gap-2 text-[13px]">
                  {`${MODERATION_WORDS[p.moderation.state] || 'An open case'} since ${etDay(p.moderation.since, now) || 'a date not recorded'}`}
                  <Link to="/admin/spinout-moderation" className={LINK}>Open case</Link>
                </span>
              )}
            </section>
            <section className="flex flex-col gap-1" data-testid="lab-part-history">
              <h3 className="m-0 text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">History</h3>
              {history === null ? <span className={SUB}>The week decisions could not be read.</span> : history.length === 0 ? <span className={SUB}>No week has been decided yet.</span> : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {history.map((h) => (
                    <li key={h.key} className="flex flex-wrap justify-between gap-2 border-t border-axal-hairline py-1.5 text-[13px] dark:border-gray-700">
                      <span>{h.text}</span><span className={`${MONO} text-axal-muted dark:text-gray-400`}>{h.at}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * The list (SL7)
 * ------------------------------------------------------------------ */

export default function LabParticipants({ onImpersonate, now = Date.now() }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const uid = participantOf(loc.pathname);
  const [f, setF] = useState({ show: 'needs', cohort: '', status: '', week: '', thisWeek: '', incorporated: '', q: '', sort: 'days_left', page: 1 });
  const [typed, setTyped] = useState('');
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const reload = () => setTick((t) => t + 1);
  const query = queryOf(f);
  const read = useRead(`participants:${JSON.stringify(query)}`, tick, () => adminLabApi.participants(query).then((r) => {
    if (!Array.isArray(r?.items)) throw new Error('The participants did not come back as a list.');
    return r;
  }));
  const timeline = useRead('timeline', 0, () => api.adminCohortTimeline());
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v, page: 1 }));
  const d = dataOf(read);
  const rows = (d?.items || []).map((r) => participantRow(r, now));
  const total = Number(d?.total) || 0;
  const from = rows.length ? f.page * PAGE_SIZE - PAGE_SIZE + 1 : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const s = d?.standing;
  const onAction = (kind, row) => setDialog({ kind, row });

  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-participants">
      <section className={`${CARD} flex flex-wrap items-center gap-2.5 px-[18px] py-3`} aria-label="Show">
        <span className={EYE}>Show</span>
        <span className="flex flex-wrap gap-2" role="group" aria-label="Show">
          <Chip on={f.show === 'needs'} onClick={() => set('show')('needs')} testId="lab-part-show-needs">
            Needs a decision{s ? <span className="font-mono" data-testid="lab-part-count-needs">{Number(s.needs_decision).toLocaleString('en-US')}</span> : null}
          </Chip>
          <Chip on={f.show === 'everyone'} onClick={() => set('show')('everyone')} testId="lab-part-show-everyone">
            Everyone{s ? <span className="font-mono" data-testid="lab-part-count-everyone">{Number(s.everyone).toLocaleString('en-US')}</span> : null}
          </Chip>
        </span>
      </section>

      {d ? <Standing data={d} cohort={f.cohort} /> : null}

      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Participants">
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); set('q')(typed); }} role="search">
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search founder or company" aria-label="Search founder or company"
            className={`${INPUT} min-w-[14rem] flex-1`} data-testid="lab-part-search" />
          <button type="submit" className={actionGhost} data-testid="lab-part-search-go">Search</button>
          <Select label="Cohort" value={f.cohort} onChange={set('cohort')} options={cohortOptions(timeline)} testId="lab-part-cohort" />
          <Select label="Status" value={f.status} onChange={set('status')} options={STATUS_FILTERS} testId="lab-part-status" />
          <Select label="Week" value={f.week} onChange={set('week')} options={WEEK_FILTERS} testId="lab-part-weekf" />
          <Select label="This week" value={f.thisWeek} onChange={set('thisWeek')} options={THIS_WEEK_FILTERS} testId="lab-part-this-week" />
          <Select label="Incorporated" value={f.incorporated} onChange={set('incorporated')} options={INCORPORATED_FILTERS} testId="lab-part-incorporated" />
          <Select label="Sort" value={f.sort} onChange={set('sort')} options={SORTS.map((o) => ({ value: o.key, label: `Sort: ${o.label}` }))} testId="lab-part-sort" />
        </form>
        <ReadState read={read} what="The participants" claim="No founder is shown as on track while they cannot be read." onRetry={reload} testId="lab-part-read" />
        {isFailed(timeline) ? <p className={`m-0 ${SUB}`} data-testid="lab-part-cohorts-unread">The cohort calendar could not be read, so the cohort filter lists none.</p> : null}
        {hasRows(read) ? (
          <>
            {unreadLines(d).map((l) => <p key={l} role="status" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="lab-part-unread">{l}</p>)}
            {d.truncated ? <p className={`m-0 ${SUB}`} data-testid="lab-part-truncated">The read stopped at 5,000 participants, so some may not be listed.</p> : null}
            {!rows.length ? (
              <p className={`m-0 ${SUB}`} data-testid="lab-part-empty">
                {f.show === 'needs' && !f.q && !f.cohort && !f.status && !f.week && !f.thisWeek && !f.incorporated ? 'Nothing needs a decision now.' : 'No founder matches these filters.'}
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1100px] border-collapse" data-testid="lab-part-table">
                    <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                      {['Founder', 'Company', 'Cohort', 'Week · day', 'Progress', 'This week', 'Deadline', 'Missing', 'Moderation', ''].map((c, i) => (
                        <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.uid} className="border-b border-axal-hairline last:border-b-0 dark:border-gray-700" data-testid={`lab-part-row-${r.uid}`}>
                          <td className={TD}><Link to={`/admin/programs/spinout-lab/participants/${encodeURIComponent(r.uid)}`} className="font-bold text-axal-ink underline decoration-dotted underline-offset-2 dark:text-gray-100" data-testid={`lab-part-open-${r.uid}`}>{r.name}</Link></td>
                          <td className={TD}><span className="block font-bold">{r.company}</span>{r.sector ? <span className={SUB}>{r.sector}</span> : null}</td>
                          <td className={`${TD} ${MONO}`}>{r.cohort}</td>
                          <td className={`${TD} ${MONO}`}>{r.weekDay}</td>
                          <td className={`${TD} ${MONO}`}>{r.progress ? <>{r.progress.text}<Bar pct={r.progress.pct} /></> : 'Not read'}</td>
                          <td className={TD}><Pill tone={r.thisWeek.tone} glyph={r.thisWeek.glyph}>{r.thisWeek.word}</Pill>{r.thisWeek.sub ? <span className={`mt-1 block ${SUB}`}>{r.thisWeek.sub}</span> : null}</td>
                          <td className={`${TD} ${MONO}`}>{r.deadline || '—'}</td>
                          <td className={`${TD} text-[12.5px] leading-snug`}>{r.missing ?? 'Not read'}</td>
                          <td className={`${TD} text-[12.5px] ${r.moderation.muted ? 'text-axal-muted dark:text-gray-400' : ''}`}>{r.moderation.text}</td>
                          <td className={TD}><RowMenu row={r} onAction={onAction} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden" data-testid="lab-part-cards">
                  {rows.map((r) => (
                    <li key={r.uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid={`lab-part-card-${r.uid}`}>
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link to={`/admin/programs/spinout-lab/participants/${encodeURIComponent(r.uid)}`} className="font-bold text-axal-ink dark:text-gray-100">{r.company}</Link>
                        <Pill tone={r.thisWeek.tone} glyph={r.thisWeek.glyph}>{r.thisWeek.word}</Pill>
                      </span>
                      <span className={SUB}>{[r.name, r.cohort, r.weekDay, r.progress ? r.progress.text : null].filter(Boolean).join(' · ')}</span>
                      {r.deadline ? <span className={`${MONO} text-axal-muted dark:text-gray-400`}>{`Deadline ${r.deadline}`}</span> : null}
                      <span className="flex justify-end"><RowMenu row={r} onAction={onAction} /></span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2" data-testid="lab-part-pager">
                  <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{total ? `${from.toLocaleString('en-US')}–${(from + rows.length - 1).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : 'None'}</span>
                  {pages > 1 ? (
                    <span className="flex gap-2">
                      <button type="button" className={actionGhost} disabled={f.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))} data-testid="lab-part-prev">Previous</button>
                      <button type="button" className={actionGhost} disabled={f.page >= pages} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))} data-testid="lab-part-next">Next</button>
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </>
        ) : null}
        <p className={`m-0 ${SUB}`}>The Lab’s clock decides each week at its deadline. You can give grace or change the outcome, with a reason. Progress counts required items. ⋯ holds Give grace, Change this week, Open workspace and Open moderation case. Times are ET.</p>
      </section>

      {uid ? <Drawer uid={uid} tick={tick} onClose={() => navigate(PARTICIPANTS_PATH)} onAction={onAction} onRetry={reload} now={now} /> : null}
      {dialog ? <ActionDialog key={`${dialog.kind}-${dialog.row.uid}`} dialog={dialog} onClose={() => setDialog(null)} onChanged={reload} onImpersonate={onImpersonate} now={now} /> : null}
    </div>
  );
}
