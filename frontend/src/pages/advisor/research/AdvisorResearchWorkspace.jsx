// Advisor Research workspace — tabbed shell for the advisor's external-
// intelligence and knowledge surface. Each tab deep-links to its own route
// (/advisor/research/{market,companies,documents,ai,news}); every one of those
// routes renders this workspace, which derives the active tab from the URL and
// renders the matching tab page in `embedded` mode. Tab pages are stubs the
// Advisor Research section task replaces with real content.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Radar, TrendingUp, Building2, FileText, Brain, Newspaper, Landmark } from 'lucide-react';
import WorkspaceTabs, { WorkspaceHeader } from '../../../components/WorkspaceTabs';
import MarketPage from './MarketPage';
import CompaniesPage from './CompaniesPage';
import FundsResearchPage from './FundsResearchPage';
import DocumentsPage from './DocumentsPage';
import AIResearchPage from './AIResearchPage';
import NewsPage from './NewsPage';

export default function AdvisorResearchWorkspace() {
  const { pathname } = useLocation();
  const active = pathname.includes('/companies')
    ? 'companies'
    : pathname.includes('/funds')
      ? 'funds'
      : pathname.includes('/documents')
        ? 'documents'
        : pathname.includes('/ai')
          ? 'ai'
          : pathname.includes('/news')
            ? 'news'
            : 'market';

  const tabs = [
    { to: '/advisor/research/market', label: 'Market', icon: TrendingUp },
    { to: '/advisor/research/companies', label: 'Companies', icon: Building2 },
    { to: '/advisor/research/funds', label: 'Funds', icon: Landmark },
    { to: '/advisor/research/ai', label: 'AI Research', icon: Brain },
    { to: '/advisor/research/news', label: 'News', icon: Newspaper },
    { to: '/advisor/research/documents', label: 'Documents', icon: FileText },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Radar}
        title="Research"
        description="Market intelligence, company and fund databases, documents, AI research, and news in one place."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'market' && <MarketPage embedded />}
      {active === 'companies' && <CompaniesPage embedded />}
      {active === 'funds' && <FundsResearchPage embedded />}
      {active === 'documents' && <DocumentsPage embedded />}
      {active === 'ai' && <AIResearchPage embedded />}
      {active === 'news' && <NewsPage embedded />}
    </div>
  );
}
