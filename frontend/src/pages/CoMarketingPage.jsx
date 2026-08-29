/* Task #54 — Co-marketing pitch + admin approval + attribution.
 *
 * Three views in one page (driven by user role):
 *   - Partner: submit + manage your pitches, see attribution counts.
 *   - Admin: review queue → approve / reject / publish.
 *   - Anyone: published catalog of approved+live campaigns.
 */
import { useEffect, useState } from 'react';
import { safeExternalUrl } from '../lib/url';
import {
  Megaphone, Send, CheckCircle, XCircle, Loader2, Globe, Copy, Plus, BarChart3,
} from 'lucide-react';
import { api } from '../lib/api';
import PageExplainer from '../components/PageExplainer';

const ASSET_TYPES = ['webinar', 'blog', 'podcast', 'event', 'newsletter', 'other'];

function StatusPill({ status }) {
  const styles = {
    proposed: 'bg-amber-100 text-amber-800',
    approved: 'bg-blue-100 text-blue-800',
    published: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-red-100 text-red-800',
    withdrawn: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

function PitchForm({ onSubmitted }) {
  const initial = {
    title: '', summary: '', asset_type: 'webinar',
    proposed_date: '', target_audience: '', distribution_channels: '',
    co_branding_notes: '', asset_url: '',
  };
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    setErr(null); setBusy(true);
    try {
      await api.submitCoMarketingPitch({
        ...draft,
        proposed_date: draft.proposed_date ? new Date(draft.proposed_date).toISOString() : null,
        target_audience: draft.target_audience || null,
        distribution_channels: draft.distribution_channels || null,
        co_branding_notes: draft.co_branding_notes || null,
        asset_url: draft.asset_url || null,
      });
      setDraft(initial);
      onSubmitted();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
        <Plus size={16} /> Propose a co-marketing piece
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Title</label>
          <input value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. Webinar: Pricing for late-seed SaaS"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Asset type</label>
          <select value={draft.asset_type}
            onChange={(e) => setDraft({ ...draft, asset_type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700">
            {ASSET_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Summary</label>
          <textarea value={draft.summary} rows={3}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder="Pitch the audience, format, and what value you'll bring."
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Proposed date</label>
          <input type="datetime-local" value={draft.proposed_date}
            onChange={(e) => setDraft({ ...draft, proposed_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Target audience</label>
          <input value={draft.target_audience}
            onChange={(e) => setDraft({ ...draft, target_audience: e.target.value })}
            placeholder="seed-stage B2B founders"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Distribution channels</label>
          <input value={draft.distribution_channels}
            onChange={(e) => setDraft({ ...draft, distribution_channels: e.target.value })}
            placeholder="LinkedIn, partner newsletter, X"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Co-branding notes</label>
          <textarea value={draft.co_branding_notes} rows={2}
            onChange={(e) => setDraft({ ...draft, co_branding_notes: e.target.value })}
            placeholder="Logo treatment, lock-up, attribution requirements…"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Asset URL (deck, draft, outline)</label>
          <input value={draft.asset_url}
            onChange={(e) => setDraft({ ...draft, asset_url: e.target.value })}
            placeholder="https://docs.google.com/…"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button disabled={busy || !draft.title || draft.summary.length < 10} onClick={submit}
        className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        Submit for review
      </button>
    </div>
  );
}

function AttributionBadge({ counts }) {
  if (!counts) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-gray-600">
      <span className="flex items-center gap-1"><BarChart3 size={12} /> {counts.total} events</span>
      <span>· {counts.visit} visits</span>
      <span>· {counts.signup} signups</span>
      <span>· {counts.lead} leads</span>
      <span>· {counts.conversion} conv</span>
    </div>
  );
}

function CopyableCode({ code }) {
  const [copied, setCopied] = useState(false);
  if (!code) return <span className="text-xs text-gray-400">—</span>;
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs font-mono bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded inline-flex items-center gap-1">
      <Copy size={10} /> {copied ? 'copied' : code}
    </button>
  );
}


/* ------------------------------------------------------------------ *
 * Pitch detail drawer (Wave 2)                                        *
 *                                                                     *
 * `GET /api/comarketing/me/attributions` has been live since T15 and  *
 * `api.listMyCoMarketingAttributions` has existed in api.js with ZERO  *
 * consumers — the same shape as the rest of this pass: the backend was *
 * finished and nothing read it. A partner running a published campaign *
 * had every tracked visit, signup and lead sitting in D1 behind a      *
 * five-number badge.                                                   *
 *                                                                     *
 * Three things the canvas asks for are NOT here, each because the      *
 * fact is not recorded:                                                *
 *                                                                     *
 *   - Channel *reach*. `distribution_channels` is one free-text field  *
 *     the partner typed at pitch time. There is no audience-size       *
 *     number anywhere, so the proposed channels are shown as the prose *
 *     they are, and the counted breakdown comes from `referrer` on     *
 *     real attribution rows instead.                                   *
 *   - Lead *names*. `comarketing_attributions` stores `lead_email` and *
 *     nothing else about a person. Initials are derived from the       *
 *     address; a display name would be invented.                       *
 *   - "Angle" and "what you bring". Those are two columns              *
 *     `comarketing_pitches` does not have. Adding them is a migration, *
 *     not a port, and is deliberately left for a schema decision.      *
 * ------------------------------------------------------------------ */

// Monday-anchored week key, in UTC so a bucket does not move with the
// reader's timezone.
function weekStartUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow))
    .toISOString().slice(0, 10);
}

function addWeeks(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function fmtWeek(key) {
  const d = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// A referrer is a URL when the tracker captured one and free text when it
// did not. Neither is a "channel" the partner chose — it is where the click
// actually came from, which is the only channel figure that is measured.
function channelOf(referrer) {
  const raw = (referrer || '').trim();
  if (!raw) return 'Direct / not recorded';
  try {
    const h = new URL(raw).hostname.replace(/^www\./, '');
    if (h) return h;
  } catch { /* not a URL — fall through to the raw label */ }
  return raw.slice(0, 60);
}

function initialsOf(email) {
  const local = String(email || '').split('@')[0];
  const parts = local.split(/[^A-Za-z]+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

const LEAD_KINDS = new Set(['lead', 'conversion']);

function PitchDetailDrawer({ pitch, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setErr(null);
    api.listMyCoMarketingAttributions(pitch.uid)
      .then((d) => { if (!cancelled) setRows(d?.items || []); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load attribution events'); });
    return () => { cancelled = true; };
  }, [pitch.uid]);

  const counts = pitch.attribution || {};
  // The endpoint caps its result set. The tiles below therefore come from the
  // server's own GROUP BY (always the true total) while the chart and the
  // breakdown come from the returned rows — and the window is clipped to the
  // oldest row we actually hold so a missing older event can never render as
  // a zero week.
  const truncated = rows != null && counts.total != null && rows.length < counts.total;

  let weeks = [];
  let channels = [];
  let leads = [];
  if (rows) {
    const rowWeeks = rows.map((x) => weekStartUtc(x.created_at)).filter(Boolean).sort();
    const oldestHeld = rowWeeks[0] || null;
    const thisWeek = weekStartUtc(new Date().toISOString());
    if (oldestHeld && thisWeek) {
      const floor = addWeeks(thisWeek, -11);
      let cursor = oldestHeld > floor ? oldestHeld : floor;
      const byWeek = new Map();
      for (const x of rows) {
        if (!LEAD_KINDS.has(x.event_kind)) continue;
        const k = weekStartUtc(x.created_at);
        if (k) byWeek.set(k, (byWeek.get(k) || 0) + 1);
      }
      const acc = [];
      while (cursor <= thisWeek && acc.length < 12) {
        acc.push({ wk: cursor, n: byWeek.get(cursor) || 0 });
        cursor = addWeeks(cursor, 1);
      }
      weeks = acc;
    }

    const byChannel = new Map();
    for (const x of rows) {
      const name = channelOf(x.referrer);
      const cur = byChannel.get(name) || { name, events: 0, leads: 0 };
      cur.events += 1;
      if (LEAD_KINDS.has(x.event_kind)) cur.leads += 1;
      byChannel.set(name, cur);
    }
    channels = [...byChannel.values()].sort((a, b) => b.leads - a.leads || b.events - a.events).slice(0, 8);

    leads = rows.filter((x) => LEAD_KINDS.has(x.event_kind)).slice(0, 12);
  }

  const peak = weeks.reduce((m, b) => Math.max(m, b.n), 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-black/30" />
      <div className="w-full max-w-xl bg-white dark:bg-gray-900 h-full overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{pitch.title}</h2>
              <StatusPill status={pitch.status} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {pitch.asset_type}
              {pitch.published_at ? ` · published ${fmtStamp(pitch.published_at)}` : ` · created ${fmtStamp(pitch.created_at)}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Visits', counts.visit], ['Signups', counts.signup],
              ['Leads', counts.lead], ['Conversions', counts.conversion],
            ].map(([label, v]) => (
              <div key={label} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
                <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                  {v == null ? 'Not recorded' : v}
                </div>
              </div>
            ))}
          </div>

          {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}
          {!rows && !err && <div className="text-sm text-gray-500">Loading attribution events…</div>}

          {rows && rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">
              <p className="font-medium text-gray-700 dark:text-gray-300">No tracked events yet.</p>
              <p className="mt-1">
                Traffic is counted once your UTM code
                {pitch.attribution_code ? ` (${pitch.attribution_code})` : ''} appears on a link
                someone follows.
              </p>
            </div>
          )}

          {rows && rows.length > 0 && (
            <>
              {truncated && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Showing the most recent {rows.length} of {counts.total} events. The chart and
                  breakdown below cover that window only; the totals above are complete.
                </p>
              )}

              {weeks.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    Inbound leads attributed · by week
                  </h3>
                  <div className="flex items-end gap-1.5 h-24">
                    {weeks.map((b) => (
                      <div key={b.wk} className="flex-1 flex flex-col items-center justify-end gap-1">
                        <span className="text-[10px] text-gray-500 tabular-nums">{b.n}</span>
                        <div
                          className="w-full rounded-t bg-violet-500 min-h-[2px]"
                          style={{ height: peak > 0 ? `${Math.round((b.n / peak) * 100)}%` : '2px' }}
                        />
                        <span className="text-[9px] text-gray-400 whitespace-nowrap">{fmtWeek(b.wk)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Where the traffic came from
                </h3>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  {channels.map((ch) => (
                    <div key={ch.name} className="p-3 flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{ch.name}</span>
                      <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                        {ch.leads} leads · {ch.events} events
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Measured from the referrer on each tracked event. Audience reach per channel is
                  not recorded anywhere, so it is not shown.
                </p>
              </div>

              {leads.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    Recent leads on your profile
                  </h3>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                    {leads.map((l) => (
                      <div key={l.uid || l.id} className="p-3 flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                          {initialsOf(l.lead_email)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                            {l.lead_email || 'Email not recorded'}
                          </div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {fmtStamp(l.created_at)}
                            {l.landing_path ? ` · ${l.landing_path}` : ''}
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {l.event_kind}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {pitch.distribution_channels && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Channels you proposed
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {pitch.distribution_channels}
              </p>
              <p className="text-[11px] text-gray-400 mt-1">
                As written on the pitch — not a measured figure.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PartnerView() {
  const [pitches, setPitches] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openUid, setOpenUid] = useState(null);
  async function load() {
    setErr(null); setLoading(true);
    try {
      const d = await api.listMyCoMarketingPitches();
      setPitches(d.items || []);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setPitches([]);
      else setErr(e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <PitchForm onSubmitted={load} />
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">My pitches</h2>
        {err && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 mb-3">
            {err}
          </div>
        )}
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : pitches.length === 0 ? (
          <div className="text-sm text-gray-500">No pitches yet — propose one above.</div>
        ) : (
          <div className="space-y-2">
            {pitches.map((p) => (
              <div key={p.id} className="bg-white border border-gray-200 rounded p-4 dark:bg-gray-900 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{p.title}</div>
                      <StatusPill status={p.status} />
                      <span className="text-[11px] text-gray-500">{p.asset_type}</span>
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap dark:text-gray-300">{p.summary}</div>
                    {p.review_notes && (
                      <div className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-2 dark:border-gray-800">
                        <span className="font-medium">Reviewer notes:</span> {p.review_notes}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-gray-500">UTM code:</span>
                      <CopyableCode code={p.attribution_code} />
                      {p.published_url && (
                        <a href={safeExternalUrl(p.published_url)} target="_blank" rel="noreferrer"
                          className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                          <Globe size={12} /> Published
                        </a>
                      )}
                    </div>
                    <div className="mt-2"><AttributionBadge counts={p.attribution} /></div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <button onClick={() => setOpenUid(p.uid)}
                      className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1 rounded">
                      Details
                    </button>
                    {(p.status === 'proposed' || p.status === 'approved') && (
                      <button onClick={async () => {
                        if (!confirm('Withdraw this pitch?')) return;
                        try { await api.withdrawCoMarketingPitch(p.uid); load(); }
                        catch (e) { alert(e.message); }
                      }} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded dark:text-gray-200">
                        Withdraw
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {(() => {
        // Reloading the list can drop the open pitch (a withdrawal, a status
        // filter). Resolve first and render nothing rather than handing the
        // drawer an undefined pitch.
        const open = openUid ? pitches.find((x) => x.uid === openUid) : null;
        return open ? <PitchDetailDrawer pitch={open} onClose={() => setOpenUid(null)} /> : null;
      })()}
    </div>
  );
}

function AdminQueueRow({ pitch, onChange }) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [publishUrl, setPublishUrl] = useState('');
  async function act(kind) {
    setBusy(true);
    try {
      if (kind === 'approve') await api.approveCoMarketingPitch(pitch.uid, notes || null);
      else if (kind === 'reject') await api.rejectCoMarketingPitch(pitch.uid, notes || null);
      else if (kind === 'publish') await api.publishCoMarketingPitch(pitch.uid, { published_url: publishUrl || null, notes: notes || null });
      onChange();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-white border border-gray-200 rounded p-4 space-y-3 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center gap-2">
        <div className="font-semibold text-gray-900 dark:text-gray-100">{pitch.title}</div>
        <StatusPill status={pitch.status} />
        <span className="text-[11px] text-gray-500">{pitch.asset_type}</span>
        <span className="text-[11px] text-gray-500 ml-auto">
          {pitch.partner_name ? `${pitch.partner_name}${pitch.partner_company ? ` · ${pitch.partner_company}` : ''}` : `partner #${pitch.partner_id}`}
        </span>
      </div>
      <div className="text-sm text-gray-700 whitespace-pre-wrap dark:text-gray-300">{pitch.summary}</div>
      <div className="text-xs text-gray-500 space-x-2">
        {pitch.proposed_date && <span>Proposed: {new Date(pitch.proposed_date).toLocaleString()}</span>}
        {pitch.target_audience && <span>· Audience: {pitch.target_audience}</span>}
        {pitch.distribution_channels && <span>· Channels: {pitch.distribution_channels}</span>}
      </div>
      {pitch.asset_url && (
        <a className="text-xs text-violet-600 hover:underline" href={safeExternalUrl(pitch.asset_url)} target="_blank" rel="noreferrer">View asset</a>
      )}
      <textarea rows={2} value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Reviewer notes (optional, visible to partner)"
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
      {pitch.status === 'approved' && (
        <input value={publishUrl}
          onChange={(e) => setPublishUrl(e.target.value)}
          placeholder="Published URL (when going live)"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
      )}
      <div className="flex flex-wrap gap-2">
        {pitch.status === 'proposed' && (
          <>
            <button disabled={busy} onClick={() => act('approve')}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
              <CheckCircle size={12} /> Approve
            </button>
            <button disabled={busy} onClick={() => act('reject')}
              className="text-xs bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
              <XCircle size={12} /> Reject
            </button>
          </>
        )}
        {pitch.status === 'approved' && (
          <button disabled={busy} onClick={() => act('publish')}
            className="text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
            <Globe size={12} /> Mark published
          </button>
        )}
      </div>
      {pitch.attribution_code && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          UTM code: <CopyableCode code={pitch.attribution_code} />
          <AttributionBadge counts={pitch.attribution} />
        </div>
      )}
    </div>
  );
}

function AdminView() {
  const [filter, setFilter] = useState('proposed');
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setErr(null); setLoading(true);
    try {
      const d = await api.adminCoMarketingQueue(filter);
      setItems(d.items || []);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setItems([]);
      else setErr(e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700 dark:text-gray-300">Filter:</span>
        {['proposed', 'approved', 'published', 'rejected', 'withdrawn'].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-xs px-3 py-1 rounded-full ${filter === s ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {s}
          </button>
        ))}
      </div>
      {err && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{err}</div>
      )}
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">Nothing to show in “{filter}”.</div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => <AdminQueueRow key={p.id} pitch={p} onChange={load} />)}
        </div>
      )}
    </div>
  );
}

function PublishedFeed() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.listPublishedCoMarketing()
      .then((d) => setItems(d.items || []))
      .catch((e) => {
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg === 'not found') setItems([]);
        else setErr(e.message);
      });
  }, []);
  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (items.length === 0) return <div className="text-sm text-gray-500">No published pieces yet.</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((p) => (
        <div key={p.id} className="bg-white border border-gray-200 rounded p-4 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center gap-2 mb-1">
            <div className="font-semibold text-gray-900 dark:text-gray-100">{p.title}</div>
            <span className="text-[11px] text-gray-500">{p.asset_type}</span>
          </div>
          <div className="text-xs text-gray-500 mb-2">
            By {p.partner_name || 'partner'}{p.partner_company ? ` · ${p.partner_company}` : ''}
            {p.published_at && ` · ${new Date(p.published_at).toLocaleDateString()}`}
          </div>
          <div className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap dark:text-gray-300">{p.summary}</div>
          {p.published_url && (
            <a href={safeExternalUrl(p.published_url)} target="_blank" rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-violet-600 hover:underline">
              <Globe size={12} /> View
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export default function CoMarketingPage({ user }) {
  const role = (user?.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  const isPartner = role === 'partner';
  const [tab, setTab] = useState(isAdmin ? 'admin' : (isPartner ? 'mine' : 'published'));

  const tabs = [];
  if (isPartner || isAdmin) tabs.push({ id: 'mine', label: 'My pitches' });
  if (isAdmin) tabs.push({ id: 'admin', label: 'Review queue' });
  tabs.push({ id: 'published', label: 'Published' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-gray-100">
          <Megaphone size={22} /> Co-marketing
        </h1>
        <PageExplainer pageKey="co_marketing" />
        <p className="text-sm text-gray-600 mt-1">
          Pitch a webinar, blog post, or podcast. Once approved by Axal VC, the platform helps
          run + distribute it, and inbound demand is attributed back to your partner profile.
        </p>
      </div>

      <div className="flex border-b border-gray-200 gap-1 dark:border-gray-800">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mine' && <PartnerView />}
      {tab === 'admin' && <AdminView />}
      {tab === 'published' && <PublishedFeed />}
    </div>
  );
}
