// Growth · Partnerships — co-selling, channel, and strategic-partnership
// matching for the profile. Rendered inside GrowthWorkspace as the Partnerships
// tab. Scaffolded for now: the tab and route are live and the section reads
// consistently with its siblings, but it shows no fabricated partnership data —
// the working surface is built out separately.
import React from 'react';
import { Handshake } from 'lucide-react';
import { EmptyState, Section, BulletList } from './kit';

export default function PartnershipsPage() {
  return (
    <div className="space-y-5">
      <Section title="Partnerships">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Discover and manage strategic, channel, and co-selling partnerships —
          matched to the same fit-scoring engine that powers the other Growth areas.
        </p>
        <div className="mt-3">
          <BulletList
            tone="violet"
            items={[
              'Partner discovery with fit scoring and warm-intro paths',
              'Co-selling and channel pipeline tracking',
              'Joint go-to-market and co-marketing plans',
              'Partnership agreements, milestones, and shared metrics',
            ]}
          />
        </div>
      </Section>

      <EmptyState>
        <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
          <Handshake size={16} /> Partnerships is being built out — no records yet.
        </div>
      </EmptyState>
    </div>
  );
}
