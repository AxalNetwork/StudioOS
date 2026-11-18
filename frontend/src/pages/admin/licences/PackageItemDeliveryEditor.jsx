// HQ delivery terms belong to one item in one draft version.
import React, { useState } from 'react';
import { licencePackagesApi } from '../../../lib/api/licencePackages';

const FIELD = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[13px] dark:border-gray-700 dark:bg-gray-900';
const BUTTON = 'rounded-md border border-gray-300 px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-50 dark:border-gray-700';

export default function PackageItemDeliveryEditor({ packageKey, version, item, name, onCancel, onSaved, onReload }) {
  const previous = item.delivery?.kind === 'hq_service' ? item.delivery.description : null;
  const [kind, setKind] = useState(previous === null ? 'studio_operation' : 'hq_service');
  const [text, setText] = useState(previous ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const description = kind === 'hq_service' ? text.trim() : null;
  const valid = kind === 'studio_operation' || (description.length > 0 && description.length <= 500);
  const canSave = valid && description !== previous && !saving && !error?.stale;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await licencePackagesApi.updateItemDelivery(packageKey, version, item.program_key, {
        expected_description: previous,
        delivery: kind === 'hq_service' ? { kind, description } : { kind },
      });
      onSaved();
    } catch (e) {
      setError({ message: e.message || 'The delivery terms could not be saved.', stale: e.code === 'changed_since_open' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="my-2 grid max-w-sm gap-2 rounded-md border border-gray-200 p-3 dark:border-gray-700" disabled={saving}>
      <legend className="px-1 font-semibold">Delivery for {name}</legend>
      <label>Delivered by
        <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value)} disabled={error?.stale}>
          <option value="studio_operation">Studio operation</option>
          <option value="hq_service">HQ service</option>
        </select>
      </label>
      {kind === 'hq_service' ? <label>Service provided by HQ (1–500 characters)
        <textarea className={FIELD} rows={3} value={text} maxLength={500} required disabled={error?.stale} onChange={(e) => setText(e.target.value)} />
      </label> : null}
      {error ? <p role="alert" className="m-0 text-red-700 dark:text-red-300">{error.message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {error?.stale
          ? <button type="button" className={BUTTON} onClick={onReload}>Reload version</button>
          : <button type="button" className={BUTTON} disabled={!canSave} onClick={save}>{saving ? 'Saving…' : 'Save delivery'}</button>}
        <button type="button" className={BUTTON} onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  );
}
