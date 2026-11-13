import React, { useState } from 'react';
import { researchProjectBriefsApi } from '../../lib/api/researchProjectBriefs.js';

const headings = ['Executive summary', 'Key findings', 'Market context', 'Company comparison',
  'Risks and uncertainty', 'Open questions', 'Sources', 'Methodology'];

export default function ProjectBrief({ uid, read, retry, archived }) {
  if (read.status === 'loading') return <p role="status">Reading brief…</p>;
  if (read.status !== 'ok') return <p role="status">Brief could not be read. <button type="button" onClick={retry}>Retry</button></p>;
  return <BriefEditor key={uid} uid={uid} brief={read.value.brief} archived={archived} />;
}

function BriefEditor({ uid, brief, archived }) {
  const [sections, setSections] = useState(() => brief?.sections ?? headings.map(() => ({ text: '', reviewed: false })));
  const [version, setVersion] = useState(brief?.version ?? 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const edit = (index, value) => {
    setNotice(null);
    setSections((previous) => previous.map((section, i) => i === index ? { ...section, ...value } : section));
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { brief: saved } = await researchProjectBriefsApi.save(uid, { sections, version });
      setSections(saved.sections);
      setVersion(saved.version);
      setNotice('Brief saved.');
    } catch (err) {
      setError(err?.message || 'The brief could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={save} aria-label="Research brief">
      <h2>Research brief</h2>
      {archived && !version ? <p>No brief was saved.</p> : null}
      {headings.map((heading, i) => (
        <section key={heading} className="rounded-lg border border-axal-hairline p-4 dark:border-gray-700">
          <h3>{heading}</h3>
          {archived ? (
            <><p className="whitespace-pre-wrap break-words">{sections[i].text || 'Not recorded'}</p>
              {sections[i].text ? <p>{sections[i].reviewed ? 'Reviewed by you' : 'Draft'}</p> : null}</>
          ) : (
            <>
              <textarea aria-label={heading} rows={4} maxLength={8000} value={sections[i].text} disabled={busy}
                className="mt-2 w-full rounded border border-axal-hairline p-2 dark:border-gray-700 dark:bg-gray-950"
                onChange={(event) => edit(i, { text: event.target.value, reviewed: false })} />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sections[i].reviewed} disabled={busy || !sections[i].text.trim()}
                  onChange={(event) => edit(i, { reviewed: event.target.checked })} />
                Reviewed by you
              </label>
            </>
          )}
        </section>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!archived ? <button type="submit" className="self-start rounded bg-axal-violet px-4 py-2 text-white disabled:opacity-50"
        disabled={busy || !sections.some((section) => section.text.trim())}>{busy ? 'Saving…' : 'Save brief'}</button> : null}
    </form>
  );
}
