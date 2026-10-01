/**
 * The Founder Studio's cards, and the one rule they share: a card whose read
 * failed says so, with a retry, and draws nothing else. It never shows an
 * error line above rows that read "Not recorded", and never the "select or
 * create a startup" prompt, because a failed project read is not an absent
 * project (D321).
 *
 * Kept apart from FounderStudioHome.jsx so a Node test can render them: the
 * home mounts PersonalAdvisor, whose imports reach Worker modules.
 */
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Unreadable, Unrecorded } from '../../ui';
import { parseSqliteUtc } from '../../lib/spinoutLab';

// The Lab card's figures, from /spinout-lab/state as the Worker sends it.
// `milestones` holds the milestones this account has completed, each with its
// week; nothing in the payload counts them, so they are counted here. The
// week's deliverable total lives in the Worker's catalog and is not sent, so
// it is not invented: the page says it is not recorded.
export function labSummary(lab) {
  if (!lab) return null;
  if (!lab.active) return { active: false };
  const week = Number.isFinite(Number(lab.week)) && Number(lab.week) > 0 ? Number(lab.week) : null;
  const milestones = Array.isArray(lab.milestones) ? lab.milestones : null;
  return {
    active: true,
    week,
    completed: milestones ? milestones.length : null,
    completedThisWeek: milestones && week != null ? milestones.filter((m) => Number(m?.week) === week).length : null,
    daysRemaining: Number.isFinite(Number(lab.days_remaining)) && lab.days_remaining !== null ? Number(lab.days_remaining) : null,
  };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The Deck card's figures. `versions` is /decks/by-project (newest version
// first, no slides); `detail` is /decks/:id for that version (its slides);
// `engagement` is /decks/:id/engagement (its share links and views, newest
// first, the latest 200 views). A share link names no recipient, so the card
// counts links, not investors. Each figure is null when its source did not
// answer; a source that answered with nothing is a real zero.
export function deckSummary({ versions, detail, engagement, now = Date.now() }) {
  const latest = versions?.[0] || null;
  if (!latest) return null;
  const shares = Array.isArray(engagement?.shares) ? engagement.shares : null;
  const views = Array.isArray(engagement?.views) ? engagement.views : null;
  const newestShare = shares?.length ? parseSqliteUtc(shares[0]?.created_at) : null;
  return {
    id: latest.id ?? null,
    version: Number.isFinite(Number(latest.version)) && latest.version !== null ? Number(latest.version) : null,
    savedAt: parseSqliteUtc(latest.created_at),
    slides: Array.isArray(detail?.slides) ? detail.slides.length : null,
    shareLinks: shares ? shares.length : null,
    lastSharedAt: newestShare,
    viewsThisWeek: views ? views.filter((v) => {
      const at = parseSqliteUtc(v?.created_at);
      return at && now - at.getTime() <= WEEK_MS;
    }).length : null,
  };
}

// The Raise card's "committed of target" share, when both are real amounts.
export function raisePercent(raised, target) {
  const r = typeof raised === 'number' || (typeof raised === 'string' && raised.trim() !== '') ? Number(raised) : NaN;
  const t = typeof target === 'number' || (typeof target === 'string' && target.trim() !== '') ? Number(target) : NaN;
  if (!Number.isFinite(r) || !Number.isFinite(t) || t <= 0 || r < 0) return null;
  return Math.round((r / t) * 100);
}

const shortDate = (d) => (d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d) : null);

// The Deck card's rows. The slide count and the engagement figures come from
// two further reads of the newest version; either can fail on its own, and
// then that part says so in place of its rows.
export function DeckRows({ deck, detailError, engagementError, onRetry }) {
  return (
    <>
      <MetricRow name="Version" result={deck?.version != null ? `v${deck.version}` : null} reason="The version list returned no version number." />
      {detailError
        ? <Unreadable what="The slide count" claim="This is not a claim that the deck is empty." onRetry={onRetry} />
        : <MetricRow name="Slides" result={deck?.slides ?? null} reason="The deck returned no slides list." />}
      <MetricRow name="Saved" result={shortDate(deck?.savedAt)} reason="The version list returned no save date." />
      {engagementError
        ? <Unreadable what="Deck engagement" claim="This is not a claim that no one viewed the deck." onRetry={onRetry} />
        : (
          <>
            <MetricRow name="Last shared" result={deck?.shareLinks == null ? null : deck.shareLinks === 0 ? 'Not shared yet' : `${deck.shareLinks} ${deck.shareLinks === 1 ? 'link' : 'links'}${deck.lastSharedAt ? ` · ${shortDate(deck.lastSharedAt)}` : ''}`} reason="The engagement read returned no share list." />
            <MetricRow name="Viewed" accent result={deck?.viewsThisWeek == null ? null : `${deck.viewsThisWeek}× this week`} reason="The engagement read returned no view list." />
          </>
        )}
    </>
  );
}

// The committed share of the target, drawn as the canvas's bar under the row.
export function RaiseProgress({ pct }) {
  return (
    <>
      <MetricRow name="Of target" accent result={pct != null ? `${pct}%` : null} reason="Needs both a round target and a committed amount." />
      {pct != null && (
        <div className="fs-bar" role="img" aria-label={`${pct}% of the round target committed`} data-testid="bar-founder-raise">
          <span style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </>
  );
}

export function LabRows({ lab }) {
  if (lab?.active === false) return <CardStatus>No active Lab sprint on this account.</CardStatus>;
  return (
    <>
      <MetricRow name={lab?.week != null ? `Week ${lab.week}` : 'Week'} accent result={lab?.completedThisWeek != null ? `${lab.completedThisWeek} done this week` : null} reason="The Lab returned no week or milestone list." />
      <MetricRow name="Of this week's deliverables" result={null} reason="The week's deliverable total is held by the Lab's catalog and is not sent to this page. Open the Lab for the week's checklist." />
      <MetricRow name="Milestones completed" result={lab?.completed ?? null} reason="The Lab returned no milestone list." />
      <MetricRow name="Days remaining" result={lab?.daysRemaining ?? null} reason="The Lab returned no sprint start." />
    </>
  );
}

export function StudioCard({ title, icon: Icon, to, action, wide, loading, error, claim, onRetry, empty, children }) {
  const slug = title.toLowerCase().replaceAll(' ', '-');
  return (
    <article className={`fs-card ${wide ? 'fs-wide' : ''}`} data-testid={`card-founder-${slug}`}>
      <div className="fs-card-head">
        <span><Icon size={15} />{title}</span>
        <Link to={to} data-testid={`link-founder-${slug}`}>{action}<ArrowUpRight size={13} /></Link>
      </div>
      {loading ? <CardStatus kind="loading">Loading live records…</CardStatus>
        : error ? <Unreadable what={title} claim={claim} onRetry={onRetry} />
        : empty ? <CardStatus>Select or create a startup to populate this module.</CardStatus>
        : children}
    </article>
  );
}

export function CardStatus({ kind = 'empty', children }) {
  return <p className={`fs-card-status fs-card-status-${kind}`}>{children}</p>;
}

export function MetricRow({ name, result, accent, reason }) { return <div className="fs-metric"><span>{name}</span><b className={accent ? 'fs-accent' : ''} data-testid={`value-founder-${name.toLowerCase().replaceAll(' ', '-').replaceAll("'", '')}`}>{result ?? <Unrecorded reason={reason} />}</b></div>; }
export function CompactList({ items, empty, render }) { return <div className="fs-list">{items.length ? items.slice(0, 3).map((item, index) => <div className="fs-list-item" key={item?.id || item?.uid || index} data-testid={`row-founder-record-${item?.id || item?.uid || index}`}>{render(item)}</div>) : <p className="fs-empty">{empty || 'No records available.'}</p>}</div>; }