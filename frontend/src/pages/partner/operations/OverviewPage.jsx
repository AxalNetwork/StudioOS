import React, { useState } from 'react';
import {
  Building2, MapPin, Users, Globe, Calendar, Link as LinkIcon, Tag, Briefcase, Mail,
} from 'lucide-react';
import { FIRM, TEAM } from '../../../data/partner/operations';
import {
  Avatar, Chip, SlideOver, Section, Field, EmptyState,
} from './kit';

// Overview — the service-partner's company profile: identity and business info,
// the firm's story and value proposition, the categories/industries/geography it
// serves, its team directory (with per-member detail panels), and links.
export default function OverviewPage() {
  const [member, setMember] = useState(null);

  return (
    <div className="space-y-6">
      {/* Company profile header */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
            <Building2 size={30} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{FIRM.name}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{FIRM.tagline}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Chip tone="violet"><Briefcase size={10} /> {FIRM.type}</Chip>
              <Chip><MapPin size={10} /> {FIRM.hq}</Chip>
              <Chip><Users size={10} /> {FIRM.teamSize} people</Chip>
              <Chip><Calendar size={10} /> Founded {FIRM.founded}</Chip>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100 dark:border-gray-800">
          <Field label="Legal name">{FIRM.legalName}</Field>
          <Field label="Founded">{FIRM.founded}</Field>
          <Field label="Team size">{FIRM.teamSize}</Field>
          <Field label="Website">
            <a href={FIRM.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-600 hover:underline break-all">
              <Globe size={12} /> {FIRM.website.replace(/^https?:\/\//, '')}
            </a>
          </Field>
        </div>
      </div>

      {/* Description — mission / vision / story / value prop / pitch */}
      <Section title="Description">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DescCard label="Mission" text={FIRM.description.mission} />
          <DescCard label="Vision" text={FIRM.description.vision} />
          <DescCard label="Value proposition" text={FIRM.description.valueProp} />
          <DescCard label="Elevator pitch" text={FIRM.description.pitch} />
          <div className="md:col-span-2">
            <DescCard label="Story" text={FIRM.description.story} />
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Categories">
          <div className="flex flex-wrap gap-1.5">
            {FIRM.categories.map((c) => <Chip key={c} tone="violet"><Tag size={10} /> {c}</Chip>)}
          </div>
        </Section>
        <Section title="Industries served">
          <div className="flex flex-wrap gap-1.5">
            {FIRM.industriesServed.map((c) => <Chip key={c} tone="emerald">{c}</Chip>)}
          </div>
        </Section>
      </div>

      <Section title="Geography">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {FIRM.geography.map((g) => (
            <div key={g.region} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><MapPin size={14} className="text-violet-500" /> {g.region}</div>
                <Chip tone={g.coverage === 'Primary' ? 'emerald' : g.coverage === 'Active' ? 'blue' : 'amber'}>{g.coverage}</Chip>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{g.note}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Team directory */}
      <Section title={`Team (${TEAM.length})`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TEAM.map((m) => (
            <button
              key={m.id}
              onClick={() => setMember(m)}
              className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Avatar name={m.name} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{m.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.title} · {m.team}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 inline-flex items-center gap-1"><MapPin size={10} /> {m.location}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
        {TEAM.length === 0 && <EmptyState>No team members listed yet.</EmptyState>}
      </Section>

      {/* Website & socials */}
      <Section title="Website & socials">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {FIRM.socials.map((s) => (
            <a
              key={s.label}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <LinkIcon size={15} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 w-24">{s.label}</span>
              <span className="text-sm text-violet-600 truncate">{s.handle}</span>
            </a>
          ))}
        </div>
      </Section>

      <TeamMemberDetail member={member} onClose={() => setMember(null)} />
    </div>
  );
}

function DescCard({ label, text }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{text}</p>
    </div>
  );
}

function TeamMemberDetail({ member, onClose }) {
  if (!member) return <SlideOver open={false} onClose={onClose} />;
  return (
    <SlideOver open onClose={onClose} title={member.name} subtitle={`${member.title} · ${member.team}`}>
      <div className="flex items-center gap-3">
        <Avatar name={member.name} size={56} />
        <div className="flex flex-wrap gap-1.5">
          {member.expertise.map((e) => <Chip key={e} tone="violet">{e}</Chip>)}
        </div>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300">{member.bio}</p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Team">{member.team}</Field>
        <Field label="Location"><span className="inline-flex items-center gap-1"><MapPin size={12} /> {member.location}</span></Field>
        <Field label="Email"><span className="inline-flex items-center gap-1 break-all"><Mail size={12} /> {member.email}</span></Field>
        <Field label="With firm since">{member.since?.slice(0, 4)}</Field>
      </div>

      <Section title="Areas of expertise">
        <div className="flex flex-wrap gap-1.5">
          {member.expertise.map((e) => <Chip key={e} tone="emerald">{e}</Chip>)}
        </div>
      </Section>
    </SlideOver>
  );
}
