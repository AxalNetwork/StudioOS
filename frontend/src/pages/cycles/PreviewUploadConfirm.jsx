/**
 * #8261 (BD29 B) — the confirm a Super Admin answers before a founder-preview
 * upload in Company creation. It names the Super Admin and the company; the
 * venture's name is read (`useVenture`) only while this dialog is open, so a
 * form that never asks makes no extra read.
 */
import Lightbox from '../../ui/Lightbox.jsx';
import { useAuth } from '../../hooks/useAuthSync';
import { useVenture } from './VentureContext.jsx';
import { previewUploadCopy } from './previewUploadModel.js';

export default function PreviewUploadConfirm({ files, onConfirm, onCancel }) {
  const { user } = useAuth() || {};
  const venture = useVenture();
  const company = venture?.company?.name || venture?.project?.name || null;
  const copy = previewUploadCopy({ admin: user?.name || null, company, files });
  return (
    <Lightbox size="fit" width={440} label={copy.title} title={copy.title} onClose={onCancel} testId="preview-upload-confirm"
      footer={<div className="flex justify-end gap-2 p-4">
        <button type="button" data-testid="preview-upload-cancel" onClick={onCancel}
          className="rounded-lg border border-axal-hairline px-3 py-2 text-axal-ink dark:border-gray-700 dark:text-gray-100">{copy.cancel}</button>
        <button type="button" data-testid="preview-upload-confirm-cta" onClick={onConfirm}
          className="rounded-lg border border-axal-violet bg-axal-violet px-3 py-2 text-white dark:border-violet-500 dark:bg-violet-600">{copy.cta}</button>
      </div>}>
      <p className="p-4 text-sm text-axal-ink dark:text-gray-100" data-testid="preview-upload-body">
        <span aria-hidden="true">⚠ </span>{copy.body}
      </p>
    </Lightbox>
  );
}
