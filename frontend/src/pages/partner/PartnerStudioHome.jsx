import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BriefcaseBusiness, Building2, Eye, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import ProductTestingCard from '../productTesting/ProductTestingCard';
import PartnerHomeP2 from './PartnerHomeP2';
import './partnerStudioHome.css';

/**
 * D564 (#1168) — the partner's /studio, Partner Studio. There is no separate
 * home (owner on #974), and the owner chose P2 as its body (#981, A).
 *
 * The frame stays: the masthead, Eadwyn's chat and its collapse
 * (`StudioInterview`, D324) and the profile band. The body is `PartnerHomeP2`
 * ("Where does the firm stand today?", D394), mounted as built. The module
 * grid it replaces (assigned tasks, BD pipeline, relationship health,
 * co-marketing, referrals, delivery book) is retired; each of those records
 * keeps its own page, linked from P2's tiles and feed or from the sidebar.
 */

const loading = { state: 'loading' };
const unavailable = (message) => ({ state: 'unavailable', message: message || 'Not available from a connected source.' });
const ready = (data) => ({ state: 'ready', data });

function State({ children }) {
  return <div className="partner-state"><ShieldCheck size={15} /><span>{children}</span></div>;
}

function Status({ children, tone = 'neutral' }) {
  return <span className={`partner-status partner-status--${tone}`}>{children}</span>;
}

export default function PartnerStudioHome({
  user,
  previewing = false,
  dashboardUnavailable = '',
  onRetryDashboard,
}) {
  const [profile, setProfile] = useState(loading);
  const [assistantAvailable, setAssistantAvailable] = useState(true);

  const load = useCallback(() => {
    if (previewing) { setProfile(unavailable('Partner identity is withheld in role preview.')); return; }
    setProfile(loading);
    api.partnerPortal.getProfile().then((r) => setProfile(ready(r?.partner || null))).catch((e) => setProfile(unavailable(e?.message)));
  }, [previewing]);

  useEffect(() => { load(); }, [load]);

  const partner = profile.state === 'ready' ? profile.data : null;
  const first = String(partner?.name || user?.name || '').trim().split(/\s+/)[0] || 'there';

  return (
    <main className="partner-studio" data-testid="partner-studio-home">
      {previewing && <div className="partner-preview" data-testid="status-partner-preview"><Eye size={15} /> Partner role preview. Private firm records and actions are withheld.</div>}
      {dashboardUnavailable && <div className="partner-warning"><span>{dashboardUnavailable}</span>{onRetryDashboard && <button type="button" onClick={onRetryDashboard} data-testid="button-retry-dashboard"><RefreshCw size={13} /> Retry</button>}</div>}

      <header className="partner-masthead">
        <div>
          <div className="partner-title"><h1 data-testid="text-partner-studio-title">Partner Studio</h1><span>Good to see you, {first}.</span></div>
        </div>
        <time>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</time>
      </header>

      <div className="partner-context">
        <span><Building2 size={12} /> {previewing ? 'Firm context withheld' : (partner?.company || 'Firm not recorded')}</span>
        <span><BriefcaseBusiness size={12} /> {previewing ? 'Specialization withheld' : (partner?.specialization || 'Specialization not recorded')}</span>
        {!previewing && <Link to="/account" data-testid="link-partner-settings">Partner settings <ArrowUpRight size={12} /></Link>}
      </div>

      <section className="partner-assistant" data-testid="module-eadwyn">
        {previewing ? <div className="partner-assistant-placeholder"><Sparkles size={18} /><div><strong>Eadwyn</strong><span>Partner/Operator assessment is unavailable in role preview.</span></div><Status>Preview only</Status></div>
          : assistantAvailable ? <StudioInterview persona="partner" disablePersistedFullscreen onAvailabilityChange={setAssistantAvailable} />
            : <State>Eadwyn is unavailable in this environment. Your studio data remains available below.</State>}
      </section>

      {previewing
        ? <section className="partner-assessment-preview" data-testid="module-partner-assessment"><Sparkles size={18} /><div><strong>Partner/Operator assessment</strong><p>Skills, working values, and archetype are withheld in this visual role preview.</p></div></section>
        : <ProfileFitSection compact studio audience="partner" className="partner-fit" />}

      {/* D814 (#2260): "Apply for Product Testing", above P2's own frame. */}
      <ProductTestingCard previewing={previewing} className="mb-4" />

      <PartnerHomeP2 previewing={previewing} />
    </main>
  );
}
