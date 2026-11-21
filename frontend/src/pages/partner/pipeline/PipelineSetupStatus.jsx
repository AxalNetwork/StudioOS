import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import useKeyedRead from '../../../hooks/useKeyedRead';
import { useActiveCompany } from '../../../contexts/ActiveCompanyContext';
import { setupSteps } from './commandCentre';

/** The command centre's firm-coverage rules reconcile the setup reads with lead scoring. */
export default function PipelineSetupStatus({ leads }) {
  const { company } = useActiveCompany();
  const scope = company?.id ?? 'none';
  const services = useKeyedRead(`pipeline-services|${scope}`, () => api.listServiceOfferings({ mine: 1 }));
  const rules = useKeyedRead(`pipeline-fit-rules|${scope}`, () => api.listPartnerFitRules());
  const source = read => ({ state: read.status === 'ready' ? 'ok' : 'unreadable', data: read.data });
  const coverage = setupSteps({ leads: leads ? { state: 'ok', data: leads } : null, services: source(services), fitRules: source(rules) });
  const serviceCoverage = coverage.find(step => step.key === 'services')?.done;
  const rows = [
    { key: 'services', read: services, empty: 'No active services configured for this firm.', to: '/offers/catalog', label: 'Configure services' },
    { key: 'rules', read: rules, empty: 'No active fit rules configured.', to: '/offers/audience-fit', label: 'Configure fit rules' },
  ];
  return (
    <div className="mb-3 space-y-2" data-testid="pipeline-setup-status">
      {rows.map(({ key, read, empty, to, label }) => {
        if (key === 'services' && serviceCoverage === true) return null;
        if (read.status === 'loading') return null;
        const data = read.data;
        const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
        const failed = read.status === 'unreadable' || items === null;
        if (!failed && key === 'rules' && items.some(item => item.is_active === 1 || item.is_active === true)) return null;
        const message = key === 'services' && serviceCoverage == null
          ? 'Firm services are not confirmed from your own catalogue.' : empty;
        return (
          <p key={key} className="m-0 rounded-lg border border-axal-hairline bg-axal-ground p-3 text-[12px] text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {failed ? `Unreadable. ${key === 'services' ? 'Your services' : 'Fit rules'} could not be read.` : message}{' '}
            {failed ? <button type="button" onClick={read.reload} className="font-semibold underline">Try again</button>
              : <Link to={to} className="font-semibold underline">{label}</Link>}
          </p>
        );
      })}
    </div>
  );
}
