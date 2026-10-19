import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageExplainer from '../components/PageExplainer';
import { api } from '../lib/api';
import {
  FileText, Send, Building, Eye, Shield, Users,
  Briefcase, Scale, AlertTriangle, BookOpen, Building2,
} from 'lucide-react';
import IncorporationStatusBadge from '../components/IncorporationStatusBadge';
import DocumentBody from '../components/DocumentBody';

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
  const [viewDoc, setViewDoc] = useState(null);
  const [activeLayer, setActiveLayer] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [incorporationOrders, setIncorporationOrders] = useState([]);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.listDocuments(), api.listTemplates(), api.listEntities(),
      api.legalIncorporationOrders().catch(() => ({ orders: [] })),
    ]).then(([d, t, e, inc]) => {
      // D758 — the library is an array of { key, title, layer, layer_label,
      // has_body }, each title and text read from the store.
      setDocuments(d); setTemplates(Array.isArray(t) ? t : []); setEntities(e);
      setIncorporationOrders(inc?.orders ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

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

  if (loading) return <div className="text-gray-600 text-center py-20">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">Legal & Compliance Engine</h1>
        <PageExplainer pageKey="legal_templates" />
          <p className="text-sm text-gray-600">VC legal stack — GP governance, fund formation, portfolio execution, and regulatory compliance</p>
        </div>
        <Link to="/legal/send" className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium text-white transition-colors">
          <Send size={14} /> Send for signature
        </Link>
      </div>

      {incorporationOrders.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6 dark:bg-gray-900 dark:border-gray-800">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 dark:border-gray-800">
            <Building2 size={14} className="text-violet-600" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pending Filings</h3>
            <span className="text-xs text-gray-500 ml-auto">
              {incorporationOrders.length} order{incorporationOrders.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {incorporationOrders.map((order) => (
              <li key={order.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">
                    {order.company_name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {order.jurisdiction_id?.replace(/_/g, ' ')} ·{' '}
                    Order #{order.id}
                    {order.paid_at && (
                      <> · paid {new Date(order.paid_at).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
                <IncorporationStatusBadge status={order.status} size="md" />
                {(order.status === 'failed') && (
                  <a
                    href={`mailto:support@axal.vc?subject=Incorporation+issue&body=Order+ID:+${order.id}`}
                    className="text-xs text-red-600 hover:underline flex-shrink-0"
                  >
                    Contact support
                  </a>
                )}
              </li>
            ))}
          </ul>
          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800">
            <a
              href="/incorporate"
              className="text-xs text-violet-600 hover:text-violet-700 hover:underline"
            >
              + Start another incorporation
            </a>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">VC Legal Template Library</h3>
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
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{layer.fullLabel}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${config.badge}`}>{layerTemplates.length}</span>
                      </div>
                      {layerTemplates.map(t => (
                        <TemplateRow key={t.key} template={t} config={config}
                          onPreview={() => setPreviewTemplate(t)}
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
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
              <Building size={14} className="text-blue-600" /> Legal Entities
            </h3>
            {entities.length === 0 ? (
              <p className="text-sm text-gray-500">No entities yet</p>
            ) : (
              <div className="space-y-2">
                {entities.map(e => (
                  <div key={e.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                    <div>
                      <div className="text-gray-900 dark:text-gray-100">{e.name}</div>
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
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Getting Started</h3>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              If you're starting out with partners and no outside capital yet, focus on:
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                <span className="text-gray-700 dark:text-gray-300">Operating Agreement</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                <span className="text-gray-700 dark:text-gray-300">Carried Interest Agreement</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">3</span>
                <span className="text-gray-700 dark:text-gray-300">IC Charter</span>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 bg-white/60 rounded-lg p-2.5">
              <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-gray-600">
                Don't spend $50k on a full Fund LPA until you have committed interest from LPs.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Layer Summary</h3>
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
                      <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{layer.label}</div>
                      <div className="text-[10px] text-gray-500">{count} templates | {generated} generated</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 text-sm dark:text-gray-100">Generated Documents ({documents.length})</h3>
        </div>
        {documents.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No documents generated yet. Select a template above to get started.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase dark:border-gray-800">
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
                    <td className="px-5 py-3 text-gray-900 dark:text-gray-100">{d.title}</td>
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
          <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto dark:bg-gray-900 dark:border-gray-800" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{viewDoc.title}</h3>
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
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
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
            <button onClick={() => setViewDoc(null)} className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors dark:text-gray-300">Close</button>
          </div>
        </div>
      )}

      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
    </div>
  );
}

/**
 * D758 — a library document's text as the store holds it. A document with no
 * body reads the canvas's stub line (boards L8 and L9), never a placeholder.
 */
export function TemplatePreviewBody({ body, hasBody }) {
  if (!hasBody || !body) {
    return <p className="text-sm text-gray-600 dark:text-gray-400">No body in the store yet</p>;
  }
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 dark:bg-gray-950 dark:border-gray-800">
      <DocumentBody text={body} className="text-xs text-gray-700 font-mono leading-relaxed dark:text-gray-300" />
    </div>
  );
}

function TemplatePreviewModal({ template, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loadingContent, setLoadingContent] = useState(true);

  useEffect(() => {
    api.getTemplateContent(template.key)
      .then(setData)
      .catch((e) => setError(e?.message || 'The template could not be loaded.'))
      .finally(() => setLoadingContent(false));
  }, [template.key]);

  const config = LAYER_CONFIG[template.layer];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-gray-200 rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col dark:bg-gray-900 dark:border-gray-800" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0 dark:border-gray-800">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{template.title}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${config?.badge}`}>
              {template.layer_label}
            </span>
          </div>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-xs text-gray-500 mb-3">The text this document carries in the library. Fields in double braces are filled when it is sent.</p>
          {loadingContent ? (
            <div className="text-center text-gray-500 text-sm py-8">Loading template...</div>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <TemplatePreviewBody body={data?.body} hasBody={!!data?.has_body} />
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end shrink-0 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors dark:text-gray-300">Close</button>
        </div>
      </div>
    </div>
  );
}

function TemplateRow({ template, config, onPreview }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors group">
      <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center shrink-0`}>
        <FileText size={14} className={config.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 font-medium dark:text-gray-100">{template.title}</div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onPreview} className="text-gray-500 hover:text-gray-700 p-1" title="Preview">
          <Eye size={14} />
        </button>
      </div>
    </div>
  );
}
