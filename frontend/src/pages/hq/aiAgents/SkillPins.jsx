import React, { useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { adminHqSkillsApi } from '../../../lib/api/adminHqSkills.js';

export function PinVersions({ data }) {
  return <>
    {data.versions.length === 0 && <p>No published versions.</p>}
    {data.versions.map(version => (
      <section key={version.version} className="space-y-1 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <h4 className="font-semibold">v{version.version}{version.current && ' · Current'}</h4>
        <p>{version.agents} live {version.agents === 1 ? 'agent' : 'agents'}</p>
        <ul>{data.agents.filter(agent => agent.pinned_version === version.version).map(agent =>
          <li key={agent.uid} className="break-words">{agent.name || 'Name not recorded'} · {agent.team?.project_name || agent.team?.company_name || 'Team not recorded'}{agent.update_available && ' · Update available'}</li>
        )}</ul>
      </section>
    ))}
    {data.agents_total > data.agents.length && <p>Showing {data.agents.length} of {data.agents_total} agents.</p>}
  </>;
}

export default function SkillPins({ uid }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    adminHqSkillsApi.pins(uid, { signal: controller.signal }).then(data => {
      if (!Array.isArray(data?.versions) || !Array.isArray(data?.agents)) throw new Error('Invalid pins response');
      if (!controller.signal.aborted) setResult({ data });
    }).catch(() => { if (!controller.signal.aborted) setResult({ error: true }); });
    return () => controller.abort();
  }, [uid, attempt]);
  return <Card className="space-y-3 px-4 py-4 text-sm text-axal-ink dark:text-gray-100">
    <h3 className="font-bold">Usage and assignments</h3>
    <h4>Agents pinned to each version</h4>
    {!result && <p role="status">Reading assignments…</p>}
    {result?.error && <p role="alert">Assignments could not be read. <button type="button" className="underline" onClick={() => setAttempt(n => n + 1)}>Try again</button></p>}
    {result?.data && <PinVersions data={result.data} />}
  </Card>;
}
