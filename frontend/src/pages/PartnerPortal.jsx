import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Handshake, DollarSign, CheckCircle, Clock, ArrowRight } from 'lucide-react';

const statusColors = {
  applied: 'bg-blue-500/20 text-blue-400',
  scored: 'bg-yellow-500/20 text-yellow-400',
  active: 'bg-green-500/20 text-green-400',
  funded: 'bg-violet-500/20 text-violet-400',
  rejected: 'bg-red-500/20 text-red-400',
};

export default function PartnerPortal() {
  const [deals, setDeals] = useState([]);
  const [calls, setCalls] = useState([]);
  const [partners, setPartners] = useState([]);
  const [tab, setTab] = useState('deals');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [d, c, p] = await Promise.all([
        api.listDeals(),
        api.listCapitalCalls(),
        api.listPartners(),
      ]);
      setDeals(d);
      setCalls(c);
      setPartners(p);
    } catch (e) {
      console.error(e);
    }
  };

  const acceptCall = async (callId) => {
    try {
      await api.payCapitalCall(callId);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Partner Portal</h1>
      <p className="text-gray-400 mb-6">View deal flow and manage capital calls</p>

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('deals')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'deals' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
          <Handshake size={14} className="inline mr-2" />Deals ({deals.length})
        </button>
        <button onClick={() => setTab('calls')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'calls' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
          <DollarSign size={14} className="inline mr-2" />Capital Calls ({calls.length})
        </button>
      </div>

      {tab === 'deals' && (
        <div className="space-y-3">
          {deals.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
              No deals in the pipeline yet
            </div>
          ) : (
            deals.map(deal => (
              <div key={deal.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-white font-medium">{deal.project_name || `Project #${deal.project_id}`}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[deal.status] || 'bg-gray-700 text-gray-400'}`}>
                      {deal.status?.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400">
                    {deal.project_sector && <span className="mr-4">Sector: {deal.project_sector}</span>}
                    {deal.partner_name && <span className="mr-4">Partner: {deal.partner_name}</span>}
                    {deal.amount && <span>Amount: ${deal.amount.toLocaleString()}</span>}
                  </div>
                  {deal.notes && <p className="text-xs text-gray-500 mt-1">{deal.notes}</p>}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(deal.created_at).toLocaleDateString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'calls' && (
        <div className="space-y-3">
          {calls.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
              No capital calls yet
            </div>
          ) : (
            calls.map(call => (
              <div key={call.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${call.status === 'paid' ? 'bg-green-500/20' : 'bg-amber-500/20'}`}>
                  {call.status === 'paid' ? <CheckCircle size={20} className="text-green-400" /> : <Clock size={20} className="text-amber-400" />}
                </div>
                <div className="flex-1">
                  <div className="text-white font-medium">${call.amount?.toLocaleString()}</div>
                  <div className="text-sm text-gray-400">
                    {call.due_date && <span className="mr-4">Due: {call.due_date}</span>}
                    <span className={call.status === 'paid' ? 'text-green-400' : 'text-amber-400'}>
                      {call.status?.toUpperCase()}
                    </span>
                  </div>
                </div>
                {call.status === 'pending' && (
                  <button onClick={() => acceptCall(call.id)} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                    <CheckCircle size={14} /> Accept
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
