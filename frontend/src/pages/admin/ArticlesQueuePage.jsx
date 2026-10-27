import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminArticles as api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import ToastMessage from '../../components/ToastMessage';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { RailFrame, WorkerRail } from '../../ui';
import AdminPageHeader, { HeaderTab } from '../../ui/AdminPageHeader';
import { PAGE_LINE, QUEUE_BASE, QUEUE_TABS, WAITS, viewOf } from './contentQueueModel';
import AuthorsTab from './contentQueue/AuthorsTab';
import ContentCalendar from './contentQueue/Calendar';
import PerformanceTab from './contentQueue/PerformanceTab';
import Pipeline from './contentQueue/Pipeline';
import ReviewDrawer from './contentQueue/ReviewDrawer';

// Admin /admin/articles review queue — the single "Content Queue" (Task #3
// merged the former News + Articles admin queues). /admin/news redirects here.
// D1290 (#2383): four tabs at their own addresses (`contentQueueModel.js`).
// D1295 (#3391): Pipeline is `contentQueue/` — the board and list, the review
// drawer at `/admin/articles/<id>` and its in-page dialogs (ART1–ART6,
// ART13–ART16). Calendar is D1296 and Authors and Performance are D1297.
// Every change opens a dialog; there is no browser pop-up.

/** D1290: a tab whose build is a slot task says what it waits on and where today's version is (D1290 §4). */
function QueueWait({ tab }) {
  const w = WAITS[tab];
  return (
    <section className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-6 dark:border-slate-700 dark:bg-slate-900" data-testid={`content-queue-wait-${tab}`}>
      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{w.title}</h2>
      {w.lines.map((l) => <p key={l} className="mt-2 text-sm text-slate-600 dark:text-slate-400">{l}</p>)}
    </section>
  );
}

export default function ArticlesQueuePage() {
  const { toast: current, showToast, dismissToast } = useToast();
  const { user } = useAuth() || {};
  const superAdmin = isSuperAdminUser(user);
  // ART16: the Admin's view differs only in what is offered (no Feature, no crumb); the Worker decides the rest.
  const viewer = { userId: user?.id ?? null, superAdmin };
  // D1290: the open article is the address's, so a notice or a shared link opens it.
  const navigate = useNavigate();
  const location = useLocation();
  const view = viewOf(location.pathname);
  const [changed, setChanged] = useState(0);
  const notify = (kind, msg) => showToast({ kind: kind === 'success' ? 'success' : 'error', msg });

  // D775 (#2101): H19 drew no rail. A plain admin reviews here too, so the rail takes the viewer's tier, as ContractsDesk does.
  const railProps = { note: 'Eadwyn reads the queue on this page. Approving, rejecting and scheduling stay yours.' };
  const rail = superAdmin ? <WorkerRail {...railProps} workspace="Content queue" role="super_admin" data-testid="hq-content-queue-rail" /> : <WorkerRail {...railProps} workspace="Content queue" role="admin" data-testid="admin-content-queue-rail" />;

  return (
    <RailFrame rail={rail} data-testid="content-queue-page">
    <div className="max-w-7xl mx-auto p-6">
      <ToastMessage toast={current} onDismiss={dismissToast} />
      <AdminPageHeader
        crumb={superAdmin ? { label: 'Content', to: '/admin/content', current: 'Content queue' } : null}
        title="Content queue"
        line={PAGE_LINE}
        tabs={QUEUE_TABS.map((t) => (
          <HeaderTab key={t.key} to={t.to} end={t.key !== 'pipeline'} data-testid={`content-queue-tab-${t.key}`}>{t.label}</HeaderTab>
        ))}
        data-testid="content-queue-header"
      />

      {view.tab === 'calendar' ? <ContentCalendar api={api} /> : view.tab === 'authors' ? <AuthorsTab /> : view.tab === 'performance' ? <PerformanceTab /> : view.tab !== 'pipeline' ? <QueueWait tab={view.tab} /> : (
        <Pipeline
          viewer={viewer}
          refreshKey={changed}
          drawer={view.id ? (
            <ReviewDrawer
              key={view.id}
              id={view.id}
              viewer={viewer}
              notify={notify}
              onChanged={() => setChanged((n) => n + 1)}
              onClose={() => navigate({ pathname: QUEUE_BASE, search: location.search })}
            />
          ) : null}
        />
      )}
    </div>
    </RailFrame>
  );
}
