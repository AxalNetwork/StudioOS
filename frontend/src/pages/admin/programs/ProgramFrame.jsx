import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lightbox, usePhoneWidth } from '../../../ui';
import { programsApi } from '../../../lib/api/programs';
import { DIALOG_BODY, DIALOG_LINES, DialogButtons, GrantBadge, MovedNotice, StatusPill, SUB, Unread } from './parts';
import { NOT_RECORDED, PAGES, crumbText, grantBadgeOf, movedNotice, programByKey, withoutMoved } from './programsModel';
import { CSV_DONE, CSV_LINES, CSV_PROGRAMS, refusalSentence } from './programPagesModel';

const CRUMB = 'font-mono text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const CRUMB_LINK = 'text-axal-muted hover:text-axal-violet dark:text-gray-400 dark:hover:text-violet-300';

/**
 * D953 (#2371) — the frame every program page draws inside its routed file's
 * `AdminBoardFrame`: the crumb "Programs › [Program]" ("‹ Programs" on a
 * phone) back to the catalogue, the header (the title at 24 px, the status
 * pill and grant badge as on the card, the program's line, and the facts
 * strip where the canvas draws one), the moved notice where a redirect lands,
 * then the tab strip and the tab. A page that passes `actionsOnPhone`
 * false draws no header buttons on a phone (D962, PG20b).
 *
 * D1124 (#3004): the ⋯ menu holds Download (CSV) on the canvas's program
 * pages that have figures (`CSV_PROGRAMS`). It opens an in-page dialog that
 * says what the file holds, and the Worker makes the file, counts only and
 * logged (`POST /api/admin/programs/:key/export`). Pause waits for OD-PAUSE,
 * so the menu does not offer it.
 */
export default function ProgramFrame({ program, superAdmin = false, actions = null, actionsOnPhone = true, tabs = null, children }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const page = PAGES[program];
  const card = programByKey(program);
  const moved = movedNotice(loc.pathname, loc.search);
  const grantBadge = useGrantBadge(program);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid={`programs-page-${program}`}>
      <nav aria-label="Breadcrumb" className={CRUMB} data-testid="programs-crumb">
        {phone
          ? <Link to="/admin/programs" className={CRUMB_LINK}>{crumbText(program, true)}</Link>
          : <><Link to="/admin/programs" className={CRUMB_LINK}>Programs</Link>{` › ${page.title}`}</>}
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3" data-testid="programs-header">
        <div className="flex min-w-0 flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{page.title}</h1>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill status={card.status} testId="programs-header-status" />
            <GrantBadge grant={superAdmin ? card.hqGrant : card.grant} badge={grantBadge} testId="programs-header-grant" />
          </div>
          {page.line
            ? <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400" data-testid="programs-header-line">{page.line}</p>
            : <Unread word={NOT_RECORDED} reason={page.lineReason} testId="programs-header-line" />}
          {page.whoReason ? <span className={SUB} data-testid="programs-header-who">{`Who: ${NOT_RECORDED}. ${page.whoReason}`}</span> : null}
        </div>
        <div className="flex items-start gap-2">
          {/* D962: a page that draws its own way in on a phone has no header buttons there (PG20b). */}
          {phone && !actionsOnPhone ? null : actions}
          {CSV_PROGRAMS.includes(program) ? <MoreMenu program={program} title={page.title} /> : null}
        </div>
      </header>

      {page.facts ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-axal-hairline bg-white px-3 py-2 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="programs-facts">
          {page.facts.map((f, i) => <span key={f}>{i ? `· ${f}` : f}</span>)}
        </p>
      ) : null}

      <MovedNotice text={moved} onDismiss={() => navigate({ pathname: loc.pathname, search: withoutMoved(loc.search), hash: loc.hash }, { replace: true })} />

      {tabs}
      {children}
    </div>
  );
}

/** D1124: the header's ⋯ menu, with Download (CSV). */
/**
 * D1124 (#3004): the header's badge from D956's `grant` on `/:key` (#2789).
 * Until it answers, or if the read fails, the held mode's constant stands:
 * a failed page read is not a grant state.
 */
function useGrantBadge(program) {
  const [badge, setBadge] = useState(null);
  useEffect(() => {
    let live = true;
    setBadge(null);
    programsApi.program(program).then((d) => { if (live) setBadge(grantBadgeOf(d?.grant)); }, () => {});
    return () => { live = false; };
  }, [program]);
  return badge;
}

function MoreMenu({ program, title }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`More for ${title}`} onClick={() => setOpen((v) => !v)}
        className="min-h-[36px] rounded-[9px] border border-axal-hairline px-3 text-[14px] font-bold dark:border-gray-700" data-testid="programs-more">⋯</button>
      {open ? (
        <div role="menu" className="absolute right-0 top-10 z-20 flex w-52 flex-col rounded-xl border border-axal-hairline bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900" data-testid="programs-more-menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setDialog(true); }}
            className="rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800" data-testid="programs-more-csv">Download (CSV)</button>
        </div>
      ) : null}
      {dialog ? <CsvDialog program={program} title={title} onClose={() => setDialog(false)} /> : null}
    </div>
  );
}

function CsvDialog({ program, title, onClose }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [file, setFile] = useState(null);
  const go = async () => {
    setBusy(true);
    setRefusal('');
    try {
      const r = await programsApi.exportCsv(program, 12);
      if (typeof r?.download_url !== 'string' || !r.download_url) throw new Error('The file did not come back.');
      setFile(r.download_url);
    } catch (e) {
      setRefusal(refusalSentence(e, 'No file was made. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const label = `Download ${title}’s figures as CSV?`;
  return (
    <Lightbox label={label} title={label} sub="The last 12 weeks, this week so far." onClose={onClose} width={480} testId="programs-csv-dialog"
      footer={<DialogButtons onClose={onClose} action="Make the file" busy={busy} onAction={go} refusal={refusal} done={file ? CSV_DONE : null} testId="programs-csv-go" />}>
      <div className={DIALOG_BODY}>
        <ul className={DIALOG_LINES}>{CSV_LINES.map((l) => <li key={l}>{l}</li>)}</ul>
        {file ? <a href={file} download={`${program}.csv`} className="self-start text-[13px] font-bold text-axal-violet underline dark:text-violet-300" data-testid="programs-csv-link">Open the file</a> : null}
      </div>
    </Lightbox>
  );
}
