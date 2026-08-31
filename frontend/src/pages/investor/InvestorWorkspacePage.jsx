import { useMemo, useState } from 'react';
import { Landmark, LockKeyhole, RefreshCw } from 'lucide-react';
import SpinoutLabLpWorkspacePage from '../SpinoutLabLpWorkspacePage';
import './investorWorkspace.css';

const COPY = {
  deals: {
    title: 'Find and close investments',
    description: 'Pipeline, invitations, and the underlying round — viewed from the capital side.',
    seam: 'Founder-sourced rounds',
  },
  portfolio: {
    title: 'Know how investments are doing',
    description: 'Direct positions, founder updates, performance, and the work that can change an outcome.',
    seam: 'Founder-submitted updates',
  },
  'axal-vc-fund': {
    title: 'Axal VC Fund',
    description: 'Your LP relationship, reporting access, and participation standing with Axal VC.',
    seam: 'LP records are scoped to you',
  },
  fund: {
    title: 'Fund operations',
    description: 'Institutional fund administration is deliberately separated from your investor workspace.',
    seam: 'Your LP records remain separate',
  },
  network: {
    title: 'Network',
    description: 'Relationships, introductions, and organizations around the investments you support.',
    seam: 'Founder-side context, permissioned',
  },
  research: {
    title: 'Research',
    description: 'Evidence for underwriting: market signals, sources, and investor-relevant diligence.',
    seam: 'Evidence retains its source',
  },
  trust: {
    title: 'Trust',
    description: 'Identity, accreditation, agreements, and permissions governing capital access.',
    seam: 'Consent and status are explicit',
  },
};

function LockedFundNotice() {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="investor-locked" data-testid="investor-fund-locked">
      <div className="investor-kicker"><LockKeyhole size={11} className="inline mr-1" />Institutional add-on</div>
      <h2>Run your own fund</h2>
      <p>
        Fund administration, capital calls, distributions, accounting, and LP packs are GP operations.
        They are not available in this investor license. Your own LP reporting remains available in Axal VC Fund.
      </p>
      <button type="button" data-testid="button-expand-fund-institutional" onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Hide Institutional detail' : 'See Institutional detail'}
      </button>
      {expanded && (
        <p className="mt-3" data-testid="text-fund-institutional-detail">
          Access is provisioned by Axal. This view does not request an upgrade or change permissions.
        </p>
      )}
    </section>
  );
}

function WorkspaceBody({ page, children, fundUnlocked }) {
  if (children && page !== 'fund') return children;
  if (page === 'axal-vc-fund') return <SpinoutLabLpWorkspacePage embedded />;
  if (page === 'fund') return fundUnlocked && children ? children : <LockedFundNotice />;
  return children || null;
}

export default function InvestorWorkspacePage({ page = 'deals', children, fundUnlocked = false }) {
  const key = useMemo(() => (COPY[page] ? page : 'trust'), [page]);
  const meta = COPY[key];
  const [refreshKey, setRefreshKey] = useState(0);
  // Portfolio owns the complete I4 composition, including its title and right
  // rail. Rendering the generic workspace chrome around it duplicates the
  // canvas header and is the mismatch the I4 correction removes.
  if (key === 'portfolio' && children) return children;
  return (
    <main className="investor-workspace" data-testid={`investor-workspace-${key}`}>
      <div className="investor-frame">
        <header className="investor-head">
          <div>
            <div className="investor-kicker">Investor &amp; LP / {key.replaceAll('-', ' ')}</div>
            <h1 className="investor-title" data-testid={`heading-investor-${key}`}>{meta.title}</h1>
            <p className="investor-subtitle">{meta.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="investor-seam" data-testid={`badge-seam-${key}`}>{meta.seam}</span>
            <span className="investor-product" data-testid="badge-investor-license">Investor &amp; LP</span>
            <button
              type="button"
              title="Refresh workspace"
              aria-label="Refresh workspace"
              data-testid={`button-refresh-investor-${key}`}
              onClick={() => setRefreshKey((value) => value + 1)}
              className="rounded-md border border-[#e7e7ed] bg-white p-1.5 text-[#615c6e] hover:text-[#4f46e5] dark:border-[#2c2b3c] dark:bg-[#171622] dark:text-[#a6a2b8]"
            ><RefreshCw size={14} /></button>
          </div>
        </header>
        <div className="investor-stage" key={refreshKey} data-testid={`panel-investor-${key}`}>
          <WorkspaceBody page={key} fundUnlocked={fundUnlocked}>{children}</WorkspaceBody>
        </div>
        <footer className="mt-4 flex items-center gap-2 text-[10.5px] text-[#615c6e] dark:text-[#a6a2b8]" data-testid="investor-data-boundary">
          <Landmark size={12} /> Investor workspace. Data shown is governed by your existing access and permissions.
        </footer>
      </div>
    </main>
  );
}