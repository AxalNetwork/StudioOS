import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Lightbox, actionPrimary } from '../../../ui';
import { programsApi } from '../../../lib/api/programs';
import { reportError } from '../../../lib/log';
import {
  BlockFailed, CARD, DIALOG_BODY, DIALOG_LINES, DialogButtons, Field, H2, SUB, Skeleton,
} from './parts';
import {
  PLAYBOOK_HQ_WRITES, PLAYBOOK_NOT_PUBLISHED, PLAYBOOK_NOT_SET, PUBLISH_LINE, SECTION_BODY_MAX, SECTION_TITLE_MAX,
  playbookFrom, refusalSentence, sectionEdit, versionLine,
} from './programPagesModel';
import { SET_BY_HQ } from './programsModel';

/**
 * D962 (#2795) — How it runs, read from part 1's playbook store (D954 §2) in
 * place of D953's frontend constant, with the playbook editor (PG5s). Mentor
 * draws it first; part 10 (#2796) reuses it for AI-native Venture (PG13s).
 *
 * AN ADMIN reads the published version: each section with its lock and "Set
 * by HQ", and the foot "HQ writes the playbook." A SUPER ADMIN reads the
 * draft, with the version and the edited date, Edit on each section, and
 * Publish changes; each write opens a dialog, and a refusal sits in it as one
 * sentence keyed on its code. A computed section (Mentor's cycle) holds no
 * text: the page draws it through `fill(key)`, and its edit takes a title only.
 */

export function useProgramDetail(program, enabled = true) {
  const [read, setRead] = useState({ status: 'loading', data: null, error: null, at: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    programsApi.program(program).then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null, at: Date.now() }); },
      (error) => { reportError(`admin-programs:playbook:${program}`, error); if (live) setRead({ status: 'error', data: null, error, at: null }); },
    );
    return () => { live = false; };
  }, [program, enabled, tick]);
  return { read, reload, set: (data) => setRead({ status: 'ready', data, error: null, at: Date.now() }) };
}

function EditDialog({ program, section, onClose, onSaved }) {
  const [title, setTitle] = useState(section.title);
  const [body, setBody] = useState(section.lines.join('\n'));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const change = sectionEdit(section, { title, body });
  const save = async () => {
    if (!Object.keys(change).length) return;
    setBusy(true);
    setRefusal('');
    try {
      onSaved(await programsApi.editSection(program, section.key, change));
    } catch (e) {
      setRefusal(refusalSentence(e, 'That section was not saved. Try again.'));
      setBusy(false);
    }
  };
  const label = `Edit ${section.title}`;
  return (
    <Lightbox label={label} title={label} sub="Saved to the draft. Nothing changes for members until you publish." onClose={onClose} testId="programs-playbook-edit-dialog"
      footer={<DialogButtons onClose={onClose} action="Save to draft" busy={busy} disabled={!Object.keys(change).length || !title.trim()} onAction={save} refusal={refusal} testId="programs-playbook-edit-go" />}>
      <div className={DIALOG_BODY}>
        <Field label="Title" value={title} onChange={setTitle} max={SECTION_TITLE_MAX} testId="programs-playbook-edit-title" />
        {section.computed
          ? <p className={`m-0 ${SUB}`} data-testid="programs-playbook-edit-computed">This section is drawn from live data, so it holds no text.</p>
          : <Field label="Text · one line per paragraph" value={body} onChange={setBody} max={SECTION_BODY_MAX} rows={6} testId="programs-playbook-edit-body" />}
      </div>
    </Lightbox>
  );
}

function PublishDialog({ program, pb, onClose, onPublished }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const next = pb.version === null ? 1 : pb.version + 1;
  const go = async () => {
    setBusy(true);
    setRefusal('');
    try {
      onPublished(await programsApi.publish(program));
    } catch (e) {
      setRefusal(refusalSentence(e, 'The playbook was not published. Try again.'));
      setBusy(false);
    }
  };
  const label = `Publish version ${next}?`;
  return (
    <Lightbox label={label} title={label} onClose={onClose} testId="programs-playbook-publish-dialog"
      footer={<DialogButtons onClose={onClose} action="Publish" busy={busy} onAction={go} refusal={refusal} testId="programs-playbook-publish-go" />}>
      <div className={DIALOG_BODY}>
        <ul className={DIALOG_LINES}>
          <li>{PUBLISH_LINE}</li>
          <li>The publish is recorded in this program’s Activity.</li>
        </ul>
      </div>
    </Lightbox>
  );
}

/**
 * The playbook. `fill(key, section)` draws what a read or a link fills in a
 * section (Mentor's cycle, its measures and its terms); a section it does
 * not fill draws its own text, or "Not set".
 */
export default function PlaybookEditor({ program, superAdmin, detail, fill = () => null, testId = 'programs-how' }) {
  const pb = playbookFrom(detail.read, superAdmin);
  const [dialog, setDialog] = useState(null);
  const [done, setDone] = useState('');
  const close = () => setDialog(null);
  const saved = (data, text) => { detail.set(data); setDialog(null); setDone(text); };
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {pb.state === 'loading' ? <Skeleton lines={4} /> : null}
      {pb.state === 'unreadable' ? <BlockFailed what="This program’s playbook" onRetry={detail.reload} testId={`${testId}-unreadable`} /> : null}
      {pb.state === 'ready' && pb.editing ? (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-[18px] py-3`} data-testid={`${testId}-super`}>
          <span className="font-mono text-[12.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid={`${testId}-version`}>{versionLine(pb)}</span>
          <span className="flex flex-wrap items-center gap-2">
            {!pb.differs ? <span className={SUB} data-testid={`${testId}-same`}>The draft is what is published.</span> : null}
            <button type="button" className={actionPrimary} disabled={!pb.differs} onClick={() => { setDone(''); setDialog({ kind: 'publish' }); }} data-testid={`${testId}-publish`}>Publish changes</button>
          </span>
        </div>
      ) : null}
      {done ? <p role="status" className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid={`${testId}-done`}>{done}</p> : null}
      {pb.state === 'ready' && !pb.editing && !pb.published ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-unpublished`}>{PLAYBOOK_NOT_PUBLISHED}</p> : null}
      {pb.state === 'ready' ? pb.sections.map((s) => {
        const filled = fill(s.key, s);
        return (
          <section key={s.key} className={`${CARD} flex min-w-0 flex-col gap-2 px-[18px] py-4`} data-testid={`${testId}-${s.key}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={H2}>{s.title}</h2>
              {pb.editing ? (
                <button type="button" className="text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300" onClick={() => { setDone(''); setDialog({ kind: 'edit', section: s }); }} data-testid={`${testId}-${s.key}-edit`}>Edit</button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  <Lock size={11} aria-hidden="true" />{SET_BY_HQ}
                </span>
              )}
            </div>
            {filled || (s.lines.length
              ? s.lines.map((l) => <p key={l} className="m-0 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100">{l}</p>)
              : (s.computed ? null : <span className="text-[13px] font-bold italic text-axal-muted dark:text-gray-400">{PLAYBOOK_NOT_SET}</span>))}
          </section>
        );
      }) : null}
      {pb.state === 'ready' && !pb.editing ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-foot`}>{PLAYBOOK_HQ_WRITES}</p> : null}
      {dialog?.kind === 'edit' ? <EditDialog program={program} section={dialog.section} onClose={close} onSaved={(d) => saved(d, `${dialog.section.title} saved to the draft.`)} /> : null}
      {dialog?.kind === 'publish' && pb.state === 'ready' ? <PublishDialog program={program} pb={pb} onClose={close} onPublished={(d) => saved(d, 'Published. Admins read this version now.')} /> : null}
    </div>
  );
}
