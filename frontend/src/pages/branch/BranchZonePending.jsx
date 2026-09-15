import React from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { Card } from '../../ui';

/**
 * What a branch admin sees on a sidebar row whose artboard is not built yet
 * (D107).
 *
 * WHY A ROUTE WITH A NOTICE RATHER THAN NO ROW. `sidebarConfig.js` states
 * plainly that a row pointing at a route that does not exist "looks shipped
 * and 404s". That rule is about a 404, not about a row: every branch row HAS
 * a route, and the ones that land here say which artboard they are, what will
 * be on them, and which PR builds them. The alternative — shipping only the
 * rows whose pages exist — would be a one-row sidebar, which is not the
 * Admin · Subsidiary canvas and does not answer the question the frame exists
 * to answer, namely whose data this is.
 *
 * IT NAMES A PR, WHICH DATES IT ON PURPOSE. A notice that says "coming soon"
 * is unfalsifiable and survives forever. One that names the build is wrong
 * the moment that build lands, which is what makes it get removed.
 *
 * Every prop is required and there is no default: a zone that reached this
 * component without saying what it will show would be rendering the same
 * apology eight times, which is the failure `AdvisorPreviewNotice` was
 * rebuilt to stop (#186).
 */
export default function BranchZonePending({ artboard, title, will, pr }) {
  return (
    <Card className="border-dashed bg-axal-ground p-6" data-testid="branch-zone-pending">
      <div className="max-w-2xl">
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Landmark size={13} /> {artboard} · not built yet
        </div>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">{title}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">{will}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">
          This row is in the sidebar because the subsidiary navigation is the canvas&rsquo;s
          eight rows, not the subset that happens to be built. It is a stated absence, not
          a broken link: nothing on this page will start working without a deploy, and{' '}
          {pr} is the one that brings it.
        </p>
        <p className="mt-3 flex flex-wrap gap-3 text-[12px]">
          <Link to="/admin/my-licence" className="text-slate-700 underline dark:text-slate-300">
            Your licence &rarr;
          </Link>
          <Link to="/admin" className="text-slate-700 underline dark:text-slate-300">
            Admin Console &rarr;
          </Link>
        </p>
      </div>
    </Card>
  );
}
