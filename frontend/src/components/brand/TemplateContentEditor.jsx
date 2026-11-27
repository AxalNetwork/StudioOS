// Schema-driven editor for a template's content sections.
//
// The ONE editor for `content_json[templateKey]`, shared by the inline editor on
// /spinout-lab/brand and the full builder on /build/brand. It renders whatever
// TEMPLATE_CONTENT_SCHEMA says the selected template has — text, textarea, and
// groupList (add / remove / per-item fields, clamped to the field's `max`) — so
// neither page carries its own copy of the field list, and a schema change shows
// up in both editors and the renderer at once.
import { Plus, Trash2 } from 'lucide-react';
import { contentFieldsFor, blankItem } from '../../lib/brand/templateContent.js';

const LBL = 'text-[10.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';

/**
 * @param {object} props
 * @param {string} props.templateKey          visual template key (drives the field list)
 * @param {object} props.content              current content block: { [fieldKey]: string | item[] }
 * @param {(fieldKey: string, value: any) => void} props.onChange
 * @param {string} [props.className]
 * @param {string} [props.testIdPrefix]       prefix for data-testid hooks (default "content")
 */
export default function TemplateContentEditor({
  templateKey, content = {}, onChange, className = '', testIdPrefix = 'content',
}) {
  const fields = contentFieldsFor(templateKey);
  if (!fields.length) return null;

  const listOf = (key) => (Array.isArray(content[key]) ? content[key] : []);

  const addItem = (f) => {
    const cur = listOf(f.key);
    if (cur.length >= (f.max || 12)) return;
    onChange(f.key, [...cur, blankItem(f)]);
  };
  const updateItem = (f, idx, itemKey, value) => {
    const cur = listOf(f.key).slice();
    cur[idx] = { ...(cur[idx] || {}), [itemKey]: value };
    onChange(f.key, cur);
  };
  const removeItem = (f, idx) => {
    const cur = listOf(f.key).slice();
    cur.splice(idx, 1);
    onChange(f.key, cur);
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`} data-testid={`${testIdPrefix}-editor`}>
      {fields.map((f) => {
        if (f.kind === 'groupList') {
          const items = listOf(f.key);
          const atMax = items.length >= (f.max || 12);
          return (
            <div
              key={f.key}
              className="rounded-xl border border-gray-200 dark:border-gray-700 p-3"
              data-testid={`${testIdPrefix}-field-${f.key}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={LBL}>{f.label}</span>
                <button
                  type="button"
                  onClick={() => addItem(f)}
                  disabled={atMax}
                  title={atMax ? `Up to ${f.max} items` : `Add to ${f.label}`}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900/50 hover:bg-violet-100 dark:hover:bg-violet-950/60 disabled:opacity-40"
                  data-testid={`${testIdPrefix}-add-${f.key}`}
                >
                  <Plus size={10} /> Add
                </button>
              </div>
              {items.length === 0 && (
                <div className="text-[11px] text-gray-400 italic mb-2">
                  Empty — the page falls back to the template's default copy for this section.
                </div>
              )}
              <div className="flex flex-col gap-2">
                {items.map((item, idx) => (
                  <div key={idx} className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 p-2 flex flex-col gap-1.5">
                    {(f.itemFields || []).map((itf) => (
                      <label key={itf.key} className="block">
                        <span className="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 mb-0.5">{itf.label}</span>
                        {itf.kind === 'textarea' ? (
                          <textarea
                            rows={2}
                            className={`${INPUT} resize-y`}
                            value={item?.[itf.key] || ''}
                            onChange={(e) => updateItem(f, idx, itf.key, e.target.value)}
                            data-testid={`${testIdPrefix}-input-${f.key}-${idx}-${itf.key}`}
                          />
                        ) : (
                          <input
                            className={INPUT}
                            value={item?.[itf.key] || ''}
                            onChange={(e) => updateItem(f, idx, itf.key, e.target.value)}
                            data-testid={`${testIdPrefix}-input-${f.key}-${idx}-${itf.key}`}
                          />
                        )}
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => removeItem(f, idx)}
                      className="self-start inline-flex items-center gap-1 text-[10.5px] font-semibold text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      data-testid={`${testIdPrefix}-remove-${f.key}-${idx}`}
                    >
                      <Trash2 size={10} /> Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        const val = typeof content[f.key] === 'string' ? content[f.key] : '';
        return (
          <div
            key={f.key}
            className="rounded-xl border border-gray-200 dark:border-gray-700 p-3"
            data-testid={`${testIdPrefix}-field-${f.key}`}
          >
            <span className={`${LBL} block mb-1.5`}>{f.label}</span>
            {f.kind === 'textarea' ? (
              <textarea
                rows={3}
                className={`${INPUT} resize-y`}
                value={val}
                placeholder={typeof f.default === 'string' ? f.default : ''}
                onChange={(e) => onChange(f.key, e.target.value)}
                data-testid={`${testIdPrefix}-input-${f.key}`}
              />
            ) : (
              <input
                className={INPUT}
                value={val}
                placeholder={typeof f.default === 'string' ? f.default : ''}
                onChange={(e) => onChange(f.key, e.target.value)}
                data-testid={`${testIdPrefix}-input-${f.key}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
