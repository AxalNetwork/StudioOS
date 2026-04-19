import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  FileText, Plus, Building, Eye, ChevronDown, Shield, Users,
  Briefcase, Scale, AlertTriangle, BookOpen, Download
} from 'lucide-react';

function ModernSelect({ value, onChange, children, ...props }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} {...props}
        className="w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-4 py-2.5 text-sm appearance-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all cursor-pointer hover:border-gray-400">
        {children}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
    </div>
  );
}

const LAYER_CONFIG = {
  gp: { icon: Users, color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700' },
  fund: { icon: Briefcase, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
  portfolio: { icon: Scale, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  compliance: { icon: Shield, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
};

export default function LegalPage() {
  const [documents, setDocuments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGen, setShowGen] = useState(false);
  const [genForm, setGenForm] = useState({ title: '', doc_type: '', project_id: '' });
  const [projects, setProjects] = useState([]);
  const [viewDoc, setViewDoc] = useState(null);
  const [activeLayer, setActiveLayer] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.listDocuments(), api.listTemplates(), api.listEntities(), api.listProjects()
    ]).then(([d, t, e, p]) => {
      setDocuments(d); setTemplates(t); setEntities(e); setProjects(p);
      if (t.length > 0 && !genForm.doc_type) {
        setGenForm(f => ({ ...f, doc_type: t[0].key }));
      }
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

  const groupedTemplates = templates.reduce((acc, t) => {
    if (!acc[t.layer]) acc[t.layer] = [];
    acc[t.layer].push(t);
    return acc;
  }, {});

  const layers = [
    { key: 'gp', label: 'GP Level', fullLabel: 'Internal Management (GP Level)' },
    { key: 'fund', label: 'Fund Formation', fullLabel: 'Fund Formation (LP Level)' },
    { key: 'portfolio', label: 'Portfolio', fullLabel: 'Investment Execution (Portfolio)' },
    { key: 'compliance', label: 'Compliance', fullLabel: 'Compliance & Regulatory' },
  ];

  const filteredTemplates = activeLayer === 'all'
    ? templates
    : templates.filter(t => t.layer === activeLayer);

  if (loading) return <div className="text-gray-600 text-center py-20">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Legal & Compliance Engine</h1>
          <p className="text-sm text-gray-600">VC legal stack — GP governance, fund formation, portfolio execution, and regulatory compliance</p>
        </div>
        <button onClick={() => setShowGen(!showGen)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium text-white transition-colors">
          <Plus size={14} /> Generate Document
        </button>
      </div>

      {showGen && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 className="font-semibold text-gray-900 text-sm mb-4">Generate Document from Template</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium">Template</label>
              <ModernSelect value={genForm.doc_type} onChange={e => setGenForm(f => ({ ...f, doc_type: e.target.value }))}>
                {layers.map(layer => (
                  <optgroup key={layer.key} label={layer.fullLabel}>
                    {(groupedTemplates[layer.key] || []).map(t => (
                      <option key={t.key} value={t.key}>{t.title}</option>
                    ))}
                  </optgroup>
                ))}
              </ModernSelect>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Title</label>
              <input type="text" value={genForm.title} onChange={e => setGenForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Document title (optional)"
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:border-violet-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium">Project</label>
              <ModernSelect value={genForm.project_id} onChange={e => setGenForm(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">None (General)</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </ModernSelect>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={generate} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm text-white font-medium transition-colors">Generate</button>
            <button onClick={() => setShowGen(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">VC Legal Template Library</h3>
              <span className="text-xs text-gray-500">{templates.length} templates across 4 layers</span>
            </div>

            <div className="flex gap-1 px-4 py-2 border-b border-gray-100 bg-gray-50 flex-wrap">
              <button
                onClick={() => setActiveLayer('all')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeLayer === 'all' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-600 hover:text-gray-900'
                }`}>
                All ({templates.length})
              </button>
              {layers.map(layer => {
                const config = LAYER_CONFIG[layer.key];
                const count = (groupedTemplates[layer.key] || []).length;
                return (
                  <button
                    key={layer.key}
                    onClick={() => setActiveLayer(layer.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      activeLayer === layer.key ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-600 hover:text-gray-900'
                    }`}>
                    {layer.label} ({count})
                  </button>
                );
              })}
            </div>

            <div className="divide-y divide-gray-100">
              {activeLayer === 'all' ? (
                layers.map(layer => {
                  const layerTemplates = groupedTemplates[layer.key] || [];
                  if (layerTemplates.length === 0) return null;
                  const config = LAYER_CONFIG[layer.key];
                  const LayerIcon = config.icon;
                  return (
                    <div key={layer.key}>
                      <div className={`px-4 py-2 ${config.bg} flex items-center gap-2`}>
                        <LayerIcon size={13} className={config.color} />
                        <span className="text-xs font-semibold text-gray-700">{layer.fullLabel}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${config.badge}`}>{layerTemplates.length}</span>
                      </div>
                      {layerTemplates.map(t => (
                        <TemplateRow key={t.key} template={t} config={config}
                          onPreview={() => setPreviewTemplate(t)}
                          onGenerate={() => { setGenForm(f => ({ ...f, doc_type: t.key })); setShowGen(true); }}
                        />
                      ))}
                    </div>
                  );
                })
              ) : (
                (groupedTemplates[activeLayer] || []).map(t => {
                  const config = LAYER_CONFIG[activeLayer];
                  return (
                    <TemplateRow key={t.key} template={t} config={config}
                      onPreview={() => setPreviewTemplate(t)}
                      onGenerate={() => { setGenForm(f => ({ ...f, doc_type: t.key })); setShowGen(true); }}
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Building size={14} className="text-blue-600" /> Legal Entities
            </h3>
            {entities.length === 0 ? (
              <p className="text-sm text-gray-500">No entities yet</p>
            ) : (
              <div className="space-y-2">
                {entities.map(e => (
                  <div key={e.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                    <div>
                      <div className="text-gray-900">{e.name}</div>
                      <div className="text-xs text-gray-500">{e.entity_type} | {e.jurisdiction}</div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{e.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-200 rounded-xl p-5">
            <div className="flex items-start gap-2 mb-3">
              <BookOpen size={16} className="text-violet-600 mt-0.5" />
              <h3 className="text-sm font-semibold text-gray-900">Getting Started</h3>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              If you're starting out with partners and no outside capital yet, focus on:
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                <span className="text-gray-700">Operating Agreement</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                <span className="text-gray-700">Carried Interest Agreement</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">3</span>
                <span className="text-gray-700">IC Charter</span>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 bg-white/60 rounded-lg p-2.5">
              <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-gray-600">
                Don't spend $50k on a full Fund LPA until you have committed interest from LPs.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Layer Summary</h3>
            <div className="space-y-3">
              {layers.map(layer => {
                const config = LAYER_CONFIG[layer.key];
                const LayerIcon = config.icon;
                const count = (groupedTemplates[layer.key] || []).length;
                const generated = documents.filter(d => {
                  const tmpl = templates.find(t => t.key === d.doc_type);
                  return tmpl?.layer === layer.key;
                }).length;
                return (
                  <div key={layer.key} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center`}>
                      <LayerIcon size={14} className={config.color} />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-medium text-gray-900">{layer.label}</div>
                      <div className="text-[10px] text-gray-500">{count} templates | {generated} generated</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 text-sm">Generated Documents ({documents.length})</h3>
        </div>
        {documents.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No documents generated yet. Select a template above to get started.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase">
                <th className="text-left px-5 py-3">Title</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Type</th>
                <th className="text-left px-5 py-3 hidden lg:table-cell">Layer</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {documents.map(d => {
                const tmpl = templates.find(t => t.key === d.doc_type);
                const layerKey = tmpl?.layer;
                const config = layerKey ? LAYER_CONFIG[layerKey] : null;
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-900">{d.title}</td>
                    <td className="px-5 py-3 hidden md:table-cell text-gray-600 text-xs">{d.doc_type}</td>
                    <td className="px-5 py-3 hidden lg:table-cell">
                      {config && <span className={`text-[10px] px-2 py-0.5 rounded-full ${config.badge}`}>{tmpl.layer_label}</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        d.status === 'signed' ? 'bg-emerald-100 text-emerald-700' :
                        d.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                        d.status === 'generated' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-200 text-gray-700'
                      }`}>{d.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      <button onClick={async () => {
                        // List view no longer ships full document body
                        // (Security Item #5 — public list is body-less).
                        // Fetch the detail record on demand for the modal.
                        if (viewDoc?.id === d.id) { setViewDoc(null); return; }
                        try {
                          const full = await api.getDocument(d.id);
                          setViewDoc(full);
                        } catch {
                          setViewDoc(d); // fall back to summary so modal still opens
                        }
                      }} className="text-violet-600 hover:text-violet-700 text-xs flex items-center gap-1">
                        <Eye size={12} /> View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {viewDoc && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setViewDoc(null)}>
          <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">{viewDoc.title}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                viewDoc.status === 'signed' ? 'bg-emerald-100 text-emerald-700' :
                viewDoc.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                'bg-amber-100 text-amber-700'
              }`}>{viewDoc.status}</span>
            </div>
            {/* Security #8: contract bodies are no longer rendered inline.
                The backend returns a short-lived (~5 min) signed download
                URL; clicking it streams the file as `attachment` with
                `Cache-Control: no-store`, so the body never persists in
                page memory. */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Document body</div>
              {viewDoc.content_url ? (
                <a
                  href={viewDoc.content_url}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium transition-colors"
                  rel="noopener noreferrer"
                >
                  Download contract
                </a>
              ) : (
                <div className="text-xs text-gray-400">No file content available.</div>
              )}
              {viewDoc.file_size != null && (
                <div className="mt-2 text-[11px] text-gray-500">
                  {(viewDoc.file_size / 1024).toFixed(1)} KB · link expires in ~5 min
                </div>
              )}
            </div>
            <button onClick={() => setViewDoc(null)} className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">Close</button>
          </div>
        </div>
      )}

      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onGenerate={() => { setGenForm(f => ({ ...f, doc_type: previewTemplate.key })); setShowGen(true); setPreviewTemplate(null); }}
        />
      )}
    </div>
  );
}

function TemplatePreviewModal({ template, onClose, onGenerate }) {
  const [content, setContent] = useState(null);
  const [loadingContent, setLoadingContent] = useState(true);

  useEffect(() => {
    api.getTemplateContent(template.key)
      .then(data => setContent(data.content))
      .catch(() => setContent('Failed to load template content.'))
      .finally(() => setLoadingContent(false));
  }, [template.key]);

  const config = LAYER_CONFIG[template.layer];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-gray-200 rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">{template.title}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${config?.badge}`}>
              {template.layer_label}
            </span>
          </div>
          <button
            onClick={onGenerate}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1">
            <Plus size={12} /> Generate
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-xs text-gray-500 mb-3">Template preview — fields marked with ____ will be filled when generating for a specific project.</p>
          {loadingContent ? (
            <div className="text-center text-gray-500 text-sm py-8">Loading template...</div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

function TemplateRow({ template, config, onPreview, onGenerate }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors group">
      <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center shrink-0`}>
        <FileText size={14} className={config.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 font-medium">{template.title}</div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onPreview} className="text-gray-500 hover:text-gray-700 p-1" title="Preview">
          <Eye size={14} />
        </button>
        <button onClick={onGenerate} className="text-violet-600 hover:text-violet-700 px-2 py-1 text-xs font-medium rounded-md hover:bg-violet-50 transition-colors">
          Generate
        </button>
      </div>
    </div>
  );
}
