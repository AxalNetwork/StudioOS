import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Plus } from 'lucide-react';
import { CHANNEL_RULE, handleChange, linksView } from './influencerSectionModel';
import { BlockUnreadable, CopyButton, FIELD, Figure, INK, Loading, MUTED, Panel, SECONDARY, TwoStep } from './InfluencerParts';

/**
 * D4289 P7 (#4296), IN2 — Links at `/influencer/links`: the handle (changed at
 * most every 30 days; the Worker says when), the page line, and one channel
 * link per place the influencer posts, each with its visits, sign-ups and
 * paid members from the analytics reply's channels — or Not recorded or
 * Unreadable in place. Archive is a two-step press; a link is archived on the
 * Worker, never deleted.
 */
export default function LinksTab({ handle, links, analytics, accent, reads, onChanged, onRetry }) {
  if (!handle || !links || [handle, links, analytics].some((x) => x?.status === 'loading')) return <Loading />;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-testid="influencer-links">
      <div className="flex flex-col gap-4">
        {handle.status === 'error'
          ? <BlockUnreadable what="Your handle" onRetry={onRetry} />
          : <HandleCard data={handle.data} accent={accent} reads={reads} onChanged={onChanged} />}
        {links.status === 'error'
          ? <BlockUnreadable what="Your channel links" onRetry={onRetry} />
          : <ChannelLinks reply={links.data} analytics={analytics?.status === 'ok' ? analytics.data : null} reads={reads} onChanged={onChanged} />}
      </div>
      <div className="flex flex-col gap-4">
      <QrPanel links={links.status === 'ok' ? links.data : null} handle={handle.data} />
      <Panel title="Your public page" sub={handle.data?.url ? String(handle.data.url).replace(/^https?:\/\//, '') : undefined} testId="links-public-page">
        <p className={`text-sm ${INK}`}>{handle.data?.line || <span className={MUTED}>No line yet. Add one beside your handle.</span>}</p>
        <p className={`mt-3 text-xs ${MUTED}`}>Your page shows the disclosure under your offer: you earn a commission when someone subscribes. Axal memberships are software, not an investment.</p>
      </Panel>
      </div>
    </div>
  );
}

/** IN2's QR code for the handle or one channel link; a PNG to download. Drawn on white: a dark ground stops it scanning. */
function QrPanel({ links, handle }) {
  const options = [
    ...(handle?.url ? [{ key: '', label: handle.handle ? `@${handle.handle}` : 'Your handle', url: handle.url }] : []),
    ...(Array.isArray(links?.links) ? links.links.map((l) => ({ key: l.uid, label: `@${links.handle}/${l.channel}`, url: l.url })) : []),
  ];
  const [pick, setPick] = useState('');
  const [src, setSrc] = useState(null);
  const chosen = options.find((o) => o.key === pick) || options[0] || null;
  const url = chosen?.url || null;
  useEffect(() => {
    let live = true;
    if (!url) { setSrc(null); return undefined; }
    QRCode.toDataURL(url, { margin: 1, width: 168 }).then((d) => { if (live) setSrc(d); }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [url]);
  if (!chosen) return null;
  return (
    <Panel title="QR code" sub={chosen.label} testId="links-qr">
      {options.length > 1 && (
        <select className={FIELD} value={chosen.key} onChange={(e) => setPick(e.target.value)} aria-label="The link the QR code opens">
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      )}
      {/* dark-mode-exempt: the quiet zone behind a QR code stays white so it scans. */}
      <div className="mt-3 flex justify-center rounded-lg bg-white p-2">
        {src ? <img src={src} width={168} height={168} alt={`QR code for ${chosen.label}`} /> : <span className="text-xs text-[#6b6577]">Drawing…</span>}
      </div>
      {src && <a href={src} download="axal-qr.png" className={`${SECONDARY} mt-3`}>Download PNG</a>}
    </Panel>
  );
}

function refusalText(e) {
  return e?.message || e?.detail || 'That could not be saved. Nothing was changed; try again.';
}

function HandleCard({ data, accent, reads, onChanged }) {
  const rule = handleChange(data);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ handle: data?.handle || '', line: data?.line || '' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const save = async () => {
    setBusy(true); setSaid(null);
    const body = {};
    if (draft.handle && draft.handle !== data?.handle) body.handle = draft.handle.trim();
    if (draft.line !== (data?.line || '')) body.line = draft.line;
    try {
      await reads.setHandle(body);
      setOpen(false);
      onChanged?.();
    } catch (e) { setSaid(refusalText(e)); } finally { setBusy(false); }
  };
  return (
    <Panel title="Your handle" testId="links-handle"
      right={<button type="button" className={SECONDARY} onClick={() => setOpen((o) => !o)} data-testid="links-edit-handle">Edit handle and line</button>}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-mono text-xl font-semibold ${INK}`}>{data?.handle ? `axal.vc/@${data.handle}` : 'No handle yet'}</span>
        <CopyButton text={data?.url} aria="Copy your handle link" />
      </div>
      <p className={`mt-1 text-xs ${MUTED}`} data-testid="links-handle-rule">{rule.line}</p>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <label className={`text-xs font-semibold ${MUTED}`}>Handle
            <input className={FIELD} value={draft.handle} disabled={!rule.canChange} onChange={(e) => setDraft({ ...draft, handle: e.target.value })} />
          </label>
          <label className={`text-xs font-semibold ${MUTED}`}>The line on your page
            <input className={FIELD} value={draft.line} maxLength={160} onChange={(e) => setDraft({ ...draft, line: e.target.value })} />
          </label>
          {said && <p className="text-xs text-red-700 dark:text-red-300" role="alert">{said}</p>}
          <div><button type="button" className={`inline-flex min-h-[36px] items-center rounded-lg px-3 text-xs font-semibold ${accent.button}`} disabled={busy} onClick={save}>Save</button></div>
        </div>
      )}
    </Panel>
  );
}

function ChannelLinks({ reply, analytics, reads, onChanged }) {
  const v = linksView(reply, analytics);
  const [draft, setDraft] = useState({ channel: '', utm_campaign: '' });
  const [said, setSaid] = useState(null);
  const [busy, setBusy] = useState(false);
  const valid = CHANNEL_RULE.test(draft.channel);
  const add = async () => {
    setBusy(true); setSaid(null);
    try {
      await reads.addLink({ channel: draft.channel, ...(draft.utm_campaign.trim() ? { utm_campaign: draft.utm_campaign.trim() } : {}) });
      setDraft({ channel: '', utm_campaign: '' });
      onChanged?.();
    } catch (e) { setSaid(refusalText(e)); } finally { setBusy(false); }
  };
  const archive = async (uid) => {
    try { await reads.archiveLink(uid); onChanged?.(); } catch (e) { setSaid(refusalText(e)); }
  };
  return (
    <Panel title="Channel links" sub="One link per place you post, so you can see what works." testId="links-channels">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className={`flex-1 text-xs font-semibold ${MUTED}`}>Channel (yt, x, newsletter)
          <input className={FIELD} value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value.toLowerCase() })} placeholder={v.handle ? `@${v.handle}/podcast` : 'podcast'} />
        </label>
        <label className={`flex-1 text-xs font-semibold ${MUTED}`}>UTM campaign (optional)
          <input className={FIELD} value={draft.utm_campaign} onChange={(e) => setDraft({ ...draft, utm_campaign: e.target.value })} />
        </label>
        <button type="button" className={SECONDARY} disabled={!valid || busy} onClick={add} data-testid="links-add"><Plus size={13} aria-hidden="true" /> Add link</button>
      </div>
      {said && <p className="mb-2 text-xs text-red-700 dark:text-red-300" role="alert">{said}</p>}
      {!v.rows.length && <p className={`text-sm ${MUTED}`} data-testid="links-none">No channel links yet. Your handle link works on its own.</p>}
      {v.rows.length > 0 && (
        <div role="table" className="w-full text-sm" data-testid="links-table">
          <div role="row" className={`grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.7fr))_auto] gap-2 border-b border-[#ececf1] pb-1 text-xs font-semibold dark:border-gray-700 ${MUTED}`}>
            <span role="columnheader">Link</span><span role="columnheader" className="text-right">Visits</span><span role="columnheader" className="text-right">Sign-ups</span><span role="columnheader" className="text-right">Paid</span><span role="columnheader"><span className="sr-only">Actions</span></span>
          </div>
          {v.rows.map((r) => (
            <div role="row" key={r.uid} className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.7fr))_auto] items-center gap-2 py-1.5" data-testid={`link-row-${r.channel}`}>
              <span role="cell" className="min-w-0">
                <span className={`block truncate font-mono text-xs ${INK}`}>{r.label}</span>
                {r.campaign && <span className={`block text-[11px] ${MUTED}`}>Campaign: {r.campaign}</span>}
              </span>
              <span role="cell" className="text-right"><Figure f={r.visits} className="text-sm" /></span>
              <span role="cell" className="text-right"><Figure f={r.signups} className="text-sm" /></span>
              <span role="cell" className="text-right"><Figure f={r.paid} className="text-sm" /></span>
              <span role="cell" className="flex gap-1">
                <CopyButton text={r.url} aria={`Copy ${r.label}`} />
                <TwoStep label="Archive" confirmLabel={`Archive ${r.label}`} onConfirm={() => archive(r.uid)} testId={`link-archive-${r.channel}`} />
              </span>
            </div>
          ))}
        </div>
      )}
      <p className={`mt-2 text-[11px] ${MUTED}`}>Archive takes a link off this list; it is kept, never deleted.</p>
    </Panel>
  );
}
