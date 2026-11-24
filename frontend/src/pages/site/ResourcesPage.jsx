import React from 'react';
import { Link } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import NetworkSubNav from '../../components/site/NetworkSubNav';
import { CIRCLE_TYPE_LABEL, ACCESS_TYPES } from '../../data/network';
import {
  HUB_LOADERS, useLiveList, useSiteStatsRead, dirFigures, directoryTypeOf, directoryTypeLabel,
  directoryRole, initials, tintFor, dateParts, articleMeta, sectorLabel, words, listRead, statsRead,
} from '../../lib/siteResources';
import { useCohortRecord } from '../../lib/spinoutLab';
import { LabProgramSlot, hasOpenCohort } from '../../components/site/LabProgramCard';
import { DataState } from '../../ui/Honesty';
import './network.css';

/**
 * The Network section's hub, titled "Resources" (D679, #1553), from the
 * canvas's NETWORK HUB view. `/network` stays the signed-in workspace.
 *
 * The copy is the owner's. Every row is read live, from the read its own
 * section's page makes (`lib/siteResources.js` `HUB_LOADERS`): five directory
 * rows, four events, three articles, three circles and four roles. The
 * Programs & events block also draws the Spin-Out Lab's open cohort with the
 * one `LabProgramCard` `/events` draws, from the cohort record (D6992).
 * The header's figures are the stats endpoint's directory counts (D675), each
 * drawn only when the endpoint returns it as a positive number.
 *
 * D6992 (#6992): every read is in one state (`lib/siteResources.js`
 * `listRead`). A block whose read answered no rows says so in its own
 * sentence; programmes and events each have their own. A block whose read
 * FAILED says "Unavailable. We could not load this list." with Try again, never
 * the empty sentence, and a failed stats read says the figures are
 * unavailable rather than drawing none. Blocks with rows come before blocks
 * without, in the canvas's order within each group.
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

/** What a failed list read draws, after "Unavailable". */
export const LIST_UNAVAILABLE = 'We could not load this list.';

/**
 * Rows, a loading line, the empty sentence, or Unavailable with Try again.
 * `items` is a read (`useLiveList`'s value) or, for a caller holding plain
 * data, an array or null (`listRead`).
 */
function LiveRows({ items, empty, children }) {
  const read = listRead(items);
  if (read.state === 'loading') return <p className="ax-nw-empty">Loading…</p>;
  if (read.state === 'unavailable') {
    return (
      <div className="ax-nw-empty" data-testid="hub-list-unavailable">
        <DataState state="unavailable" claim={LIST_UNAVAILABLE} onRetry={read.retry} retryLabel="Try again" />
      </div>
    );
  }
  if (read.state === 'empty') return <p className="ax-nw-empty">{empty}</p>;
  return <ul className="ax-nw-list">{read.items.map(children)}</ul>;
}

/** True when a block's read holds rows to draw. */
const hasRows = (value) => listRead(value).state === 'loaded';

function HubHeader({ stats }) {
  const read = statsRead(stats);
  const figures = dirFigures(read.stats);
  return (
    <div className="ax-res-head">
      <div>
        <div className="ax-lbl-q">Network</div>
        <h1 id="ax-res-h" className="ax-res-h1">Resources</h1>
        <p className="ax-res-lede">
          Directory, writing, programs, circles, and open roles. Members see full profiles and request introductions; the rest is open to read.
        </p>
      </div>
      {read.state === 'unavailable' && (
        <div className="ax-res-figs-off" data-testid="hub-figures-unavailable">
          <DataState state="unavailable" claim="We could not load the network's figures." onRetry={read.retry} retryLabel="Try again" />
        </div>
      )}
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
          <Link to="/contact?topic=directory" className="ax-nw-more">Request directory access →</Link>
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

/** The events' own empty line, apart from the programmes' line (D6992). */
export const EVENTS_EMPTY = 'No events are scheduled right now.';

export function EventsBlock({ events, cohort }) {
  return (
    <Panel id="ax-res-events-h" title="Programs & events" more="Calendar →" moreTo="/events">
      <h3 className="ax-lbl-q ax-res-sub">Programs</h3>
      <LabProgramSlot read={cohort} wrap={(card) => <div className="ax-res-program">{card}</div>} />
      <h3 className="ax-lbl-q ax-res-sub">Events</h3>
      <LiveRows items={events} empty={EVENTS_EMPTY}>
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
 * The hub's body, from data it is handed: the stats, the five lists, the
 * article taxonomy and the cohort record. Each list is a read (`useLiveList`)
 * or plain data (null while loading, an array once read); `cohort` is
 * `useCohortRecord`'s value. Blocks with rows come first, then the rest, each
 * group in the canvas's order; the first two fill the wide row.
 */
export function ResourcesBody({ stats, members, events, articles, sectors, circles, jobs, cohort }) {
  const sectorRows = listRead(sectors).items || [];
  const blocks = [
    { key: 'directory', rows: hasRows(members), el: <DirectoryBlock key="directory" members={members} /> },
    { key: 'events', rows: hasRows(events) || hasOpenCohort(cohort), el: <EventsBlock key="events" events={events} cohort={cohort} /> },
    { key: 'articles', rows: hasRows(articles), el: <ArticlesBlock key="articles" articles={articles} sectors={sectorRows} /> },
    { key: 'circles', rows: hasRows(circles), el: <CirclesBlock key="circles" circles={circles} /> },
    { key: 'jobs', rows: hasRows(jobs), el: <JobsBlock key="jobs" jobs={jobs} /> },
  ];
  const ordered = [...blocks.filter((b) => b.rows), ...blocks.filter((b) => !b.rows)];
  return (
    <div className="ax-wrap ax-nw ax-nw-hub">
      <HubHeader stats={stats} />
      <div className="ax-res-2">{ordered.slice(0, 2).map((b) => b.el)}</div>
      <div className="ax-res-3">{ordered.slice(2).map((b) => b.el)}</div>
    </div>
  );
}

export default function ResourcesPage() {
  const stats = useSiteStatsRead();
  const members = useLiveList(HUB_LOADERS.members);
  const events = useLiveList(HUB_LOADERS.events);
  const articles = useLiveList(HUB_LOADERS.articles);
  const sectors = useLiveList(HUB_LOADERS.sectors);
  const circles = useLiveList(HUB_LOADERS.circles);
  const jobs = useLiveList(HUB_LOADERS.jobs);
  const cohort = useCohortRecord();
  return (
    <SitePage title="Resources">
      <NetworkSubNav />
      <ResourcesBody
        stats={stats} members={members} events={events} articles={articles} sectors={sectors} circles={circles} jobs={jobs} cohort={cohort}
      />
    </SitePage>
  );
}
