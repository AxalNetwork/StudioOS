import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Pill } from '../../ui';
import { api } from '../../lib/api';
import {
  Field, NothingYet, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneActions from '../../workspaces/ZoneActions';

/**
 * Research · Library — the documents you hold, and how far Ask can see into them.
 *
 * THE LAST COLUMN IS THE POINT. The canvas calls a document's indexed state
 * the most important thing on this page, and it is right: what is indexed is
 * precisely Ask's reach, so a file listed here that Ask cannot read is
 * invisible to every question asked upstairs. Rendering that as a tick, or
 * worse as nothing at all, would let a reader assume coverage they do not
 * have. Each row therefore says which of four states it is in, and an
 * unreadable file says why in words rather than showing an icon.
 *
 * `chunk_count` IS NULL UNTIL A FILE IS ACTUALLY INDEXED, never 0, and the
 * page keeps that distinction: "not indexed yet" and "indexed into nothing"
 * are different facts and only one of them means Ask has read the file.
 *
 * WHAT THIS PAGE CANNOT DO, stated rather than left as an empty list a reader
 * fills in wrongly: nobody can send you a document. A founder sharing their
 * own file with an advisor needs a grant that does not exist in the product —
 * the shape exists for investors (`data_room_grants`) and has no counterpart
 * here, and adding one is a decision about a founder's privacy rather than a
 * schema change. So an empty library means you have uploaded nothing, not
 * that nobody shared anything.
 */

const STATE_LABEL = {
  indexed: 'Answerable',
  pending: 'Reading…',
  unsupported: 'Not answerable',
  failed: 'Not answerable',
};
const STATE_TONE = {
  indexed: 'ok',
  pending: 'neutral',
  unsupported: 'warn',
  failed: 'danger',
};

const KINDS = [
  { value: 'document', label: 'Document' },
  { value: 'playbook', label: 'My playbook' },
  { value: 'client', label: 'About a client' },
];

function fmtBytes(n) {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `zoneActions` is the same render prop `AskZone` takes, for the same reason:
 * one route, four licences, four different sets of zone actions. Called with
 * the documents on screen so "export this view" has a view.
 */
export default function LibraryZone({ zoneActions }) {
  const [state, setState] = useState({ loading: true, error: '', payload: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [kind, setKind] = useState('document');
  const [title, setTitle] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      setState({ loading: false, error: '', payload: await api.research.documents() });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your library could not be read.', payload: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setNote({ ok: false, text: 'Choose a file first.' }); return; }
    setBusy(true); setNote(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      if (title.trim()) fd.append('title', title.trim());
      await api.research.upload(fd);
      if (fileRef.current) fileRef.current.value = '';
      setTitle('');
      // "Added" rather than "Indexed": reading the file happens on a queue and
      // has not finished yet. Claiming otherwise here would be the same lie
      // the state column exists to prevent.
      setNote({ ok: true, text: 'Added. Reading it now — the state below updates when Ask can use it.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be uploaded. Nothing was saved.' });
    } finally { setBusy(false); }
  };

  const remove = async (uid) => {
    setBusy(true); setNote(null);
    try {
      await api.research.remove(uid);
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be removed.' });
    } finally { setBusy(false); }
  };

  const download = async (uid) => {
    setNote(null);
    try {
      const res = await api.research.downloadUrl(uid);
      if (res?.url) window.location.href = res.url;
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That file could not be opened.' });
    }
  };

  const payload = state.payload;
  const items = payload?.items || [];

  return (
    <div className="space-y-4">
      {zoneActions && <ZoneActions className="mb-3" items={zoneActions(items)} />}
      <ZoneHeading
        title="Your library"
        blurb="The documents Ask reads from. What is answerable here is exactly what Ask can cite."
        action={payload ? (
          <Pill tone={payload.not_indexed > 0 ? 'warn' : 'ok'}>
            {payload.indexed} answerable
            {payload.not_indexed > 0 ? ` · ${payload.not_indexed} not` : ''}
          </Pill>
        ) : null}
      />

      <Card className="p-4">
        <form onSubmit={upload}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="File" hint="PDF, Word, PowerPoint, text, markdown or CSV. Up to 20 MB.">
              <input ref={fileRef} type="file" className={inputClass}
                accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv" />
            </Field>
            <Field label="What it is">
              <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Title" hint="Leave blank to use the filename.">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Adding…' : 'Add to library'}
            </button>
          </div>
          <SaveNote note={note} />
        </form>
      </Card>

      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={!state.loading && !state.error && items.length === 0}
        empty={(
          <NothingYet
            title="Nothing in your library yet"
            body="Add a document above and Ask can answer questions from it, citing the passage it used. Nothing here is inferred — an empty library means you have not added anything, not that a document failed to arrive. Nobody can send you one yet."
          />
        )}
      >
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">Documents</span>
            <span className="text-[11px] text-axal-ink-3">Newest first</span>
          </div>
          <ul className="divide-y divide-axal-border-soft">
            {items.map((d) => (
              <li key={d.uid} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-extrabold">{d.title}</span>
                  <Pill tone={STATE_TONE[d.index_state] || 'neutral'}>
                    {STATE_LABEL[d.index_state] || d.index_state}
                  </Pill>
                  <span className="text-[11px] text-axal-ink-3">
                    {KINDS.find((k) => k.value === d.kind)?.label || d.kind}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-axal-ink-3">
                  {fmtBytes(d.size_bytes) || <Unrecorded>Size not recorded</Unrecorded>}
                  {' · '}
                  {String(d.created_at || '').slice(0, 10)}
                  {' · '}
                  {/* NULL, not 0. A document that has never been read shows no
                      passage count rather than claiming it has none. */}
                  {d.chunk_count == null
                    ? <Unrecorded>No passages indexed</Unrecorded>
                    : `${d.chunk_count} passages Ask can cite`}
                </div>
                {d.index_note && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-axal-ink-2">{d.index_note}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-3">
                  <button type="button" className={ghostButtonClass} onClick={() => download(d.uid)}>
                    Open
                  </button>
                  <button
                    type="button" disabled={busy} onClick={() => remove(d.uid)}
                    className="text-[11px] text-axal-ink-3 underline hover:text-axal-ink-2"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </ZoneBody>

      <StatedLimit title="Nobody can send you a document yet">
        <p>
          This library holds what you add to it. A founder cannot share one of their own
          documents with you: the product has that mechanism for investors and no
          counterpart for anyone else, and adding one is a decision about a founder&rsquo;s
          privacy rather than a missing table.
        </p>
        <p>
          So an empty library means you have not uploaded anything. It never means a
          document was shared and failed to arrive.
        </p>
      </StatedLimit>
    </div>
  );
}
