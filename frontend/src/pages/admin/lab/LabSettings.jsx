import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { labOperationsApi } from '../../../lib/api/labOperations';
import { programGrantsApi } from '../../../lib/api/programGrants';
import { licenceProgramsApi } from '../../../lib/api/licencePrograms';
import { periodOf, statusOf, termRows } from '../../../lib/studioPrograms';
import { actionGhost } from '../../../ui';
import { CARD, H2, SUB, LINK, INPUT, useRead, Dialog, Field, Select, useWrite } from './labParts';
import { ReadState } from './labOperationsParts';
import { refusalText } from './labDesksModel';
import { CALENDAR, MESSAGES, sizeProblem, requireSettings, requireGrants, requirePrograms, labGrantOf } from './labOperationsModel';

function SizeDialog({ field, current, onClose, changed }) {
  const [value, setValue] = useState(String(current));
  const minimum = field === 'min';
  const problem = sizeProblem(value);
  const w = useWrite(changed, {}, refusalText);
  return <Dialog title={minimum ? 'Change the minimum' : 'Change the places'}
    sub={minimum ? `From the next capacity check, cohorts with fewer than ${problem ? 'the minimum' : Number(value)} approved move to the following month, unless an admin chose Run it anyway.`
      : 'This changes the places shown to applicants. Approving past it asks you to confirm. Existing approvals stay approved.'}
    onClose={onClose} w={w} testId="lab-size-dialog" action="Save" disabled={!!problem}
    onAction={() => w.run(() => labOperationsApi.setSize({ [minimum ? 'min_cohort_size' : 'max_cohort_size']: Number(value) }))} done="The cohort size was saved.">
    <Field label={minimum ? 'Minimum' : 'Places'}><input type="number" min="0" max="1000" step="1" className={INPUT} value={value} onChange={(e) => setValue(e.target.value)} disabled={w.busy || !!w.reply} data-testid="lab-size-value" /></Field>
    <p className={SUB}>Now {current}. {problem}</p>
  </Dialog>;
}

function GrantTerms({ superAdmin }) {
  // A branch Admin reads its own licence's grant (D984); only a Super Admin reads HQ's grid.
  return <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="lab-grant-terms">
    <h2 className={H2}>From your studio’s grant</h2>
    {superAdmin ? <HqGrantTerms /> : <StudioGrantTerms />}
    <p className={SUB}>These terms are set by HQ on Program grants, not here.</p>
  </section>;
}
// D1280: the period and the Lab's cohort terms, in the Programs tab's words; every other term is on Licences › Programs.
const LAB_TERMS = ['CAPACITY', 'COHORTS', 'APPROVAL'];
function StudioGrantTerms() {
  const [tick, setTick] = useState(0);
  const read = useRead('lab-studio-grant', tick, () => licenceProgramsApi.mine().then(requirePrograms));
  const lab = read.data ? labGrantOf(read.data) : null;
  const status = lab?.kind === 'grant' ? statusOf(lab.program) : null;
  return <>
    <ReadState read={read} what="Your studio’s grant" claim="Your studio’s Spin-Out Lab grant could not be read. That is not the same as none." onRetry={() => setTick((t) => t + 1)} testId="lab-studio-grant" />
    {lab?.kind === 'unlinked' && <p className={SUB} data-testid="lab-studio-grant-unlinked">{lab.line}</p>}
    {lab?.kind === 'no_copy' && <p className={SUB} data-testid="lab-studio-grant-no-copy">{lab.line}</p>}
    {lab?.kind === 'none' && <p className={SUB} data-testid="lab-studio-grant-none">Your studio does not hold Spin-Out Lab{lab.program?.word ? ` (${lab.program.word})` : ''}. Ask HQ for it on Licences › Programs.</p>}
    {status && <div className="flex flex-col gap-2" data-testid="lab-studio-grant">
      <p className={SUB}>Grant: <strong>{status.word}</strong>{status.line ? ` · ${status.line}` : ''}</p>
      <dl className="m-0 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
        <dt>Period</dt><dd className="m-0">{periodOf(lab.program)}</dd>
        {termRows(lab.program).filter((r) => LAB_TERMS.includes(r.eye)).map((r) => <React.Fragment key={r.eye}>
          <dt>{r.eye.charAt(0) + r.eye.slice(1).toLowerCase()}</dt><dd className="m-0">{r.text}{r.sub ? <span className={`block ${SUB}`}>{r.sub}</span> : null}</dd>
        </React.Fragment>)}
      </dl>
    </div>}
    <Link className={LINK} to="/admin/my-licence/programs">{lab?.kind === 'none' ? 'Request it on Licences › Programs' : 'Open Licences › Programs'}</Link>
  </>;
}
function HqGrantTerms() {
  const [tick, setTick] = useState(0);
  const [uid, setUid] = useState('');
  const read = useRead('lab-grant-terms', tick, () => programGrantsApi.grid().then(requireGrants));
  const licences = read.data?.licences || [];
  const selected = licences.find((x) => x.uid === uid);
  const grant = selected?.grants?.['spinout-lab'];
  const terms = grant?.terms;
  const recorded = (v) => v === null || v === undefined ? 'Not recorded — HQ has not set this term.' : v;
  const flag = (v) => v === null || v === undefined ? recorded(v) : Number(v) === 1 ? 'On' : 'Off';
  return <>
    <ReadState read={read} what="Program grant terms" claim="The studio grants could not be read." onRetry={() => setTick((t) => t + 1)} testId="lab-grants" />
    {read.data && <><Select label="Studio grant" value={uid} onChange={setUid} testId="lab-grant-studio" options={[{ value: '', label: 'HQ-held · choose a licensed studio' }, ...licences.map((l) => ({ value: l.uid, label: l.brand_name || l.licence_ref || l.uid }))]} />
      {!uid ? <p className={SUB}>HQ-held accounts have no subsidiary grant. Choose a licensed studio to read its terms.</p>
        : !grant ? <p className={SUB}>Not recorded — this studio has no Spin-Out Lab grant.</p>
          : <><p className={SUB}>Grant: {grant.state || 'Not recorded'}</p><dl className="m-0 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
            <dt>Cohorts a year</dt><dd className="m-0">{recorded(terms?.cohorts_per_year)}</dd>
            <dt>HQ approves each cohort before it opens</dt><dd className="m-0">{flag(terms?.hq_approves_each_cohort)}</dd>
            <dt>People at once, up to</dt><dd className="m-0">{Number(terms?.capacity_uncapped) === 1 ? 'Uncapped' : recorded(terms?.capacity_cap)}</dd>
          </dl></>}
    </>}
    <Link className={LINK} to="/admin/licences/programs">Open Licences › Programs</Link>
  </>;
}

export default function LabSettings({ superAdmin = false }) {
  const [tick, setTick] = useState(0);
  const [field, setField] = useState(null);
  const read = useRead('lab-size', tick, () => labOperationsApi.settings().then(requireSettings));
  const settings = read.data?.settings;
  const retry = () => setTick((t) => t + 1);
  return <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" data-testid="lab-settings">
    <section className={`${CARD} flex flex-col gap-3 p-4`}><h2 className={H2}>Cohort size</h2>
      <ReadState read={read} what="Cohort size" claim="Minimum and places could not be read." onRetry={retry} testId="lab-size" />
      {settings && ['min', 'max'].map((key) => <div className="flex flex-wrap items-center justify-between gap-3" key={key}>
        <span>{key === 'min' ? 'Minimum' : 'Places'}</span><span data-testid={`lab-size-${key}`}>{settings[key] ?? 'Not recorded — the read did not carry this value.'}</span>
        <button className={actionGhost} disabled={read.status !== 'ready' || !Number.isInteger(settings[key])} onClick={() => setField(key)} data-testid={`lab-size-edit-${key}`}>Edit</button>
      </div>)}<p className={SUB}>Places are shown to applicants. Approving past them asks you to confirm.</p>
    </section>
    <GrantTerms superAdmin={superAdmin} />
    <section className={`${CARD} flex flex-col gap-3 p-4`}><h2 className={H2}>The calendar and time zone · fixed</h2>{CALENDAR.map((t) => <p className={SUB} key={t}>{t}</p>)}</section>
    <section className={`${CARD} flex flex-col gap-3 p-4`}><h2 className={H2}>Who can apply and what the Lab sends · fixed</h2>
      <p className={SUB}>Who can apply: Founder and Explorer.</p><p className={SUB}>Messages: {MESSAGES.join(' · ')}.</p>
    </section>
    {field && <SizeDialog field={field} current={settings[field]} onClose={() => setField(null)} changed={retry} />}
  </div>;
}
