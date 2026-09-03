import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import './investorNetworkWorkspace.css';

/**
 * A section heading's right-hand detail, in the order the body already reads
 * its state: error, then loading, then the fact.
 *
 * WHAT THIS FIXES. `null` meant both "not fetched yet" and "fetch failed" —
 * `setIntroductions` is only called on a fulfilled result — so a rejection left
 * the heading printing "Loading propositions" forever, directly above the alert
 * saying the propositions were unavailable. Both statements on screen at once,
 * one of them false. Same shape on all three sections, which is why this is one
 * helper rather than three ternaries.
 */
const detailFor = (error, value, describe) => {
  if (error) return 'Source unavailable';
  if (value === null || value === undefined) return 'Loading records';
  return describe();
};

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

// `embedded`: on /network/{relationships,introductions,organizations} the
// WorkspaceShell already draws the heading, the zone row and the rail. This
// page drew all three again, which is why an investor saw two Worker AI rails
// side by side on those routes.
//
// `zone`: which single section to render. On `/network` there is none and all
// three stack, which is the overview and is right. On a zone route it is the
// slug the shell already resolved, and passing it is what stopped all three
// zone routes rendering the identical body — the pills moved, the page did
// not, on every one of the three. Naming the sections here rather than
// splitting the page into three files keeps one load, one error map and one
// set of derivations behind all four URLs: `organizations` is derived from the
// relationship rows, so a split would either duplicate that read or invent a
// second source for it.
export default function InvestorNetworkWorkspace({ embedded = false, zone = null }) {
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

  const bucket = bucketForPath('investor', '/network');
  const touchCoverage = (relationships || []).filter((item) => lastTouchAt(item)).length;
  const coldCount = (relationships || []).filter((item) => {
    const touched = new Date(String(lastTouchAt(item) || '').replace(' ', 'T'));
    return Number.isFinite(touched.getTime()) && Date.now() - touched.getTime() > 60 * 86400000;
  }).length;
  const pending = propositionRows.filter((item) => item.status === 'pending');

  // No zone means the overview, where every section shows. An unknown slug
  // would show nothing at all, so it is treated as no zone: the shell only
  // ever passes a slug out of its own bucket config, and a body that renders
  // the whole workspace is a better failure than a body that renders nothing.
  const known = zone === 'relationships' || zone === 'introductions' || zone === 'organizations';
  const shows = (section) => !known || zone === section;

  return (
    <main className="investor-network-workspace" data-testid="investor-network-workspace">
      <div className="inw-layout">
        <section className="inw-main">
          {!embedded && <header className="inw-hero">
            <div className="inw-title-row">
              <div><h1 data-testid="heading-investor-network">Work my relationships</h1><p>Typed for this side of the table: founders met, co-investors, LPs, service partners — each tie carrying the deal or fund context it belongs to.</p></div>
            </div>
            {/* Real links. These were three `href="#…"` anchors that scrolled
                and never opened /network/relationships, /introductions or
                /organizations. */}
            <ZoneNav bucket={bucket} role="investor" activeSlug={null} className="mt-2.5" />
          </header>}

          {shows('relationships') && <section className="inw-card" aria-labelledby="relationship-book">
            <SectionHeading id="relationship-book" title="Relationship book" detail={detailFor(errors.relationships, relationships, () => {
              const ties = summary?.active_relationships ?? summary?.relationships_count ?? relationships.length;
              // A book with no last-touch dates and an EMPTY book are different
              // facts. Only the first is a coverage gap.
              const touch = relationships.length === 0 ? 'no ties recorded'
                : touchCoverage ? `${coldCount} going cold` : 'last-touch coverage unavailable';
              return `${ties} ties · ${touch}`;
            })} />
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
          </section>}

          {(shows('introductions') || shows('organizations')) && <div className="inw-lower">
            {shows('introductions') && <section className="inw-card" aria-labelledby="introductions-desk">
              <SectionHeading id="introductions-desk" title="Introductions desk" detail={detailFor(errors.introductions, introductions, () => `${pending.length} awaiting your decision · ${propositionRows.length} shown`)} />
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
            </section>}

            {shows('organizations') && <section className="inw-card" aria-labelledby="organizations">
              <SectionHeading id="organizations" title="Organizations" detail={detailFor(errors.organizations, relationships, () => `${organizations.length} relationship-backed organizations`)} />
              {errors.organizations ? <Alert>{errors.organizations}</Alert> : relationships === null ? <Skeleton rows={4} /> : organizations.length === 0 ? <div className="inw-empty" data-testid="empty-organizations">No organization identity is recorded on your relationship records yet.</div> : <div className="inw-org-list">{organizations.slice(0, 6).map((org) => <div className="inw-org" key={org.name} data-testid={`row-organization-${safeKey(org.name)}`}><div><strong>{org.name}</strong><span>{[...org.types].join(' · ') || 'Attributed relationship'}</span></div><b>{org.people.size} known</b></div>)}</div>}
              <p className="inw-footnote">Organizations appear only when explicitly attached to a relationship record. Names and email domains are never used to infer a firm.</p>
            </section>}
          </div>}
        </section>

        {!embedded && (
          <WorkerRail
            workspace="Network"
            role="investor"
            className="inw-rail"
            stance="Manual by default"
            note="Tables and relationship records work alone. No automated outreach is sent from this page, and nothing here creates a relationship, sends an introduction, or infers consent."
            coverage={[
              errors.relationships ? 'Relationship book unavailable'
                : relationships === null ? 'Reading the relationship book'
                  : `${relationships.length} attributed tie${relationships.length === 1 ? '' : 's'}`,
              // The credits balance is whatever the introductions service
              // reports. A missing balance renders as absent, never as zero.
              introductions?.credits?.balance == null
                ? 'Intro credits not recorded'
                : `${introductions.credits.balance} intro credits available`,
            ]}
            coverageNote="Credit availability is supplied by the introductions service. Declining a proposition uses no credit."
            unavailable={[
              ['Outreach drafting', 'No message, sequence or introduction is written here. Every send is a human click.'],
              ['Consent', 'An accepted introduction stays a reviewed proposition. Both parties’ consent and the recorded scope govern what can be shared.'],
            ]}
            action={(
              <button type="button" onClick={() => load(true)} disabled={refreshing} data-testid="button-refresh-network">
                <RefreshCw size={13} className={refreshing ? 'inw-spin' : ''} /> Refresh records
              </button>
            )}
          />
        )}
      </div>
    </main>
  );
}