import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Pill, Stat } from '../../ui';
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
 * fills in wrongly: nobody can send you a document. That is still true, and
 * the reason has changed. The grant that would carry it now exists —
 * `advisor_client_grants` (migration 218) opens one project to one named
 * advisor, scope by scope — and `advisor_client_document_shares` is the table
 * a pushed document would live in. It has a reader, in the client brief, and
 * no writer: no surface in this product lets a founder pick a file and send
 * it. So an empty library still means you have uploaded nothing rather than
 * that nobody shared anything, and it says so for a narrower reason than
 * before.
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

      {/* THE CANVAS'S FOUR-STAT STRIP, WITH THREE OF THE FOUR ADMITTING THEY
          HAVE NO SOURCE — which is the finding, not a shortfall in the wiring.
          `Pages · {Founder,Investor} Research` asks this zone for `Documents`,
          `Primary sources`, `Questions asked` and a cost per question.
          `research_documents` holds title, kind, size, index state, passage
          count and dates: no primary/secondary classification, no question
          history, no per-question cost. Two of those three follow from the same
          missing store, so the strip names it once and the header row's ops
          half — `Clear history — no session history is stored to clear` —
          already says the same thing from the other side.

          A figure is never modelled to fill a tile. `Stat` would print an
          em-dash for a null, which reads as a value; these say `Not recorded`
          in words. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Documents"
          value={payload ? items.length : undefined}
          note={payload ? `${payload.indexed} answerable by Ask` : 'library not read'}
        />
        <Stat
          label="Primary sources"
          value="Not recorded"
          mono={false}
          note="no document records whether it is your own research or a bought report"
        />
        <Stat
          label="Questions asked"
          value="Not recorded"
          mono={false}
          note="no question history is stored, here or in Ask"
        />
        <Stat
          label="Cost per question"
          value="Not recorded"
          mono={false}
          note="the same missing history — nothing is priced per question or per document"
        />
      </div>

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
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              Newest first · state governs what Ask can cite
            </span>
          </div>
          {/* THE CANVAS DRAWS A TABLE WITH NAMED COLUMNS, and it is the right
              shape: kind and state were chips in a row of chips, which is fine
              to read one at a time and impossible to scan down.

              `Year` IS RELABELLED, NOT DROPPED. The canvas means the source's
              own year — the thing that makes a 2023 report stale — and nothing
              records it; `created_at` is when the file was added here, which is
              a different fact, so the column says `Added` and carries the date
              it actually has. `Questions` has no column at all: it would be a
              whole column of "Not recorded", and the strip above says it once.

              Its own scroller, so a narrow viewport scrolls the table and never
              the page. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  {['Document', 'Kind', 'Added', 'Passages', 'State', ''].map((head) => (
                    <th
                      key={head || 'actions'}
                      scope="col"
                      className="pb-2 pr-3 text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.uid} className="border-b border-gray-100 align-top dark:border-gray-800">
                    <td className="py-3 pr-3">
                      <span className="text-[13px] font-extrabold">{d.title}</span>
                      <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                        {fmtBytes(d.size_bytes) || <Unrecorded>Size not recorded</Unrecorded>}
                      </span>
                      {d.index_note && (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300">
                          {d.index_note}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-[11.5px] text-gray-600 dark:text-gray-300">
                      {KINDS.find((k) => k.value === d.kind)?.label || d.kind}
                    </td>
                    <td className="py-3 pr-3 text-[11.5px] tabular-nums text-gray-600 dark:text-gray-300">
                      {String(d.created_at || '').slice(0, 10) || <Unrecorded>Not recorded</Unrecorded>}
                    </td>
                    <td className="py-3 pr-3 text-[11.5px] tabular-nums text-gray-600 dark:text-gray-300">
                      {/* NULL, not 0. A document that has never been read shows
                          no passage count rather than claiming it has none. */}
                      {d.chunk_count == null
                        ? <Unrecorded>Not indexed</Unrecorded>
                        : d.chunk_count}
                    </td>
                    <td className="py-3 pr-3">
                      <Pill tone={STATE_TONE[d.index_state] || 'neutral'}>
                        {STATE_LABEL[d.index_state] || d.index_state}
                      </Pill>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-3">
                        <button type="button" className={ghostButtonClass} onClick={() => download(d.uid)}>
                          Open
                        </button>
                        <button
                          type="button" disabled={busy} onClick={() => remove(d.uid)}
                          className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
