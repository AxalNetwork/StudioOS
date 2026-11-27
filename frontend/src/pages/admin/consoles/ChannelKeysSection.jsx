import React, { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { reportError } from '../../../lib/log';
import { channelKeysApi } from '../../../lib/api/channelKeys.js';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { CALLBACK_COPY, keySaveRefusal, safeGuideHref, TOKEN_MISSING_LEAD } from '../../../lib/integrationKeys';
import {
  CHANNELS_NOTE, GENERATED_ONCE, channelBadge, removeChannelText, rolloutLine, secretStateText, setPayload,
} from '../../../lib/channelKeys';

/**
 * D885 (#2561) — HQ › Integration keys › Channels: WhatsApp (way A and way B)
 * and the Telegram interview bot. Each card names its Worker secrets with set
 * or not set, the webhook to register, the rollout var (changed by a PR), the
 * runbook, and, for the Super Admin, Set, Rotate, Generate and Remove. A value
 * is never read back; a generated one is shown once, here.
 */
export default function ChannelKeysSection({ channels, holdsSecretWrites, onChanged, showToast }) {
  const [dialog, setDialog] = useState(null); // { row, only?: name }
  const [generated, setGenerated] = useState(null); // { channel, name, value }
  const [busy, setBusy] = useState(null);

  const onGenerate = async (row, name) => {
    setBusy(`${row.key}:${name}`);
    try {
      const r = await channelKeysApi.generate(row.key, name);
      setGenerated({ channel: row.key, name, value: r.generated_value });
      onChanged();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Could not generate the secret.' });
    } finally { setBusy(null); }
  };

  const onRemove = async (row) => {
    if (!confirm(removeChannelText(row))) return;
    setBusy(`${row.key}:remove`);
    try {
      await channelKeysApi.remove(row.key);
      showToast({ kind: 'ok', msg: `${row.label}: secrets removed.` });
      onChanged();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to remove' });
    } finally { setBusy(null); }
  };

  return (
    <section className="mt-8" data-testid="integration-keys-channels">
      <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Channels</h3>
      <p className="mt-1 mb-4 text-xs text-gray-600 dark:text-gray-400">{CHANNELS_NOTE}</p>
      {generated && (
        <div role="status" data-testid="channel-key-generated" className="mb-4 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-4 text-xs">
          <div className="font-semibold text-violet-900 dark:text-violet-100 mb-1">New <code>{generated.name}</code></div>
          <CopyField value={generated.value} lead="Shown once" testid="channel-key-generated-value" />
          <p className="mt-2 text-violet-800 dark:text-violet-200">{GENERATED_ONCE}</p>
          <button type="button" onClick={() => setGenerated(null)} className="mt-2 text-[11px] font-medium underline text-violet-800 dark:text-violet-200">I have copied it</button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {channels.map((row) => {
          const badge = channelBadge(row);
          const guide = safeGuideHref(row.guide_href);
          return (
            <div key={row.key} data-card data-testid={`channel-key-${row.key}`} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <h4 className="text-base font-bold text-gray-900 dark:text-gray-100">{row.label}</h4>
                <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.text}</span>
              </div>
              <ul className="mb-3 flex flex-col gap-1.5">
                {row.secrets.map((s) => (
                  <li key={s.name} className="flex items-center gap-2 text-xs flex-wrap" data-testid={`channel-key-secret-${s.name}`}>
                    <code className="break-all text-gray-800 dark:text-gray-200">{s.name}</code>
                    <span className={s.set ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}>{secretStateText(s)}</span>
                    {holdsSecretWrites && s.set && (
                      <button type="button" onClick={() => setDialog({ row, only: s.name })} className="text-[11px] font-medium text-violet-700 dark:text-violet-300 underline">Rotate</button>
                    )}
                    {holdsSecretWrites && s.generate && (
                      <button type="button" disabled={busy === `${row.key}:${s.name}`} onClick={() => onGenerate(row, s.name)}
                        className="text-[11px] font-medium text-violet-700 dark:text-violet-300 underline disabled:opacity-50">Generate</button>
                    )}
                  </li>
                ))}
                {row.vars.map((v) => (
                  <li key={v.name} className="flex items-center gap-2 text-xs flex-wrap" data-testid={`channel-key-var-${v.name}`}>
                    <code className="break-all text-gray-800 dark:text-gray-200">{v.name}</code>
                    <span className="text-gray-500 dark:text-gray-400">{secretStateText(v)} · set in wrangler.toml by a PR</span>
                  </li>
                ))}
              </ul>
              <div className="mb-3 flex flex-col gap-2">
                {row.webhook_url
                  ? <CopyField value={row.webhook_url} lead="Webhook URL to register" testid={`channel-key-webhook-${row.key}`} />
                  : <p className="text-xs text-amber-800 dark:text-amber-300">The public base URL is not set, so there is no webhook address to register.</p>}
                {row.register_webhook_href && (
                  <a href={row.register_webhook_href} className="self-start text-xs font-medium text-violet-700 dark:text-violet-300 underline" data-testid={`channel-key-register-${row.key}`}>
                    Register the webhook in HQ › Telegram
                  </a>
                )}
                <p className="text-xs text-gray-600 dark:text-gray-400" data-testid={`channel-key-rollout-${row.key}`}>{rolloutLine(row.rollout)}</p>
                {guide && (
                  <a href={guide} target="_blank" rel="noopener noreferrer" className="self-start text-xs font-medium text-violet-700 dark:text-violet-300 underline">Runbook</a>
                )}
              </div>
              {holdsSecretWrites && (
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => setDialog({ row })}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700">Set secrets</button>
                  <button type="button" disabled={busy === `${row.key}:remove`} onClick={() => onRemove(row)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 inline-flex items-center gap-1.5 disabled:opacity-50">
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dialog && (
        <ChannelSecretsDialog row={dialog.row} only={dialog.only || null}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); onChanged(); showToast({ kind: 'ok', msg: dialog.only ? `${dialog.only} rotated.` : 'Secrets saved.' }); }} />
      )}
    </section>
  );
}

/** A value with Copy: the webhook to register, or a generated token. */
function CopyField({ value, lead, testid }) {
  const [copy, setCopy] = useState('idle');
  const onCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopy('done');
      setTimeout(() => setCopy('idle'), 1600);
    } catch (e) {
      reportError('ChannelKeys:copy', e);
      setCopy('failed');
    }
  };
  return (
    <div className="text-xs" data-testid={testid}>
      <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">{lead}</div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-gray-50 dark:bg-gray-900 px-2 py-1 text-gray-800 dark:text-gray-200">{value}</code>
        <button type="button" onClick={onCopy}
          className="shrink-0 px-2 py-1 text-[11px] font-medium rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/70">
          {copy === 'done' ? CALLBACK_COPY.done : CALLBACK_COPY.idle}
        </button>
      </div>
      {copy === 'failed' && <p role="alert" className="mt-1 text-[11px] text-red-700 dark:text-red-300">{CALLBACK_COPY.failed}</p>}
    </div>
  );
}

/**
 * Set a channel's secrets, or rotate one (`only`). One password field per
 * secret name the channel owns; a field left empty is not sent. A refusal is
 * said inside the dialog (#2199), which keeps what was typed.
 */
export function ChannelSecretsDialog({ row, only = null, onClose, onSaved }) {
  const names = row.secrets.map((s) => s.name).filter((n) => !only || n === only);
  const [typed, setTyped] = useState({});
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState(null);
  useEscapeClose(onClose);

  const submit = async (e) => {
    e?.preventDefault?.();
    const values = setPayload({ secrets: names.map((name) => ({ name })) }, typed);
    if (!Object.keys(values).length) {
      setRefusal({ message: only ? `Paste the new value for ${only}.` : 'Paste at least one secret.', commands: [] });
      return;
    }
    setRefusal(null);
    setSaving(true);
    try {
      if (only) await channelKeysApi.rotate(row.key, only, values[only]);
      else await channelKeysApi.set(row.key, values);
      onSaved();
    } catch (err) {
      setRefusal(keySaveRefusal(err, { names: Object.keys(values), fallback: only ? 'Failed to rotate' : 'Failed to save' }));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} data-testid="channel-key-dialog"
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{only ? `Rotate ${only}` : `${row.label}: secrets`}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        {names.map((name, i) => (
          <label key={name} className="block mb-3">
            <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"><code>{name}</code></span>
            <input type="password" autoFocus={i === 0} autoComplete="new-password" spellCheck={false}
              value={typed[name] || ''} onChange={(e) => setTyped({ ...typed, [name]: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono"
              placeholder="••••••••••••••••" />
          </label>
        ))}
        {!only && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">A field left empty is not changed.</p>}
        {refusal && (
          <div role="alert" className="mb-4 px-3 py-2 rounded-lg text-xs bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800" data-testid="channel-key-dialog-error">
            <p className="m-0">{refusal.message}</p>
            {refusal.commands.length > 0 && (
              <div className="mt-2">
                <p className="m-0">{TOKEN_MISSING_LEAD}</p>
                {refusal.commands.map((c) => <code key={c} className="mt-1 block break-all rounded bg-white dark:bg-gray-900 px-2 py-1">{c}</code>)}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 inline-flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {only ? 'Rotate secret' : 'Save secrets'}
          </button>
        </div>
      </form>
    </div>
  );
}
