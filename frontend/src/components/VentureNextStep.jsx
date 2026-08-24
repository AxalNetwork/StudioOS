// Venture next-step strip for /studio.
//
// WHY THIS EXISTS. A founder's front door opened on a Personal Advisor chatbot
// followed by ProfileFitSection — Skills graph, Values graph, Founder
// archetype, Best-fit matches. All about the person, none about the venture.
// The one surface that answers "what do I do next" is Command Center's
// Overview tab, and nothing on /studio linked to it: the closest thing, the
// "My Studio Ops Tasks" card, routes to /studio-ops which redirects founders to
// the OPERATIONS tab, not Overview — and only renders when they have assigned
// tasks at all.
//
// So this reads the same lifecycle endpoint LifecycleModule does
// (GET /api/progress/lifecycle/:id) and surfaces the identical `nextAction` —
// the first unchecked item on the current stage's checklist. Same source, same
// answer; a founder can never be told two different next steps depending on
// which page they opened.
//
// Deliberately a STRIP, not a module: it shows the stage, the one next action,
// and a link into Command Center. Reproducing the full rail here would give
// founders two places to check things off and two places for that state to
// drift.
//
// Renders nothing at all when there is no project or no lifecycle data. An
// empty "no next step" card on the front door is worse than the profile
// section it sits above — it implies the venture is done.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Compass } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

export default function VentureNextStep() {
  const [state, setState] = useState(null); // { projectName, stage, nextAction, done, total }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const projects = await api.listProjects();
        const project = Array.isArray(projects) && projects.length ? projects[0] : null;
        if (!project?.id) return;
        const lc = await api.getLifecycle(project.id);
        if (!alive) return;
        const checklist = Array.isArray(lc?.checklist) ? lc.checklist : [];
        if (!checklist.length && !lc?.stage) return;
        setState({
          projectName: project.name || 'Your venture',
          stage: lc?.stage || null,
          nextAction: checklist.find((i) => !i.done) || null,
          done: checklist.filter((i) => i.done).length,
          total: checklist.length,
        });
      } catch (e) {
        // Silent: this is an additive strip on a page that already works. A
        // failed fetch must not push an error banner above a founder's
        // dashboard.
        reportError('VentureNextStep:load', e);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!state) return null;

  const { projectName, stage, nextAction, done, total } = state;
  const complete = total > 0 && done === total;

  return (
    <div
      data-testid="venture-next-step"
      className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-900/20 p-5 mb-6"
    >
      <div className="flex items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Compass size={15} className="text-violet-700 dark:text-violet-400 flex-none" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400">
              {projectName}
            </span>
            {stage && (
              <span className="text-[11px] font-semibold text-violet-600/80 dark:text-violet-300/80">
                · {String(stage).replace(/_/g, ' ')}
              </span>
            )}
            {total > 0 && (
              <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                {done} of {total} done
              </span>
            )}
          </div>

          {complete ? (
            <p className="mt-1.5 text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
              <Check size={14} className="text-emerald-600 flex-none" />
              Everything on this stage is checked off.
            </p>
          ) : nextAction ? (
            <p className="mt-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
              Next: {nextAction.label}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
              Open your Studio dashboard to set your current stage.
            </p>
          )}
        </div>

        <Link
          to="/studio"
          data-testid="venture-next-step-link"
          className="flex-none inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
        >
          Open Studio <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
