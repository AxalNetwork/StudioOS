import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Landmark, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import './investorNetworkWorkspace.css';

const typeLabel = (value) => String(value || 'relationship').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const personName = (relationship) => relationship?.other?.name || relationship?.other?.email || 'Unidentified relationship';
const age = (value) => {
  if (!value) return 'Not recorded';
  const date = new Date(String(value || '').replace(' ', 'T'));
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (!Number.isFinite(days)) return 'Not recorded';
  return days === 0 ? 'Today' : `${days}d ago`;
};
const safeKey = (value) => String(value || 'record').replace(/\W+/g, '-').toLowerCase();
const lastTouchAt = (relationship) => relationship?.last_touch_at
  || relationship?.last_contact_at
  || relationship?.metadata?.last_touch_at
  || relationship?.metadata?.last_contact_at
  || null;
const relationshipContext = (relationship) => relationship?.context
  || relationship?.deal_name
  || relationship?.fund_name
  || relationship?.project?.name
  || relationship?.metadata?.context
  || relationship?.metadata?.deal_name
  || relationship?.metadata?.fund_name
  || 'No deal or fund context recorded';
const orgIdentity = (relationship) => relationship?.organization_name
  || relationship?.organization?.name
  || relationship?.other?.organization_name
  || relationship?.other?.organization?.name
  || relationship?.metadata?.organization_name
  || relationship?.metadata?.organization?.name
  || null;
const introductionContext = (prop) => {
  const reasons = Array.isArray(prop?.breakdown?.reasons) ? prop.breakdown.reasons : [];
  const reason = reasons.map((item) => typeof item === 'string' ? item : item?.reason || item?.label || item?.detail).find(Boolean);
  return reason || prop?.breakdown?.relationship_context || 'Context is retained with the proposition and reviewed before consent.';
};

function SectionHeading({ id, title, detail }) {
  return <div className="inw-section-head" id={id}><h2>{title}</h2><span data-testid={`text-${id}-detail`}>{detail}</span></div>;
}

function Skeleton({ rows = 4 }) {
  return <div className="inw-skeleton" data-testid="network-loading-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>;
}

function Alert({ children }) {
  return <div className="inw-alert" role="status" data-testid="status-network-error"><CircleAlert size={14} />{children}</div>;
}

export default function InvestorNetworkWorkspace() {
  const [params] = useSearchParams();
  const highlightedIntro = params.get('intro') || '';
  const requestedTab = params.get('tab') || '';
  const [relationships, setRelationships] = useState(null);
  const [summary, setSummary] = useState(null);
  const [introductions, setIntroductions] = useState(null);
  const [errors, setErrors] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [busyUid, setBusyUid] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async (refresh = false) => {
    setRefreshing(refresh);
    setActionError('');
    const calls = await Promise.allSettled([
      api.partnerRelationships(), api.partnerSummary(), api.introPropositions(refresh ? { refresh: true } : {}),
    ]);
    const [relationshipResult, summaryResult, introResult] = calls;
    if (relationshipResult.status === 'fulfilled') {
      const value = relationshipResult.value;
      setRelationships(Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []);
    }
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value || null);
    if (introResult.status === 'fulfilled') setIntroductions(introResult.value || { propositions: [], credits: null });
    setErrors({
      relationships: relationshipResult.status === 'rejected' ? 'Relationship book is unavailable right now.' : '',
      summary: summaryResult.status === 'rejected' ? 'Network aggregate unavailable.' : '',
      introductions: introResult.status === 'rejected' ? 'Introduction propositions are unavailable right now.' : '',
      organizations: relationshipResult.status === 'rejected' ? 'Relationship-backed organization context is unavailable right now.' : '',
    });
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (highlightedIntro && introductions) {
      document.getElementById(`network-intro-${safeKey(highlightedIntro)}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    const section = requestedTab === 'introductions'
      ? 'introductions-desk'
      : requestedTab === 'relationships'
        ? 'relationship-book'
        : '';
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [highlightedIntro, introductions, requestedTab]);

  const propositionRows = introductions?.propositions || [];
  const visiblePropositions = useMemo(() => {
    const compact = propositionRows.slice(0, 4);
    if (!highlightedIntro || compact.some((prop) => prop.uid === highlightedIntro)) return compact;
    const highlighted = propositionRows.find((prop) => prop.uid === highlightedIntro);
    return highlighted ? [highlighted, ...compact.slice(0, 3)] : compact;
  }, [highlightedIntro, propositionRows]);
  const organizations = useMemo(() => {
    if (!relationships) return [];
    const grouped = new Map();
    relationships.forEach((item) => {
      const name = orgIdentity(item);
      if (!name || typeof name !== 'string') return;
      const entry = grouped.get(name) || { name, people: new Set(), types: new Set() };
      entry.people.add(personName(item));
      if (item.relationship_type) entry.types.add(typeLabel(item.relationship_type));
      grouped.set(name, entry);
    });
    return [...grouped.values()].sort((a, b) => b.people.size - a.people.size || a.name.localeCompare(b.name));
  }, [relationships]);

  const resolveIntro = async (prop, decision) => {
    setBusyUid(prop.uid); setActionError('');
    try {
      const result = decision === 'accept' ? await api.introAccept(prop.uid) : await api.introDecline(prop.uid);
      setIntroductions((current) => current && ({
        ...current,
        credits: result?.credits || current.credits,
        propositions: current.propositions.map((item) => item.uid === prop.uid ? { ...item, status: decision === 'accept' ? 'accepted' : 'declined' } : item),
      }));
    } catch (error) {
      if (error?.status === 409) {
        setActionError('This proposition changed elsewhere. The desk has been refreshed.');
        load();
      } else if (error?.status === 402 || error?.data?.code === 'intro_credits_exhausted') {
        setActionError('No introduction credits are currently available. Declining remains available.');
        if (error?.data?.credits) setIntroductions((current) => current && ({ ...current, credits: error.data.credits }));
      } else setActionError(error?.message || 'The proposition could not be updated.');
    } finally { setBusyUid(''); }
  };

  const touchCoverage = (relationships || []).filter((item) => lastTouchAt(item)).length;
  const coldCount = (relationships || []).filter((item) => {
    const touched = new Date(String(lastTouchAt(item) || '').replace(' ', 'T'));
    return Number.isFinite(touched.getTime()) && Date.now() - touched.getTime() > 60 * 86400000;
  }).length;
  const pending = propositionRows.filter((item) => item.status === 'pending');

  return (
    <main className="investor-network-workspace" data-testid="investor-network-workspace">
      <div className="inw-layout">
        <section className="inw-main">
          <header className="inw-hero">
            <div className="inw-title-row">
              <div><h1 data-testid="heading-investor-network">Work my relationships</h1><p>Typed for this side of the table: founders met, co-investors, LPs, service partners — each tie carrying the deal or fund context it belongs to.</p></div>
            </div>
            <nav className="inw-anchors" aria-label="Network sections">
              <a href="#relationship-book" data-testid="link-network-relationship-book">Relationship book</a>
              <a href="#introductions-desk" data-testid="link-network-introductions">Introductions desk</a>
              <a href="#organizations" data-testid="link-network-organizations">Organizations</a>
            </nav>
          </header>

          <section className="inw-card" aria-labelledby="relationship-book">
            <SectionHeading id="relationship-book" title="Relationship book" detail={relationships ? `${summary?.active_relationships ?? summary?.relationships_count ?? relationships.length} ties · ${touchCoverage ? `${coldCount} going cold` : 'last-touch coverage unavailable'}` : 'Loading relationship records'} />
            {errors.relationships ? <Alert>{errors.relationships}</Alert> : relationships === null ? <Skeleton rows={5} /> : relationships.length === 0 ? <div className="inw-empty" data-testid="empty-relationship-book">No attributed relationship records are available yet.</div> : (
              <div className="inw-table" data-testid="table-relationship-book">
                <div className="inw-table-head"><span>Person</span><span>Type</span><span>Strength</span><span>Context</span><span>Last touch</span></div>
                {relationships.map((item) => <div className="inw-table-row" key={item.id} data-testid={`row-relationship-${item.id}`}>
                  <strong data-label="Person">{personName(item)}</strong><span data-label="Type"><i className="inw-type">{typeLabel(item.relationship_type)}</i></span>
                  <span data-label="Strength"><i className={`inw-strength ${Number(item.strength_score) >= 70 ? 'strong' : ''}`}>{Number.isFinite(Number(item.strength_score)) ? `${Math.round(item.strength_score)}/100` : 'Not scored'}</i></span>
                   <span data-label="Context" className="inw-context">{relationshipContext(item)}</span><time data-label="Last touch" className={age(lastTouchAt(item)).includes('d') && Number.parseInt(age(lastTouchAt(item)), 10) > 60 ? 'inw-cold' : ''}>{age(lastTouchAt(item))}</time>
                </div>)}
              </div>
            )}
            {errors.summary && <p className="inw-footnote" data-testid="text-network-summary-unavailable">{errors.summary}</p>}
          </section>

          <div className="inw-lower">
            <section className="inw-card" aria-labelledby="introductions-desk">
              <SectionHeading id="introductions-desk" title="Introductions desk" detail={introductions ? `${pending.length} awaiting your decision · ${propositionRows.length} shown` : 'Loading propositions'} />
              {errors.introductions ? <Alert>{errors.introductions}</Alert> : introductions === null ? <Skeleton rows={4} /> : propositionRows.length === 0 ? <div className="inw-empty" data-testid="empty-introductions">No live introduction propositions. New matches appear here when available.</div> : <>
                {actionError && <Alert>{actionError}</Alert>}
                <div className="inw-proposition-list">{visiblePropositions.map((prop) => {
                  const target = prop.target || {}; const active = prop.status === 'pending'; const busy = busyUid === prop.uid;
                  return <article id={`network-intro-${safeKey(prop.uid)}`} className={`inw-proposition ${active ? 'featured' : ''} ${highlightedIntro === prop.uid ? 'highlighted' : ''}`} key={prop.uid} data-testid={`card-introduction-${prop.uid}`}>
                    <div className="inw-prop-top"><span className="inw-prop-label">Proposal · {prop.source || 'network'}</span><span className="inw-score" data-testid={`text-intro-score-${prop.uid}`}>{Number.isFinite(Number(prop.score)) ? `${prop.score} match` : 'Match pending'}</span></div>
                    <strong>{target.name || target.email || 'Proposed introduction'}</strong>
                    <p>{introductionContext(prop)}</p>
                    <div className="inw-prop-actions">{active ? <><button type="button" onClick={() => resolveIntro(prop, 'accept')} disabled={busy} data-testid={`button-accept-intro-${prop.uid}`}><Check size={12} />{busy ? 'Working' : 'Accept intro'}</button><button type="button" className="quiet" onClick={() => resolveIntro(prop, 'decline')} disabled={busy} data-testid={`button-decline-intro-${prop.uid}`}><X size={12} />Decline</button></> : <span className="inw-state" data-testid={`status-intro-${prop.uid}`}>{typeLabel(prop.status)}</span>}{(prop.screened === true || prop.screening_status === 'screened') && <span className="inw-screened" data-testid={`status-intro-screened-${prop.uid}`}><ShieldCheck size={11} />Screened</span>}</div>
                  </article>;
                })}</div>
              </>}
            </section>

            <section className="inw-card" aria-labelledby="organizations">
              <SectionHeading id="organizations" title="Organizations" detail={relationships ? `${organizations.length} relationship-backed organizations` : 'Loading attributed context'} />
              {errors.organizations ? <Alert>{errors.organizations}</Alert> : relationships === null ? <Skeleton rows={4} /> : organizations.length === 0 ? <div className="inw-empty" data-testid="empty-organizations">No organization identity is recorded on your relationship records yet.</div> : <div className="inw-org-list">{organizations.slice(0, 6).map((org) => <div className="inw-org" key={org.name} data-testid={`row-organization-${safeKey(org.name)}`}><div><strong>{org.name}</strong><span>{[...org.types].join(' · ') || 'Attributed relationship'}</span></div><b>{org.people.size} known</b></div>)}</div>}
              <p className="inw-footnote">Organizations appear only when explicitly attached to a relationship record. Names and email domains are never used to infer a firm.</p>
            </section>
          </div>
        </section>

        <aside className="inw-rail" aria-label="Worker AI Network">
          <div className="inw-rail-label">Worker AI · Network <button type="button" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh network workspace" title="Refresh network workspace" data-testid="button-refresh-network"><RefreshCw size={13} className={refreshing ? 'inw-spin' : ''} /></button></div>
          <section><h2>Manual by default</h2><p>Tables and relationship records work alone. No automated outreach is sent from this page.</p></section>
          <section className="inw-rail-accent"><h2>Advisor fills the blanks</h2><p>Advisory guidance can surface attributable context and cold ties. It does not create a relationship, send an introduction, or infer consent.</p></section>
          <section><h2>Screening boundary</h2><p>Any accepted introduction remains a reviewed proposition. Both parties’ consent and the recorded scope govern what can be shared.</p></section>
          <section className="inw-usage"><div><b>{introductions?.credits?.balance ?? '—'}</b><span>intro credits available</span></div><p>Credit availability is supplied by the introductions service. Declining a proposition uses no credit.</p></section>
          <footer><Landmark size={12} /> Investor workspace. Data shown is governed by your existing access and permissions.</footer>
        </aside>
      </div>
    </main>
  );
}