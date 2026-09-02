import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarDays, ChevronRight, FileSignature, FileText, Filter, RefreshCw, Scale, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderRaiseCapital.css';
import './founderRaiseLegal.css';

const asList = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const clean = (value) => String(value ?? '').trim();
const display = (value, fallback = 'Not recorded') => clean(value) || fallback;
const pretty = (value) => display(value).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value) => {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const statusTone = (value) => {
  const normalized = clean(value).toLowerCase();
  if (['signed', 'filed', 'completed', 'executed'].includes(normalized)) return 'good';
  if (['sent', 'pending', 'generated', 'due', 'snoozed'].includes(normalized)) return 'warn';
  if (['void', 'overdue', 'missing', 'not filed'].includes(normalized)) return 'bad';
  return 'neutral';
};

export default function FounderRaiseLegal() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(Number(requestedId) || null);
  const [records, setRecords] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const lastAutoLoad = useRef(null);

  const load = async () => {
    setLoading(true);
    const nextErrors = {};
    try {
      const projectList = asList(await api.listProjects(), 'items', 'projects');
      const requested = Number(requestedId);
      const selected = projectList.find((item) => Number(item.id) === requested) || projectList[0];
      setProjects(projectList);
      setProjectId(selected?.id || null);
      if (!selected) {
        setRecords({});
        return;
      }
      if (String(selected.id) !== requestedId) {
        setParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(selected.id));
          return next;
        }, { replace: true });
      }
      const calls = {
        documents: api.listDocuments(selected.id),
        compliance: api.complianceList(selected.id),
        entities: api.listEntities(),
        trackers: api.legal83bList(selected.id),
      };
      const settled = await Promise.allSettled(Object.entries(calls).map(async ([key, request]) => [key, await request]));
      const nextRecords = {};
      settled.forEach((result, index) => {
        const key = Object.keys(calls)[index];
        if (result.status === 'fulfilled') nextRecords[key] = result.value[1];
        else nextErrors[key] = result.reason?.message || 'Unavailable';
      });
      setRecords(nextRecords);
    } catch (cause) {
      nextErrors.projects = cause?.message || 'The project list is unavailable.';
      setRecords({});
    } finally {
      setErrors(nextErrors);
      setLoading(false);
    }
  };

  useEffect(() => {
    const key = requestedId || 'default';
    if (lastAutoLoad.current === key) return;
    lastAutoLoad.current = key;
    load();
  }, [requestedId]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const documents = asList(records.documents, 'documents', 'items');
  const compliance = asList(records.compliance, 'events', 'items');
  const trackers = asList(records.trackers, 'trackers', 'items');
  const entities = asList(records.entities, 'entities', 'items').filter((item) => Number(item.project_id) === Number(projectId));
  const openCompliance = compliance.filter((event) => clean(event.completion_status).toLowerCase() !== 'completed');
  const overdue = openCompliance.filter((event) => Number(event.days_until) < 0);
  const nextDeadline = [...openCompliance].filter((event) => event.due_date).sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0] || null;
  const signed = documents.filter((document) => clean(document.status).toLowerCase() === 'signed' || document.signed_at);
  const awaiting = documents.filter((document) => clean(document.status).toLowerCase() === 'sent');
  const rows = useMemo(() => [
    ...documents.map((document, index) => ({
      id: `document-${document.id || index}`,
      kind: 'document',
      title: display(document.title || document.name || document.template_name || document.doc_type, 'Untitled legal document'),
      type: pretty(document.doc_type || document.template_name || 'Document'),
      status: pretty(document.status),
      detail: document.signed_at ? `Signed ${formatDate(document.signed_at)}` : clean(document.status).toLowerCase() === 'sent' ? 'Awaiting signature' : 'No signature recorded',
    })),
    ...compliance.map((event, index) => ({
      id: `compliance-${event.id || index}`,
      kind: 'compliance',
      title: display(event.title, 'Untitled compliance event'),
      type: pretty(event.event_type || 'Compliance'),
      status: clean(event.completion_status).toLowerCase() === 'completed' ? 'Completed' : Number(event.days_until) < 0 ? 'Overdue' : pretty(event.completion_status),
      detail: event.due_date ? `Due ${formatDate(event.due_date)}` : 'Deadline not recorded',
    })),
  ], [documents, compliance]);
  const visibleRows = filter === 'agreements'
    ? rows.filter((row) => row.kind === 'document')
    : filter === 'compliance'
      ? rows.filter((row) => row.kind === 'compliance')
      : filter === 'signatures'
        ? rows.filter((row) => row.kind === 'document' && ['Signed', 'Sent'].includes(row.status))
        : rows;
  const query = projectId ? `?project_id=${projectId}` : '';

  const chooseProject = (value) => {
    const id = Number(value);
    setProjectId(id);
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('project_id', String(id));
      return next;
    }, { replace: true });
  };

  return <main className="fr-capital" data-testid="founder-raise-legal">
    <div className="fr-capital-shell">
      <section className="fr-capital-main">
        <header className="fr-capital-header">
          <div className="fr-capital-crumb"><Link to={`/raise/status${query}`} data-testid="link-legal-back"><ArrowLeft size={13} /> Raise</Link><span>/</span><strong>Legal</strong></div>
          <div className="fr-capital-title-row"><div><p className="fr-capital-kicker">Founder / Raise</p><h1>Legal engine</h1><p className="fr-capital-subtitle">Entity, agreements, compliance calendar and signature archive.</p></div>{projects.length > 1 && <label className="fr-capital-picker"><span>Startup</span><select data-testid="select-legal-project" value={projectId || ''} onChange={(event) => chooseProject(event.target.value)}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
          <nav className="fr-capital-zone-nav" aria-label="Raise sections"><Link to={`/raise/status${query}`}>Status</Link><Link to={`/raise/pitch${query}`}>Pitch</Link><Link to={`/raise/capital${query}`}>Capital</Link><Link to={`/raise/legal${query}`} className="is-active" data-testid="link-legal-zone">Legal</Link><Link to={`/raise/data-room${query}`}>Data room</Link><span className="fr-capital-zone-disabled">Liquidity unavailable</span></nav>
        </header>
        {Object.keys(errors).length > 0 && <div className="fr-capital-alert" role="alert" data-testid="status-legal-partial"><AlertCircle size={16} /><span>{errors.projects || 'Some selected-project legal sources are unavailable.'}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
        {loading ? <LegalSkeleton /> : errors.projects ? <UnavailableLegal onRetry={load} /> : !project ? <EmptyLegal /> : <LegalContent project={project} documents={documents} compliance={compliance} trackers={trackers} entities={entities} signed={signed} awaiting={awaiting} openCompliance={openCompliance} overdue={overdue} nextDeadline={nextDeadline} rows={visibleRows} allRows={rows} errors={errors} filter={filter} setFilter={setFilter} query={query} />}
      </section>
      <WorkerRail project={project} documents={documents} compliance={compliance} trackers={trackers} errors={errors} />
    </div>
  </main>;
}

function LegalContent({ project, documents, compliance, trackers, entities, signed, awaiting, openCompliance, overdue, nextDeadline, rows, allRows, errors, filter, setFilter, query }) {
  const entity = entities[0] || null;
  return <div className="fr-capital-content">
    <div className="fr-capital-context"><div><span className="fr-capital-label">Selected startup</span><strong data-testid="text-legal-project">{display(project.name)}</strong><span>{display(project.sector, 'Sector not recorded')}</span></div><div className="fr-capital-context-right"><span className="fr-capital-label">Entity record</span><strong>{errors.entities ? 'Entity source unavailable' : display(entity?.legal_name || entity?.name, 'No entity recorded')}</strong><span>{errors.entities ? 'Could not read this source' : [entity?.jurisdiction, entity?.entity_type].filter(Boolean).join(' · ') || 'Formation details not recorded'}</span></div></div>
    <div className="fr-capital-stat-strip"><LegalStat label="Documents" value={errors.documents ? 'Unavailable' : documents.length} note={errors.documents ? 'Document source unavailable' : `${signed.length} signed`} muted={Boolean(errors.documents)} /><LegalStat label="Awaiting signature" value={errors.documents ? 'Unavailable' : awaiting.length} note={errors.documents ? 'Document source unavailable' : 'Sent documents only'} muted={Boolean(errors.documents)} /><LegalStat label="Compliance open" value={errors.compliance ? 'Unavailable' : openCompliance.length} note={errors.compliance ? 'Compliance source unavailable' : `${overdue.length} overdue`} muted={Boolean(errors.compliance)} /><LegalStat label="Next deadline" value={errors.compliance ? 'Unavailable' : (nextDeadline ? formatDate(nextDeadline.due_date) : 'Not recorded')} note={errors.compliance ? 'Compliance source unavailable' : display(nextDeadline?.title, 'No open deadline')} muted={Boolean(errors.compliance) || !nextDeadline} /></div>
    <section className="fr-capital-card fr-capital-ledger">
      <div className="fr-capital-card-head"><div><FileText size={16} /><h2>Document library</h2></div><span>{allRows.length} source record{allRows.length === 1 ? '' : 's'} · audit fields only</span></div>
      <div className="fr-capital-toolbar"><div className="fr-capital-filters"><Filter size={13} />{[['all', 'All documents'], ['agreements', 'Agreements'], ['compliance', 'Compliance'], ['signatures', 'Signatures']].map(([key, label]) => <button type="button" key={key} className={filter === key ? 'is-selected' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div><div className="fr-capital-actions"><span><FileSignature size={13} /> Read-only collection</span><Link to={`/raise/legal-engine${query}`} data-testid="link-open-legal-workspace"><Scale size={13} /> Open workspace</Link></div></div>
      {rows.length ? <div className="fr-capital-table-wrap"><table><thead><tr><th>Document</th><th>Type</th><th>State</th><th>Signatures / deadline</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} data-testid={`row-legal-${row.id}`}><td><strong>{row.title}</strong><small>{row.kind === 'compliance' ? 'Compliance calendar' : 'Legal document'}</small></td><td>{row.type}</td><td><span className={`fr-legal-pill is-${statusTone(row.status)}`}>{row.status}</span></td><td>{row.detail}</td></tr>)}</tbody></table></div> : <div className="fr-capital-inline-empty"><FileText size={18} /><div><strong>{filter === 'all' ? 'No legal records are stored.' : 'No records match this view.'}</strong><p>FR4 displays only documents and compliance events returned for this startup.</p></div></div>}
      <p className="fr-capital-note">Document status and signature dates come from legal records; overdue state and deadlines come from the compliance service. FR4 does not infer missing filings, signature counts, or diligence risks.</p>
    </section>
    <div className="fr-capital-lower-grid"><section className="fr-capital-card"><div className="fr-capital-card-head"><div><CalendarDays size={16} /><h2>Compliance calendar</h2></div><span>{errors.compliance ? 'Source unavailable' : `${compliance.length} events`}</span></div><Coverage label="Open events" value={errors.compliance ? 'Unavailable' : openCompliance.length} /><Coverage label="Overdue" value={errors.compliance ? 'Unavailable' : overdue.length} /><Coverage label="Next deadline" value={errors.compliance ? 'Unavailable' : (nextDeadline ? formatDate(nextDeadline.due_date) : 'Not recorded')} /><p className="fr-capital-note">Completion and deadline status is server-calculated. This page cannot complete, snooze, add, or delete calendar events.</p><Link className="fr-capital-editor-link" to="/compliance">Open compliance workspace <ChevronRight size={13} /></Link></section><section className="fr-capital-card"><div className="fr-capital-card-head"><div><ShieldCheck size={16} /><h2>Entity & filing coverage</h2></div><span>Read-only</span></div><Coverage label="Entity records" value={errors.entities ? 'Unavailable' : entities.length} /><Coverage label="83(b) trackers" value={errors.trackers ? 'Unavailable' : trackers.length} /><Coverage label="Signed documents" value={errors.documents ? 'Unavailable' : signed.length} /><p className="fr-capital-note">FR4 surfaces stored records only. It does not decide whether a filing is legally sufficient or provide legal advice.</p></section></div>
    <section className="fr-capital-card fr-capital-waterfall"><div className="fr-capital-card-head"><div><Sparkles size={16} /><h2>Legal diligence note</h2></div><span>AI action unavailable</span></div><div className="fr-capital-unavailable"><Sparkles size={17} /><div><strong>No legal-risk proposal is generated here.</strong><p>The source contracts do not return a counsel-reviewed explanation or permission to save legal notes, so FR4 does not create, accept, edit, or discard one.</p></div></div><p className="fr-capital-note">Not legal advice · consult qualified counsel for filing, tax, assignment, and remediation decisions.</p></section>
  </div>;
}

function LegalStat({ label, value, note, muted }) { return <div className={`fr-capital-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Coverage({ label, value }) { return <div className="fr-capital-coverage-row"><span>{label}</span><strong>{value}</strong></div>; }
function WorkerRail({ project, documents, compliance, trackers, errors }) {
  return <WorkerRail
    workspace="Raise"
    className="fr-capital-rail"
    stance="Manual legal collection"
    note="This view reads selected-project legal and compliance records. It does not send documents, file forms, or provide legal advice."
    coverage={[project ? `${documents.length} document${documents.length === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? `${compliance.length} compliance event${compliance.length === 1 ? '' : 's'} · ${trackers.length} 83(b) tracker${trackers.length === 1 ? '' : 's'}` : 'Select a startup to read its legal records.'}
    unavailable={[['Gap analysis', '{Object.keys(errors).length ? \'One or more source reads are unavailable.\' : \'No diligence scoring source is connected.\'}'], ['AI legal brief', 'No generate, save, accept, or attach action is enabled.']]}
    footer="Read-only collection · source records only"
  />;
}
function EmptyLegal() { return <div className="fr-capital-empty" data-testid="empty-raise-legal"><Scale size={24} /><h2>No startup is available</h2><p>This legal collection is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/raise/status">Back to raise</Link></div>; }
function UnavailableLegal({ onRetry }) { return <div className="fr-capital-empty" data-testid="unavailable-raise-legal"><AlertCircle size={24} /><h2>Project source unavailable</h2><p>The selected startup cannot be read right now. No document or compliance totals are inferred from a failed request.</p><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>; }
function LegalSkeleton() { return <div className="fr-capital-loading" data-testid="status-raise-legal-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }