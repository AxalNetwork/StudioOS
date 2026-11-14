import React from 'react';
import { Link } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import NetworkSubNav from '../../components/site/NetworkSubNav';
import { CIRCLE_TYPE_LABEL, ACCESS_TYPES } from '../../data/network';
import {
  HUB_LOADERS, useLiveList, useSiteStats, dirFigures, directoryTypeOf, directoryTypeLabel,
  directoryRole, initials, tintFor, dateParts, articleMeta, sectorLabel, words,
} from '../../lib/siteResources';
import './network.css';

/**
 * The Network section's hub, titled "Resources" (D679, #1553), from the
 * canvas's NETWORK HUB view. `/network` stays the signed-in workspace.
 *
 * The copy is the owner's. Every row is read live, from the read its own
 * section's page makes (`lib/siteResources.js` `HUB_LOADERS`): five directory
 * rows, four events, three articles, three circles and four roles. A block
 * whose list is empty, or fails to load, says so in one sentence. The header's
 * figures are the stats endpoint's directory counts (D675), each drawn only
 * when the endpoint returns it as a positive number.
 *
 * The directory block shows only what `GET /api/public/partners` already gives
 * a logged-out visitor: a name, a company and headline, and the entity type.
 */

const ACCESS_LABEL = Object.fromEntries(ACCESS_TYPES.map((a) => [a.id, a.label]));

/** The canvas's event-kind tints, keyed by the live event types. */
const KIND_TINT = { demo_day: '', office_hours: 'ax-chip-teal' };
const kindClass = (type) => (type in KIND_TINT ? `ax-chip ${KIND_TINT[type]}`.trim() : 'ax-chip ax-chip-quiet');

function Panel({ id, title, more, moreTo, children, foot }) {
  return (
    <section className="ax-nw-panel" aria-labelledby={id}>
      <div className="ax-nw-panel-head">
        <h2 id={id} className="ax-lbl-q ax-nw-panel-k">{title}</h2>
        <Link to={moreTo} className="ax-nw-more">{more}</Link>
      </div>
      {children}
      {foot}
    </section>
  );
}

/** Rows, a loading line, or the empty sentence. */
function LiveRows({ items, empty, children }) {
  if (items === null) return <p className="ax-nw-empty">Loading…</p>;
  if (!items || items.length === 0) return <p className="ax-nw-empty">{empty}</p>;
  return <ul className="ax-nw-list">{items.map(children)}</ul>;
}

function HubHeader({ stats }) {
  const figures = dirFigures(stats);
  return (
    <div className="ax-res-head">
      <div>
        <div className="ax-lbl-q">Network</div>
        <h1 id="ax-res-h" className="ax-res-h1">Resources</h1>
        <p className="ax-res-lede">
          Directory, writing, programs, circles, and open roles. Members see full profiles and request introductions; the rest is open to read.
        </p>
      </div>
      {figures.length > 0 && (
        <ul className="ax-res-figs" aria-label="The network in figures">
          {figures.map((f) => (
            <li key={f.key} className="ax-res-fig">
              <span className="ax-mono ax-res-fig-v">{f.value.toLocaleString('en-US')}</span>
              <span className="ax-res-fig-k">{f.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DirectoryBlock({ members }) {
  return (
    <Panel
      id="ax-res-dir-h"
      title="Directory"
      more="Browse all →"
      moreTo="/directory"
      foot={(
        <div className="ax-nw-note">
          Verified members only.
          <Link to="/contact" className="ax-nw-more">Request directory access →</Link>
        </div>
      )}
    >
      <LiveRows items={members} empty="No one is listed in the directory yet.">
        {(m) => (
          <li key={m.slug}>
            <Link to={`/partners/${encodeURIComponent(m.slug)}`} className="ax-nw-row ax-res-member">
              <span className="ax-nw-av" style={{ background: tintFor(m.slug) }} aria-hidden="true">{initials(m.name)}</span>
              <span className="ax-nw-row-main">
                <span className="ax-nw-row-t">{m.name}</span>
                {directoryRole(m) && <span className="ax-nw-row-s">{directoryRole(m)}</span>}
              </span>
              <span className="ax-chip ax-chip-quiet">{directoryTypeLabel(directoryTypeOf(m))}</span>
            </Link>
          </li>
        )}
      </LiveRows>
    </Panel>
  );
}

export function EventsBlock({ events }) {
  return (
    <Panel id="ax-res-events-h" title="Programs & events" more="Calendar →" moreTo="/events">
      <LiveRows items={events} empty="Nothing is scheduled right now.">
        {(ev) => {
          const when = dateParts(ev.starts_at, ev.timezone);
          return (
            <li key={ev.id ?? ev.slug}>
              <Link to={`/events/${encodeURIComponent(ev.slug || ev.id)}`} className="ax-nw-row">
                <span className="ax-nw-date" aria-hidden={when ? undefined : 'true'}>
                  <span className="ax-mono ax-nw-date-d">{when?.day || '—'}</span>
                  <span className="ax-lbl-q ax-nw-date-m">{when?.mon || ''}</span>
                </span>
                <span className="ax-nw-row-main">
                  <span className="ax-nw-row-t">{ev.title}</span>
                  <span className="ax-nw-row-meta">
                    {ev.type && <span className={kindClass(ev.type)}>{words(ev.type)}</span>}
                    {when?.time && <span className="ax-mono ax-nw-small">{when.time}</span>}
                  </span>
                </span>
              </Link>
            </li>
          );
        }}
      </LiveRows>
    </Panel>
  );
}

export function ArticlesBlock({ articles, sectors }) {
  return (
    <Panel id="ax-res-articles-h" title="Articles" more="All articles →" moreTo="/articles">
      <LiveRows items={articles} empty="No articles are published yet.">
        {(a) => {
          const meta = articleMeta(a);
          return (
            <li key={a.id ?? a.slug}>
              <Link to={`/articles/${encodeURIComponent(a.slug)}`} className="ax-nw-row ax-res-art">
                <span className="ax-nw-row-meta ax-res-art-meta">
                  {a.sector && <span className="ax-chip">{sectorLabel(sectors, a.sector)}</span>}
                  {meta && <span className="ax-mono ax-nw-small">{meta}</span>}
                </span>
                <span className="ax-nw-row-t">{a.title}</span>
              </Link>
            </li>
          );
        }}
      </LiveRows>
    </Panel>
  );
}

export function CirclesBlock({ circles }) {
  return (
    <Panel id="ax-res-circles-h" title="Communities & circles" more="All circles →" moreTo="/circles">
      <LiveRows items={circles} empty="No circles are open yet.">
        {(c) => {
          const sub = [
            CIRCLE_TYPE_LABEL[c.type] || (c.type ? words(c.type) : null),
            c.region,
            Number(c.members) > 0 ? `${Number(c.members).toLocaleString('en-US')} members` : null,
          ].filter(Boolean).join(' · ');
          const isPrivate = c.access === 'private';
          return (
            <li key={c.id ?? c.slug}>
              <Link to="/circles" className="ax-nw-row ax-res-circle">
                <span className="ax-nw-row-main">
                  <span className="ax-nw-row-t">{c.name}</span>
                  {sub && <span className="ax-nw-row-s">{sub}</span>}
                </span>
                {c.access && (
                  <span className={isPrivate ? 'ax-chip ax-chip-quiet' : 'ax-chip ax-chip-green'}>
                    {ACCESS_LABEL[c.access] || words(c.access)}
                  </span>
                )}
              </Link>
            </li>
          );
        }}
      </LiveRows>
    </Panel>
  );
}

export function JobsBlock({ jobs }) {
  return (
    <Panel id="ax-res-jobs-h" title="Jobs" more="All roles →" moreTo="/jobs">
      <LiveRows items={jobs} empty="No open roles right now.">
        {(j) => {
          const sub = [j.startup_name, j.remote ? 'Remote' : j.location_text].filter(Boolean).join(' · ');
          return (
            <li key={j.id ?? j.slug}>
              <Link to={`/jobs/${encodeURIComponent(j.slug)}`} className="ax-nw-row ax-res-job">
                <span className="ax-nw-av" style={{ background: tintFor(j.startup_name || j.slug) }} aria-hidden="true">
                  {initials(j.startup_name || j.title)}
                </span>
                <span className="ax-nw-row-main">
                  <span className="ax-nw-row-t">{j.title}</span>
                  {sub && <span className="ax-nw-row-s">{sub}</span>}
                </span>
              </Link>
            </li>
          );
        }}
      </LiveRows>
    </Panel>
  );
}

/**
 * The hub's body, from data it is handed: the stats, the five lists (each
 * null while loading, [] when empty or failed) and the article taxonomy.
 */
export function ResourcesBody({ stats, members, events, articles, sectors, circles, jobs }) {
  return (
    <div className="ax-wrap ax-nw ax-nw-hub">
      <HubHeader stats={stats} />
      <div className="ax-res-2">
        <DirectoryBlock members={members} />
        <EventsBlock events={events} />
      </div>
      <div className="ax-res-3">
        <ArticlesBlock articles={articles} sectors={sectors} />
        <CirclesBlock circles={circles} />
        <JobsBlock jobs={jobs} />
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  const stats = useSiteStats();
  const members = useLiveList(HUB_LOADERS.members);
  const events = useLiveList(HUB_LOADERS.events);
  const articles = useLiveList(HUB_LOADERS.articles);
  const sectors = useLiveList(HUB_LOADERS.sectors);
  const circles = useLiveList(HUB_LOADERS.circles);
  const jobs = useLiveList(HUB_LOADERS.jobs);
  return (
    <SitePage title="Resources">
      <NetworkSubNav />
      <ResourcesBody
        stats={stats} members={members} events={events} articles={articles} sectors={sectors} circles={circles} jobs={jobs}
      />
    </SitePage>
  );
}
