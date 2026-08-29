import React, { useEffect, useState } from 'react';
import {
  Building2, Briefcase, Tag, Pencil, Check, X, Handshake, Users, KeyRound,
} from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, Field, StatCard, EmptyState, Badge, formatDay, moneyUsd,
} from './kit';

// Overview — the partner's REAL firm profile and live practice snapshot.
//
// Wave 1a: this tab previously rendered a hard-coded fictional firm from
// data/partner/operations.js (see partner_operations_live.test.mjs for the
// history — its banned-string list is why no fixture name appears here).
// It now reads the
// partner's own row (GET /api/partner-portal/profile), their partner deal
// (my-deal), and live BD analytics. The partners table is deliberately thin,
// so the profile shows exactly what is recorded — name, company,
// specialization, referral stats, intro availability — and nothing invented.
export default function OverviewPage() {
  const [profile, setProfile] = useState(null);
  const [deal, setDeal] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', specialization: '' });
  const [saving, setSaving] = useState(false);
  const [savingIntros, setSavingIntros] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const p = await api.partnerPortal.getProfile();
      setProfile(p.partner);
      setForm({
        name: p.partner?.name || '',
        company: p.partner?.company || '',
        specialization: p.partner?.specialization || '',
      });
    } catch (e) {
      // Admins without a partners row, or a partner account not yet linked.
      setNoProfile(true);
    }
    try { setDeal(await api.partnerPortal.myDeal()); } catch { setDeal(null); }
    try { setAnalytics(await api.quotesAnalytics()); } catch { setAnalytics(null); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const saveProfile = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.partnerPortal.updateProfile({
        name: form.name,
        company: form.company,
        specialization: form.specialization,
      });
      setProfile(r.partner);
      setEditing(false);
    } catch (e) {
      setError(e?.message || 'Could not save the profile.');
    }
    setSaving(false);
  };

  const toggleIntros = async () => {
    if (!profile) return;
    setSavingIntros(true);
    try {
      const r = await api.partnerPortal.setAcceptingIntros(!profile.accepting_intros);
      setProfile((p) => ({ ...p, accepting_intros: !!r.accepting_intros }));
    } catch (e) {
      setError(e?.message || 'Could not update intro availability.');
    }
    setSavingIntros(false);
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading your practice…</div>;
  }

  if (noProfile) {
    return (
      <EmptyState>
        <p className="font-medium text-gray-700 dark:text-gray-300">No partner profile is attached to this account yet.</p>
        <p className="mt-1">
          Partner profiles are created during partner onboarding. If you were invited as a partner,
          finish onboarding from your invitation link; otherwise contact the Axal team.
        </p>
      </EmptyState>
    );
  }

  const pipeline = analytics?.pipeline || null;
  const delivery = analytics?.delivery || null;
  const specializations = (profile?.specialization || '')
    .split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Firm identity — the real row, editable in place */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
            <Building2 size={30} />
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Partner name"
                  className="w-full text-lg font-bold bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white"
                />
                <input
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  placeholder="Company / firm (optional)"
                  className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100"
                />
                <input
                  value={form.specialization}
                  onChange={(e) => setForm((f) => ({ ...f, specialization: e.target.value }))}
                  placeholder="Specializations, comma-separated (e.g. GTM, RevOps, Pricing)"
                  className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100"
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={saveProfile}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Check size={14} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setForm({ name: profile.name || '', company: profile.company || '', specialization: profile.specialization || '' }); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <X size={14} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate">{profile.name}</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                      {profile.company || <span className="italic text-gray-400">No firm name recorded</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-violet-300 flex-shrink-0"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Chip tone="violet"><Briefcase size={10} /> Service partner</Chip>
                  <Badge>{profile.status}</Badge>
                  <Chip tone={profile.accepting_intros ? 'emerald' : 'gray'}>
                    <Handshake size={10} /> {profile.accepting_intros ? 'Accepting intros' : 'Not accepting intros'}
                  </Chip>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100 dark:border-gray-800">
          <Field label="Contact email">{profile.email}</Field>
          <Field label="Partner since">{formatDay(profile.created_at)}</Field>
          <Field label="Referral code">
            {profile.referral_code
              ? <span className="inline-flex items-center gap-1 font-mono text-xs"><KeyRound size={12} /> {profile.referral_code}</span>
              : null}
          </Field>
          <Field label="Referrals to date">
            <span className="inline-flex items-center gap-1"><Users size={12} /> {profile.referrals_count}</span>
          </Field>
        </div>
      </div>

      {/* Intro availability toggle */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Founder introductions</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            When on, founders can request intros to you from the marketplace and directory.
          </div>
        </div>
        <button
          onClick={toggleIntros}
          disabled={savingIntros}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
            profile.accepting_intros
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
          }`}
        >
          {savingIntros ? 'Saving…' : profile.accepting_intros ? 'Accepting — turn off' : 'Paused — turn on'}
        </button>
      </div>

      {/* Specializations */}
      <Section title="Specializations">
        {specializations.length ? (
          <div className="flex flex-wrap gap-1.5">
            {specializations.map((s) => <Chip key={s} tone="violet"><Tag size={10} /> {s}</Chip>)}
          </div>
        ) : (
          <EmptyState>No specializations recorded yet — add them with Edit above so founders can find you.</EmptyState>
        )}
      </Section>

      {/* Live practice snapshot */}
      <Section title="Practice snapshot">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Win rate"
            value={pipeline?.win_rate_pct != null ? `${pipeline.win_rate_pct}%` : '—'}
            hint={pipeline?.win_rate_pct != null ? `${pipeline.accepted} won of ${pipeline.accepted + pipeline.rejected} decided` : 'No quotes decided yet'}
          />
          <StatCard
            label="Open pipeline"
            value={pipeline ? moneyUsd(pipeline.open_value) : '—'}
            hint={pipeline ? `${pipeline.pending} open proposal${pipeline.pending === 1 ? '' : 's'}` : undefined}
          />
          <StatCard
            label="Active engagements"
            value={delivery ? delivery.active : '—'}
            hint={delivery ? `${moneyUsd(delivery.active_value)} in flight` : undefined}
          />
          <StatCard
            label="Delivered value"
            value={delivery ? moneyUsd(delivery.delivered_value) : '—'}
            hint={delivery ? `${delivery.delivered} engagement${delivery.delivered === 1 ? '' : 's'} delivered` : undefined}
          />
        </div>
      </Section>

      {/* Partner deal (tier grants + redemptions) */}
      <Section title="Partner deal">
        {deal?.deal ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip tone="violet">{String(deal.deal.deal_type || '').replace(/_/g, ' ')}</Chip>
              <Badge>{deal.deal.status}</Badge>
              {deal.deal.term_months ? <Chip>{deal.deal.term_months}-month term</Chip> : null}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <Field label="Founder tier granted">{deal.deal.granted_tier_founder}</Field>
              <Field label="Investor tier granted">{deal.deal.granted_tier_investor}</Field>
              <Field label="Referral redemptions">{deal.redemptions_count}</Field>
              <Field label="Active since">{formatDay(deal.deal.activated_at || deal.deal.created_at)}</Field>
            </div>
          </div>
        ) : (
          <EmptyState>No partner deal on record. Deal terms appear here once your agreement is activated.</EmptyState>
        )}
      </Section>
    </div>
  );
}
