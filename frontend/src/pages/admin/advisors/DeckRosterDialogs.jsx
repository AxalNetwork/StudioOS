import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { EYE, INPUT, Refusal, SUB } from '../partners/parts';
import {
  KINDS, MAX_BIO, accountFacts, PHOTO_TYPES, SKILLS, cardErrors, cardOf, confirmCopy, initialsOf, memberOptions, photoError, refusalOf,
} from './deckRosterModel';

/**
 * D980 (#2766) — the Deck roster's dialogs: AP8's one card dialog (one save,
 * the photo with its preview, a member-account link, inline errors) and
 * AP9a/b's confirmations, with Show and Restore asked the same way. Each
 * says what it changes; nothing is written before its button.
 */

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('The photo could not be read.'));
    r.readAsDataURL(file);
  });
}

/** A photo, or the initials when there is none or it fails to load. */
export function Avatar({ name, src, size = 40, testId }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const box = { width: size, height: size };
  return src && !failed ? (
    <img src={src} alt="" onError={() => setFailed(true)} style={box} className="flex-none rounded-full bg-axal-ground object-cover dark:bg-gray-800" data-testid={testId} />
  ) : (
    <span aria-hidden="true" style={box} className="grid flex-none place-items-center rounded-full bg-axal-lavender font-mono text-[11px] font-bold text-axal-violet dark:bg-violet-950/60 dark:text-violet-300" data-testid={testId}>{initialsOf(name)}</span>
  );
}

const FIELD = 'flex flex-col gap-1.5 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';
const ERR = 'm-0 text-[12px] font-semibold text-red-700 dark:text-red-300';
const bad = (on) => (on ? ' border-red-400 dark:border-red-700' : '');

/** The member-account link: search by name, pick one, or remove the link. */
function MemberLink({ value, onChange }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ status: 'idle', rows: [] });
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setState({ status: 'idle', rows: [] }); return undefined; }
    let live = true;
    setState({ status: 'loading', rows: [] });
    api.adminListUsers({ q: needle, limit: 8 }).then(
      (users) => { if (live) setState({ status: 'ready', rows: memberOptions(users) }); },
      (e) => { if (live) setState({ status: 'error', rows: [], reason: e?.message }); },
    );
    return () => { live = false; };
  }, [q]);
  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="deck-card-linked">
        <span className="rounded-full border border-axal-lavender-edge bg-axal-lavender px-2.5 py-1 text-[12px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">⛓ {value.name || 'Name not recorded'}</span>
        <button type="button" className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" onClick={() => onChange(null)}>Remove the link</button>
        {accountFacts(value) ? (
          <dl className="m-0 grid w-full grid-cols-[90px_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-[9px] bg-axal-ground px-3 py-2 dark:bg-gray-800" data-testid="deck-card-account">
            <dt className={`${EYE} col-span-2`}>From the account · read only</dt>
            {accountFacts(value).map((f) => (
              <React.Fragment key={f.key}>
                <dt className={SUB}>{f.label}</dt>
                <dd className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid={`deck-card-account-${f.key}`}>{f.text}</dd>
              </React.Fragment>
            ))}
            <dd className={`m-0 col-span-2 ${SUB}`}>Changed on the member’s own profile, not here. The card keeps its own fields for the deck.</dd>
          </dl>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className={FIELD}>
        <span className={EYE}>Link to a member account</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search member accounts by name" className={INPUT} data-testid="deck-card-member-search" />
      </label>
      {state.status === 'loading' ? <span className={SUB}>Searching…</span> : null}
      {state.status === 'error' ? <span className={ERR} role="alert">The accounts could not be searched: {state.reason || 'try again'}.</span> : null}
      {state.status === 'ready' && !state.rows.length ? <span className={SUB}>No active account matches ‘{q.trim()}’.</span> : null}
      {state.rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Accounts" data-testid="deck-card-members">
          {state.rows.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => { onChange({ id: u.id, name: u.name }); setQ(''); }} data-testid={`deck-card-member-${u.id}`}
                className="w-full rounded-[7px] border border-axal-hairline px-2.5 py-1.5 text-left text-[13px] text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">
                <b>{u.name}</b> <span className="text-axal-muted dark:text-gray-400">· {u.role}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <span className={SUB}>Optional. The card keeps its own name, role and photo; the link records whose account this is.</span>
    </div>
  );
}

/**
 * AP8: one dialog, one Save. A new card's photo is held until the card is
 * created, then uploaded with it. If the card saves and the photo does not,
 * the dialog stays open on the saved card, so a second Save cannot create it
 * twice.
 */
export function CardDialog({ row, onClose, onSaved, save }) {
  const [form, setForm] = useState(() => cardOf(row));
  const [saved, setSaved] = useState(row?.id ? row : null);
  const [touched, setTouched] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState('');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const fileRef = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const errors = cardErrors(form);
  const shownErrors = touched ? errors : {};
  const close = () => { if (!lock.current) onClose(); };

  const submitPhoto = async (picked) => {
    setFileError('');
    const why = photoError(picked);
    if (why) { setFileError(why); return; }
    if (!picked) return;
    try {
      setPreview(await readFileAsDataUri(picked));
      setFile(picked);
    } catch (e) { setFileError(e.message); }
  };

  const submit = async () => {
    if (lock.current) return;
    setTouched(true);
    if (Object.keys(errors).length) return;
    lock.current = true;
    setBusy(true);
    setRefusal('');
    try {
      const result = await save({ editing: saved, form, photo: file ? preview : null });
      if (result.photoError) {
        setSaved(result.row);
        setRefusal(`The card is saved, but the photo could not be uploaded: ${result.photoError} Choose it again or save without it.`);
        setFile(null);
        return;
      }
      onSaved(result.row, saved ? 'updated' : 'created');
    } catch (e) {
      setRefusal(refusalOf(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const title = saved ? `Edit deck card · ${saved.name || form.name}` : 'Add a person to the deck roster';
  const sub = form.linked_user ? `Linked to ${form.linked_user.name || 'a member'}’s account.` : 'Shown on the Team & Network slide of the Demo Day deck.';
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={close} testId="deck-card-dialog" width={620}
      footer={<>
        <button type="button" className={actionGhost} disabled={busy} onClick={close}>Cancel</button>
        <button type="button" className={actionPrimary} disabled={busy} onClick={submit} data-testid="deck-card-save">{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="flex flex-col gap-3.5">
        <label className={FIELD}>
          <span className={EYE}>Name · required</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={200} aria-invalid={Boolean(shownErrors.name)} className={INPUT + bad(shownErrors.name)} data-testid="deck-card-name" />
          {shownErrors.name ? <span className={ERR}>{shownErrors.name}</span> : null}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={EYE} id="deck-card-kind">Kind</span>
          <div role="radiogroup" aria-labelledby="deck-card-kind" className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button key={k.key} type="button" role="radio" aria-checked={form.kind === k.key} onClick={() => set('kind', k.key)} data-testid={`deck-card-kind-${k.key}`}
                className={`rounded-full border px-3 py-1 text-[12px] font-bold ${form.kind === k.key ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}>{k.label}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={FIELD}>
            <span className={EYE}>Role or title</span>
            <input value={form.role} onChange={(e) => set('role', e.target.value)} maxLength={200} className={INPUT} data-testid="deck-card-role" />
          </label>
          <label className={FIELD}>
            <span className={EYE}>Company</span>
            <input value={form.company} onChange={(e) => set('company', e.target.value)} maxLength={200} className={INPUT} data-testid="deck-card-company" />
          </label>
        </div>
        <label className={FIELD}>
          <span className={EYE}>Bio</span>
          <textarea value={form.bio} onChange={(e) => set('bio', e.target.value)} rows={3} aria-invalid={Boolean(shownErrors.bio)} className={`${INPUT} py-2${bad(shownErrors.bio)}`} data-testid="deck-card-bio" />
          <span className="self-end font-mono text-[11px] text-axal-muted dark:text-gray-400" data-testid="deck-card-bio-count">{form.bio.length.toLocaleString('en-US')} / {MAX_BIO.toLocaleString('en-US')}</span>
          {shownErrors.bio ? <span className={ERR}>{shownErrors.bio}</span> : null}
        </label>
        <label className={FIELD}>
          <span className={EYE}>LinkedIn URL</span>
          <input value={form.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/…" aria-invalid={Boolean(shownErrors.linkedin_url)} className={INPUT + bad(shownErrors.linkedin_url)} data-testid="deck-card-linkedin" />
          {shownErrors.linkedin_url ? <span className={ERR} data-testid="deck-card-linkedin-error">{shownErrors.linkedin_url}</span> : null}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={EYE}>Skills</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Skills">
            {SKILLS.map((s) => {
              const on = form.skills.includes(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => set('skills', on ? form.skills.filter((x) => x !== s) : [...form.skills, s])}
                  className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}>{s}</button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3" data-testid="deck-card-photo">
          <Avatar name={form.name} src={preview || saved?.photo_url || null} size={52} testId="deck-card-photo-preview" />
          <div className="flex flex-col gap-1">
            <span className={EYE}>Photo</span>
            <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(',')} className="hidden" onChange={(e) => submitPhoto(e.target.files?.[0])} data-testid="deck-card-file" />
            <button type="button" className={`${actionGhost} self-start`} disabled={busy} onClick={() => fileRef.current?.click()}>{file ? 'Choose another file' : 'Choose file'}</button>
            <span className={SUB}>{file ? `${file.name} is uploaded when you save.` : 'JPG, PNG or WebP, up to 2 MB, square works best.'}</span>
            {fileError ? <span className={ERR} role="alert">{fileError}</span> : null}
          </div>
        </div>
        <MemberLink value={form.linked_user} onChange={(v) => set('linked_user', v)} />
        <label className="flex items-center gap-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} data-testid="deck-card-shown" />
          Show on the deck
        </label>
        <Refusal text={refusal} testId="deck-card-refusal" />
      </div>
    </Lightbox>
  );
}

/** AP9a, AP9b, and Show and Restore asked the same way. */
export function ConfirmDialog({ act, row, onClose, run }) {
  const copy = confirmCopy(act, row);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setRefusal('');
    try {
      await run();
    } catch (e) {
      setRefusal(`${refusalOf(e)} Try again.`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} testId={`deck-${act}-dialog`}
      footer={<>
        <button type="button" className={actionGhost} disabled={busy} onClick={close}>Cancel</button>
        <button type="button" className={actionPrimary} disabled={busy} onClick={go} data-testid={`deck-${act}-confirm`}>{busy ? copy.busy : copy.button}</button>
      </>}>
      <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">{copy.body}</p>
      <div className="mt-3"><Refusal text={refusal} testId={`deck-${act}-refusal`} /></div>
    </Lightbox>
  );
}
