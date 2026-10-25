import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { labOperationsApi } from '../../../lib/api';
import { actionGhost, actionPrimary } from '../../../ui';
import { CARD, H2, SUB, LINK, INPUT, useRead, Dialog, Field, useWrite } from './labParts';
import { ReadState } from './labOperationsParts';
import { refusalText } from './labDesksModel';
import { LAB_PATH } from './labModel';
import { CALENDAR, CHECKLIST, TOOLS, sectionsOf, stamp, requirePlaybook } from './labOperationsModel';

function Edit({ section, publish, onClose, changed }) {
  const [title, setTitle] = useState(section?.title || '');
  const [body, setBody] = useState(section?.body || '');
  const w = useWrite(changed, {}, refusalText);
  return <Dialog title={publish ? 'Publish the playbook?' : `Edit ${section.title}`} sub={publish
    ? 'This saves a new published version for every admin. The previous version stays on record.'
    : 'This changes the draft only. Admins keep reading the published version until you publish. Calendar wording does not change the Lab’s clock.'}
    w={w} onClose={onClose} testId="lab-playbook-dialog" action={publish ? 'Publish changes' : 'Save draft'} disabled={!publish && (!title.trim() || title.length > 120 || body.length > 5000)}
    onAction={() => w.run(() => publish ? labOperationsApi.publish() : labOperationsApi.editSection(section.key, { title, body: body.trim() || null }))}
    done={publish ? 'The playbook was published.' : 'The draft was saved. It is not published yet.'}>
    {!publish && <><Field label="Title"><input className={INPUT} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="lab-playbook-title" disabled={w.busy || !!w.reply} /></Field>
      <Field label="Section text"><textarea className={`${INPUT} min-h-[180px] py-2`} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} data-testid="lab-playbook-body" disabled={w.busy || !!w.reply} /></Field></>}
  </Dialog>;
}
export default function LabHowItRuns({ superAdmin = false }) {
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState(false);
  const read = useRead('playbook', tick, () => labOperationsApi.playbook().then(requirePlaybook));
  const data = read.data;
  const sections = sectionsOf(data, superAdmin && draft);
  const retry = () => setTick((t) => t + 1);
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[210px_minmax(0,1fr)]" data-testid="lab-how-it-runs">
    <nav aria-label="On this page" className={`${CARD} flex flex-col gap-2 self-start p-4`}>
      <h2 className={H2}>On this page</h2>
      {sections.map((s) => <a className={LINK} key={s.key} href={`#lab-playbook-${s.key}`}>{s.title}</a>)}
      <a className={LINK} href="#lab-monthly-checklist">What you do each month</a><a className={LINK} href="#lab-admin-tools">Admin tools</a>
    </nav>
    <div className="flex min-w-0 flex-col gap-4">
      <section className={`${CARD} flex flex-col gap-3 p-4`}>
        <h2 className={H2}>How it runs</h2>
        {!superAdmin && <p className={SUB}>HQ writes the playbook.</p>}
        <ReadState read={read} what="The playbook" claim="The published playbook could not be read." onRetry={retry} testId="lab-playbook" />
        {data && <><p className={SUB}>{data.playbook?.published ? `Published version ${data.playbook.version} · ${stamp(data.playbook.published_at)}` : 'Not recorded — HQ has not published a Lab playbook yet.'}</p>
          {superAdmin && <div className="flex flex-wrap items-center gap-2">
            <button className={actionGhost} onClick={() => setDraft(!draft)} data-testid="lab-playbook-view">{draft ? 'Read published version' : 'Read and edit draft'}</button>
            <span className={SUB}>Draft edited: {stamp(data.draft?.edited_at)}</span>
            <button className={actionPrimary} disabled={!data.draft?.differs || read.status !== 'ready'} onClick={() => setDialog({ publish: true })} data-testid="lab-playbook-publish">Publish changes</button>
          </div>}</>}
      </section>
      {sections.map((s) => <section id={`lab-playbook-${s.key}`} key={s.key} className={`${CARD} flex flex-col gap-3 p-4`}>
        <div className="flex items-center justify-between gap-3"><h2 className={H2}>{s.title}</h2>
          {superAdmin && draft && <button className={actionGhost} disabled={read.status !== 'ready'} onClick={() => setDialog({ section: s })} data-testid={`lab-playbook-edit-${s.key}`}>Edit</button>}</div>
        <p className={`${SUB} whitespace-pre-wrap break-words`}>{s.body || 'Not recorded — HQ has not written this section in this version.'}</p>
        {s.key === 'calendar' && <><p className={SUB}>The clock is fixed independently of the playbook.</p>{CALENDAR.map((t) => <p className={SUB} key={t}>{t}</p>)}<Link className={LINK} to={`${LAB_PATH}/cohorts`}>Open the live cohort calendar</Link></>}
      </section>)}
      <section id="lab-monthly-checklist" className={`${CARD} p-4`}><h2 className={H2}>What you do each month</h2>
        <ul className="flex list-none flex-col gap-3 p-0">{CHECKLIST.map(([when, what, path]) => <li key={when}><span className={SUB}>{when}</span><br /><Link className={LINK} to={`${LAB_PATH}${path}`}>{what}</Link></li>)}</ul>
      </section>
      <section id="lab-admin-tools" className={`${CARD} p-4`}><h2 className={H2}>Admin tools</h2>
        <ul className="flex list-none flex-col gap-3 p-0">{TOOLS.map(([what, who, path]) => <li className="flex flex-wrap justify-between gap-2" key={what}><Link className={LINK} to={`${LAB_PATH}${path}`}>{what}</Link><span className={SUB}>{who}</span></li>)}</ul>
      </section>
    </div>
    {dialog && <Edit {...dialog} onClose={() => setDialog(null)} changed={retry} />}
  </div>;
}
