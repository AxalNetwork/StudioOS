import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import useKeyedRead from '../../../hooks/useKeyedRead';

/** The caller's catalogue and the firm's fit rules are independent setup reads. */
export default function PipelineSetupStatus() {
  const services = useKeyedRead('pipeline-services', () => api.listServiceOfferings({ mine: 1 }));
  const rules = useKeyedRead('pipeline-fit-rules', () => api.listPartnerFitRules());
  const rows = [
    { key: 'services', read: services, empty: 'No active services in your catalogue.', to: '/offers/catalog', label: 'Configure services' },
    { key: 'rules', read: rules, empty: 'No active fit rules configured.', to: '/offers/audience-fit', label: 'Configure fit rules' },
  ];
  return (
    <div className="mb-3 space-y-2" data-testid="pipeline-setup-status">
      {rows.map(({ key, read, empty, to, label }) => {
        if (read.status === 'loading') return null;
        const data = read.data;
        const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
        const failed = read.status === 'unreadable' || items === null;
        if (!failed && items.some(item => item.is_active === 1 || item.is_active === true)) return null;
        return (
          <p key={key} className="m-0 rounded-lg border border-axal-hairline bg-axal-ground p-3 text-[12px] text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {failed ? `Unreadable. ${key === 'services' ? 'Your services' : 'Fit rules'} could not be read.` : empty}{' '}
            {failed ? <button type="button" onClick={read.reload} className="font-semibold underline">Try again</button>
              : <Link to={to} className="font-semibold underline">{label}</Link>}
          </p>
        );
      })}
    </div>
  );
}
