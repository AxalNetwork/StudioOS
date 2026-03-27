import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ArrowRight, Filter } from 'lucide-react';

const STATUSES = ['all', 'applied', 'scored', 'active', 'funded', 'rejected'];
const statusColors = {
  applied: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  scored: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  funded: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const PIPELINE = ['applied', 'scored', 'active', 'funded'];

export default function DealsPage() {
  const [deals, setDeals] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDeals();
  }, []);

  const loadDeals = async () => {
    try {
      const d = await api.listDeals();
      setDeals(d);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const updateDeal = async (dealId, status) => {
    try {
      await api.updateDeal(dealId, { status });
      loadDeals();
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = filter === 'all' ? deals : deals.filter(d => d.status === filter);

  const pipelineCounts = {};
  PIPELINE.forEach(s => { pipelineCounts[s] = deals.filter(d => d.status === s).length; });

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Deal Flow Pipeline</h1>
      <p className="text-gray-400 mb-6">Track deals from application to funding</p>

      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
        {PIPELINE.map((stage, i) => (
          <React.Fragment key={stage}>
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${statusColors[stage]} min-w-[120px]`}>
              <div>
                <div className="text-2xl font-bold">{pipelineCounts[stage]}</div>
                <div className="text-xs capitalize">{stage}</div>
              </div>
            </div>
            {i < PIPELINE.length - 1 && <ArrowRight size={16} className="text-gray-600 shrink-0" />}
          </React.Fragment>
        ))}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${filter === s ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {s} {s !== 'all' && `(${deals.filter(d => d.status === s).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="text-center text-gray-500 py-8">Loading deals...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
            No deals found
          </div>
        ) : (
          filtered.map(deal => {
            const currentIdx = PIPELINE.indexOf(deal.status);
            const nextStatus = currentIdx >= 0 && currentIdx < PIPELINE.length - 1 ? PIPELINE[currentIdx + 1] : null;

            return (
              <div key={deal.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-white font-medium">{deal.project_name || `Project #${deal.project_id}`}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[deal.status] || 'bg-gray-700 text-gray-400'}`}>
                      {deal.status?.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400">
                    {deal.project_sector && <span className="mr-4">{deal.project_sector}</span>}
                    {deal.partner_name && <span className="mr-4">Partner: {deal.partner_name}</span>}
                    {deal.amount && <span>${deal.amount.toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {nextStatus && deal.status !== 'rejected' && (
                    <button onClick={() => updateDeal(deal.id, nextStatus)} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium flex items-center gap-1">
                      <ArrowRight size={12} /> {nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
                    </button>
                  )}
                  <span className="text-xs text-gray-500">{new Date(deal.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
