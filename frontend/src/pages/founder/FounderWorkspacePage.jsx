import { useMemo, useState } from 'react';
import { RefreshCw, Sprout } from 'lucide-react';
import './founderWorkspace.css';

const COPY = {
  validate: {
    title: 'Prove someone wants this',
    description: 'Interviews, pains, hypotheses, and the evidence-backed verdict they add up to.',
    seam: 'Evidence retains its source',
  },
  build: {
    title: 'Operate the company this week',
    description: 'Commitments first, with execution, roadmap, cadence, and metrics serving the days ahead.',
    seam: 'Accepted work stays attributable',
  },
  raise: {
    title: 'Get capital, stay legal',
    description: 'Pitch, capital planning, legal readiness, data room, and liquidity in one fundraising workspace.',
    seam: 'Investor-facing output is screened',
  },
  grow: {
    title: 'Get customers, people, reach',
    description: 'Talent, brand, partnerships, launch work, and network effects organized around growth.',
    seam: 'Matches explain their source',
  },
  network: {
    title: 'Work my relationships',
    description: 'Contacts, relationships, introductions, and the next useful action across your network.',
    seam: 'Consent and provenance are explicit',
  },
  research: {
    title: 'Go deep on a market or company',
    description: 'Signals and market evidence for decisions that need more than a headline.',
    seam: 'Sources stay attached',
  },
};

export default function FounderWorkspacePage({ page = 'validate', children, hideHeader = false }) {
  const key = useMemo(() => (COPY[page] ? page : 'validate'), [page]);
  const meta = COPY[key];
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main className="founder-workspace" data-testid={`founder-workspace-${key}`}>
      <div className="founder-frame">
        {!hideHeader && (
          <header className="founder-head">
            <div>
              <div className="founder-kicker">Founder / {key}</div>
              <h1 className="founder-title" data-testid={`heading-founder-${key}`}>{meta.title}</h1>
              <p className="founder-subtitle">{meta.description}</p>
            </div>
            <div className="founder-badges">
              <span className="founder-seam" data-testid={`badge-founder-seam-${key}`}>{meta.seam}</span>
              <span className="founder-product" data-testid="badge-founder-license">Founder</span>
              <button
                type="button"
                title="Refresh workspace"
                aria-label="Refresh workspace"
                data-testid={`button-refresh-founder-${key}`}
                onClick={() => setRefreshKey((value) => value + 1)}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </header>
        )}
        <div className="founder-stage" key={refreshKey} data-testid={`panel-founder-${key}`}>
          {children}
        </div>
        <footer className="founder-boundary" data-testid="founder-data-boundary">
          <Sprout size={12} /> Founder workspace. Existing access, permissions, and source records govern every value shown.
        </footer>
      </div>
    </main>
  );
}