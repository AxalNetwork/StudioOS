// D588 — the named account opens a scoring-report link here. The Worker
// decides what they see; this page does not keep a second copy of the report.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { labReportSharesApi } from '../lib/api/labReportShares.js';
import { Unreadable } from '../ui/Honesty';

export default function LabReportSharePage() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let dead = false;
    labReportSharesApi.open(token)
      .then((report) => { if (!dead) setState({ status: 'ready', report }); })
      .catch((err) => {
        if (dead) return;
        if (err?.status === 404) setState({ status: 'absent', message: err.message || 'This link is not available.' });
        else setState({ status: 'failed' });
      });
    return () => { dead = true; };
  }, [token]);

  if (state.status === 'loading') return <p className="p-6 text-sm" data-testid="lab-share-open-loading">Reading the link…</p>;
  if (state.status === 'absent') return <p className="p-6 text-sm" data-testid="lab-share-open-absent">{state.message}</p>;
  if (state.status === 'failed') {
    return (
      <div className="p-6">
        <Unreadable what="This scoring report" claim="This is not a claim that the report does not exist." />
      </div>
    );
  }

  const report = state.report;
  return (
    <main className="max-w-xl mx-auto p-6" data-testid="lab-share-open">
      <h1 className="text-lg font-semibold">Scoring report</h1>
      <p className="mt-2 text-sm"><span className="font-semibold">Shows.</span> {report.shows}</p>
      <p className="mt-1 text-sm"><span className="font-semibold">Hides.</span> {report.hides}</p>
      <p className="mt-4 text-sm" data-testid="lab-share-open-score">Total {report.total_score}, tier {report.tier}, scored {report.scored_at}.</p>
      {report.dimensions && (
        <ul className="mt-3 text-sm" data-testid="lab-share-open-dimensions">
          {Object.entries(report.dimensions).map(([key, value]) => <li key={key}>{key}: {value}</li>)}
        </ul>
      )}
    </main>
  );
}
