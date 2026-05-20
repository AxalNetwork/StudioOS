# EmptyState / ErrorState / Skeleton — usage cheatsheet

Task #3 (IC) — Beta polish library. Drop these into every list, feed,
or fetch surface so a fresh account never sees blank space or a console
error.

## EmptyState (`./EmptyState.jsx`)
```jsx
import EmptyState from '../components/EmptyState';
import { Sparkles } from 'lucide-react';

{projects.length === 0 ? (
  <EmptyState
    icon={Sparkles}
    title="No projects yet"
    body="Create your first venture project to get started."
    cta={{ label: 'New project', to: '/projects/new' }}
    secondary={{ label: 'Learn more', to: '/docs#core/projects' }}
  />
) : (
  <ProjectTable rows={projects} />
)}
```

`cta` / `secondary` accept either `to` (in-app `<Link>`), `href`
(external `<a>` with `target=_blank` when `external: true`), or
`onClick` (e.g. open a "New project" modal).

## ErrorState (`./ErrorState.jsx`)
```jsx
const [error, setError] = useState(null);
const load = useCallback(async () => {
  try { setError(null); setRows(await api.getProjects()); }
  catch (e) { setError(e?.message || 'Network error'); }
}, []);

if (error) return <ErrorState message={error} onRetry={load} supportTopic="projects" />;
```

The component is `role="alert"` + `aria-live=assertive`, so screen
readers announce the failure immediately. Retry button is the primary
action; "Contact support" is the secondary escape hatch.

## Skeleton (`./Skeleton.jsx`)
```jsx
import Skeleton from '../components/Skeleton';

{loading ? <Skeleton.Table rows={6} cols={4} /> : <ProjectTable rows={rows} />}
{loading ? <Skeleton.Card /> : <Card>{…}</Card>}
{loading ? <Skeleton.Text lines={3} /> : <p>{copy}</p>}
{loading ? <Skeleton h={20} w="40%" /> : <h1>{title}</h1>}
```

Animation uses `motion-safe:animate-pulse` so it pauses for users
who've asked the OS for reduced motion.

## KeyboardShortcutsOverlay
Mounted once at App root. Triggers on `Cmd/Ctrl + /` and `?`. Traps
focus while open, restores focus on close, list of global shortcuts
inside.
