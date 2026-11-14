import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Loader2, Save } from 'lucide-react';
import { api } from '../../lib/api.js';
import Card from './AccountCard.jsx';

// The investor-profile PUT is full-replace on these JSON columns, so we resend
// the fields this card doesn't edit (investor_type, ticket_band, contribute,
// anti-thesis, value_weights). Onboarding-only fields (firm/accreditation/
// LP intent/notes) are preserved server-side by the PUT's preserve-if-absent
// path since we omit them here. Only investors (or anyone with a completed
// profile) see it.
export default function InvestorMyThesisCard({ flash, role, linked = false }) {
  const { search } = useLocation();
  const from = new URLSearchParams(search).get('from');
  const returnLink = from === 'home' ? { to: '/studio', label: 'Back to Investor Home' }
    : from === 'deal-flow' ? { to: '/deals', label: 'Back to Deal flow' } : null;
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getInvestorProfile()
      .then(r => { if (!cancelled) setProfile(r.profile); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load'); });
    return () => { cancelled = true; };
  }, []);

  const isInvestor = String(role || '').toLowerCase() === 'investor';
  if (!isInvestor && !profile?.completed_at) return null;
  if (err) return <Card id="my-thesis" title="My thesis"><div className="text-sm text-red-600">{err}</div></Card>;
  if (profile === undefined) return <Card id="my-thesis" title="My thesis"><p role="status">Loading…</p></Card>;
  if (!profile || (!isInvestor && !profile.completed_at)) return <Card id="my-thesis" title="My thesis"><p>No investor thesis is available for this account.</p></Card>;

  const SECTOR_OPTIONS = ['AI/ML','Climate','Fintech','Healthtech','Consumer','Enterprise SaaS','Crypto','Bio','Defense','Robotics','Energy'];
  const STAGE_OPTIONS  = ['Pre-seed','Seed','Series A','Series B+','Growth'];
  const GEO_OPTIONS    = ['North America','Europe','LATAM','APAC','MENA','Africa'];

  const sectors = profile.sectors || [];
  const stages = profile.stages || [];
  const geos = profile.geos || [];
  const antiSectors = profile.anti_thesis_sectors || [];
  const antiStages = profile.anti_thesis_stages || [];

  const toggle = (key, val) => {
    const arr = (profile[key] || []).includes(val)
      ? (profile[key] || []).filter(x => x !== val)
      : [...(profile[key] || []), val];
    setSaved(false);
    setProfile({ ...profile, [key]: arr });
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.saveInvestorProfile({
        investor_type: profile.investor_type,
        sectors: profile.sectors || [],
        stages: profile.stages || [],
        geos: profile.geos || [],
        ticket_band: profile.ticket_band,
        thesis_text: profile.thesis_text,
        contribute_to_signals: profile.contribute_to_signals !== false,
        anti_thesis_sectors: profile.anti_thesis_sectors || [],
        anti_thesis_stages: profile.anti_thesis_stages || [],
        value_weights: profile.value_weights || {},
      });
      setProfile(r.profile);
      setSaved(true);
      flash('Thesis saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally {
      setBusy(false);
    }
  };

  const chipRow = (key, options, selected) => (
    <div className="flex flex-wrap gap-2">
      {options.map(s => (
        <button key={s} disabled={busy} onClick={() => toggle(key, s)}
          className={`text-xs px-2.5 py-1 rounded-full border ${selected.includes(s)
            ? 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700'
            : 'bg-white text-gray-700 border-gray-300 hover:border-violet-300 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700'}`}>
          {s}
        </button>
      ))}
    </div>
  );

  return (
    <Card
      id="my-thesis"
      title="My thesis"
      description="The sectors, stages, geographies and free-text thesis we use to source deal flow and score founder matches."
    >
      <div className="space-y-5">
        <div>
          <span className="text-xs font-medium text-gray-700 block mb-1 dark:text-gray-300">Sectors</span>
          {chipRow('sectors', SECTOR_OPTIONS, sectors)}
        </div>
        <div>
          <span className="text-xs font-medium text-gray-700 block mb-1 dark:text-gray-300">Stages</span>
          {chipRow('stages', STAGE_OPTIONS, stages)}
        </div>
        <div>
          <span className="text-xs font-medium text-gray-700 block mb-1 dark:text-gray-300">Geographies</span>
          {chipRow('geos', GEO_OPTIONS, geos)}
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1 dark:text-gray-300">Thesis (free text)</label>
          <textarea rows={3} value={profile.thesis_text || ''} disabled={busy}
            onChange={e => { setSaved(false); setProfile({ ...profile, thesis_text: e.target.value }); }}
            placeholder="What do you look for? What's your edge?"
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100" />
        </div>
        {(antiSectors.length > 0 || antiStages.length > 0) && (
          <div className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-3">
            <span className="font-medium text-gray-700 dark:text-gray-300">Anti-thesis:</span>{' '}
            {[...antiSectors, ...antiStages].join(', ')}
            <span className="text-gray-400"> — edit in “Investor Thesis &amp; Matching” below.</span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && returnLink && <Link className="text-sm font-medium text-violet-700 underline dark:text-violet-300" to={returnLink.to}>{returnLink.label}</Link>}
          <button onClick={save} disabled={busy}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {busy ? 'Saving…' : 'Save thesis'}
          </button>
        </div>
      </div>
    </Card>
  );
}
