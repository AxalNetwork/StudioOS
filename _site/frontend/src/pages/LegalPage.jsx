import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { FileText, Plus, Building, Eye } from 'lucide-react';

export default function LegalPage() {
  const [documents, setDocuments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGen, setShowGen] = useState(false);
  const [genForm, setGenForm] = useState({ title: '', doc_type: 'safe', project_id: '' });
  const [projects, setProjects] = useState([]);
  const [viewDoc, setViewDoc] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.listDocuments(), api.listTemplates(), api.listEntities(), api.listProjects()
    ]).then(([d, t, e, p]) => {
      setDocuments(d); setTemplates(t); setEntities(e); setProjects(p);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const generate = async () => {
    try {
      await api.generateDocument({
        ...genForm,
        project_id: genForm.project_id ? parseInt(genForm.project_id) : null,
      });
      setShowGen(false);
      load();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <div className="text-gray-400 text-center py-20">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Legal & Compliance Engine</h1>
          <p className="text-sm text-gray-400">Document generation, incorporation, and spin-out workflows</p>
        </div>
        <button onClick={() => setShowGen(!showGen)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white">
          <Plus size={14} /> Generate Document
        </button>
      </div>

      {showGen && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <h2 className="font-semibold text-white text-sm mb-4">Generate Document from Template</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Template</label>
              <select value={genForm.doc_type} onChange={e => setGenForm(f => ({ ...f, doc_type: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                {templates.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Title</label>
              <input type="text" value={genForm.title} onChange={e => setGenForm(f => ({ ...f, title: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Project</label>
              <select value={genForm.project_id} onChange={e => setGenForm(f => ({ ...f, project_id: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={generate} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm text-white">Generate</button>
            <button onClick={() => setShowGen(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Building size={14} className="text-blue-400" /> Legal Entities
          </h3>
          {entities.length === 0 ? (
            <p className="text-sm text-gray-500">No entities yet</p>
          ) : (
            <div className="space-y-2">
              {entities.map(e => (
                <div key={e.id} className="flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg text-sm">
                  <div>
                    <div className="text-white">{e.name}</div>
                    <div className="text-xs text-gray-500">{e.entity_type} | {e.jurisdiction}</div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">{e.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Available Templates</h3>
          <div className="space-y-2">
            {templates.map(t => (
              <div key={t.key} className="px-3 py-2 bg-gray-800 rounded-lg text-sm text-gray-300 flex items-center gap-2">
                <FileText size={14} className="text-gray-500" /> {t.title}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="font-semibold text-white text-sm">All Documents</h3>
        </div>
        {documents.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No documents generated yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
                <th className="text-left px-5 py-3">Title</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Type</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {documents.map(d => (
                <tr key={d.id} className="hover:bg-gray-800/50">
                  <td className="px-5 py-3 text-white">{d.title}</td>
                  <td className="px-5 py-3 hidden md:table-cell text-gray-400">{d.doc_type}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      d.status === 'signed' ? 'bg-emerald-500/20 text-emerald-400' :
                      d.status === 'sent' ? 'bg-blue-500/20 text-blue-400' :
                      d.status === 'generated' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-gray-700 text-gray-300'
                    }`}>{d.status}</span>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => setViewDoc(viewDoc?.id === d.id ? null : d)} className="text-violet-400 hover:text-violet-300 text-xs flex items-center gap-1">
                      <Eye size={12} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {viewDoc && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setViewDoc(null)}>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-white mb-4">{viewDoc.title}</h3>
            <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 p-4 rounded-lg">{viewDoc.content}</pre>
            <button onClick={() => setViewDoc(null)} className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
