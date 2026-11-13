import { useLayoutEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Compass, ArrowLeft, Home } from 'lucide-react';
import { setSuppressAuthRedirect } from '../lib/api';

// Task #11 — Catch-all 404. Rendered by the `path="*"` route at the end of the
// main route table when no other route matches, so unknown URLs show a clear
// "Not Found" page (with a way home) instead of a blank screen in the layout.
export default function NotFoundPage() {
  const navigate = useNavigate();
  // Task #8 — show this page to logged-OUT visitors too. On any page load a
  // background fetch (SettingsProvider's /settings/appearance probe) 401s for
  // an anonymous visitor; the API layer would otherwise bounce them to /login
  // for any non-allowlisted path — including an unknown URL. While this 404 is
  // mounted we suppress that bounce so anonymous (and expired-session) visitors
  // see the 404. Cleared on unmount so a real protected page still bounces.
  // useLayoutEffect (not useEffect): it sets the flag before SettingsProvider's
  // passive effect fires the /settings/appearance probe on first paint, and its
  // cleanup runs synchronously on unmount so navigating to a protected page
  // can't briefly leave the flag set for an in-flight 401.
  useLayoutEffect(() => {
    setSuppressAuthRedirect(true);
    return () => setSuppressAuthRedirect(false);
  }, []);
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
          <Compass size={28} />
        </div>
        <div className="text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-100">404</div>
        <h1 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2"
          >
            <Home size={15} /> Back to home
          </Link>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm px-4 py-2 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ArrowLeft size={15} /> Go back
          </button>
        </div>
      </div>
    </div>
  );
}
