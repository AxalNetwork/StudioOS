import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { mobilePlan } from '../lib/mobileTabs.js';
import { PERSONA_BY_ID } from '../lib/personas.js';
import { PhoneBar, PhoneRows } from '../ui';

const OUTSIDE = new Set(['/validate', '/build', '/raise', '/grow', '/studio', '/trust', '/company-settings']);

export function moreGroups(groups, primaryPersonaId) {
  const rows = (mobilePlan('founder', groups)?.more || []).filter(row => !OUTSIDE.has(row.to));
  const around = rows.filter(row => row.to === '/network' || row.to === '/research').map(row => ({
    ...row, title: row.label, description: row.to === '/network'
      ? 'Relationships, introductions, organizations'
      : 'Ask, markets, geographies, companies, funds, library',
  }));
  const other = rows.filter(row => row.to !== '/network' && row.to !== '/research').map(row => ({ ...row, title: row.label }));
  // The sidebar's rule (App.jsx, getSidebarGroups): a persona's extras show
  // only when the persona is aligned with the founder role.
  const persona = Object.hasOwn(PERSONA_BY_ID, primaryPersonaId || '') ? PERSONA_BY_ID[primaryPersonaId] : null;
  const aligned = !persona?.role_alignment || persona.role_alignment === 'founder';
  const extras = aligned ? persona?.nav_extras || [] : [];
  for (const row of extras) if (!rows.some(existing => existing.to === row.to)) other.push({ ...row, title: row.label });
  return [{ label: 'Around the cycles', rows: around }, { rows: other }];
}

export default function MorePage() {
  const [persona, setPersona] = useState(null);
  const [personaError, setPersonaError] = useState(false);
  useEffect(() => {
    let alive = true;
    api.getMyPersonas().then(data => {
      const list = data?.personas || [];
      if (alive) setPersona((list.find(row => row.is_primary) || list[0])?.persona_id || null);
    }).catch(() => { if (alive) setPersonaError(true); });
    return () => { alive = false; };
  }, []);
  return <div className="-m-4 md:-m-6 lg:m-0 bg-white dark:bg-gray-950 min-h-screen">
    <PhoneBar back={{ label: 'Studio', to: '/studio' }} title="More" sub="Everything outside the four cycles." />
    <PhoneRows groups={moreGroups(undefined, persona)} />
    {personaError && <p role="alert" className="px-[22px] pb-4 text-sm text-gray-700 dark:text-gray-300">Unreadable — persona links could not be loaded.</p>}
  </div>;
}
