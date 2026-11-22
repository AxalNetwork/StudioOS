/** D6688 — INC8's subject board, before the existing six-step incorporation flow. */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { accountCompaniesApi } from '../../lib/api/accountCompanies';
import { Unreadable } from '../../ui/Honesty';
import { BTN_PRIMARY, BTN_TEXT } from '../team/teamUi';
import { incorporatePath } from '../account/companies/companiesModel';
import FormationEntry from '../account/companies/FormationEntry';
import { startSubjects } from './incorporateAdapter';

export function IncorporateStartView({ companies, projects, pick, onPick, onContinue, retry }) {
  const rows = startSubjects(companies.items, projects.items);
  const selectedCompany = rows.companies.find(row => pick === `company:${row.uid}`);
  const option = (key, name, note) => <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
    <input type="radio" name="incorporate-subject" value={key} checked={pick === key} onChange={() => onPick(key)} data-testid={`incorporate-subject-${key}`} />
    <span><b className="block">{name}</b><small className="text-gray-600 dark:text-gray-400">{note}</small></span>
  </label>;
  return <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-32 pt-6 text-gray-900 dark:text-gray-100 md:pb-6" data-testid="incorporate-start">
    <header><h1 className="text-2xl font-bold">What are you incorporating?</h1><p>Pick one. The next steps ask about the company and where to form it. Nothing is filed or charged until you pay at the end.</p></header>
    <fieldset className="flex flex-col gap-4"><legend className="sr-only">Choose what to incorporate</legend>
      <section className="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700"><h2 className="font-semibold">Convert a project into a company</h2>
        {projects.loading ? <p aria-busy="true">Reading projects…</p> : projects.error ? <Unreadable what="Your projects" onRetry={retry} /> : rows.projects.length ? rows.projects.map(row => option(`project:${row.id}`, row.name, 'Not a company yet')) : <p>No standalone project with a confirmed eligible incorporation state.</p>}
      </section>
      <section className="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700"><h2 className="font-semibold">Incorporate a company</h2>
        {companies.loading ? <p aria-busy="true">Reading companies…</p> : companies.error ? <Unreadable what="Your companies" onRetry={retry} /> : rows.companies.length ? rows.companies.map(row => option(`company:${row.uid}`, row.company_name, 'No legal record yet')) : <p>No company with a confirmed eligible incorporation state.</p>}
      </section>
      {option('fresh', 'A new company', 'Start fresh. We create a project for it first.')}
    </fieldset>
    {rows.excluded > 0 && <p>{rows.excluded} already incorporated or in formation {rows.excluded === 1 ? 'is' : 'are'} not listed.</p>}
    {rows.unreadable && <Unreadable what="Some incorporation statuses" onRetry={retry} />}
    {selectedCompany ? <FormationEntry entry={{ state: 'not_incorporated', allowed: true }} name={selectedCompany.company_name} uid={selectedCompany.uid} legalOnly onSaved={retry} /> : <Link className={BTN_TEXT} to="/account/portfolio">Already incorporated? Record its legal facts</Link>}
    <footer className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 md:static md:rounded-xl" aria-label="Continue">
      <span className="text-sm">{pick ? 'Opens Incorporate with your selection filled in.' : 'Pick one to continue.'}</span>
      <button type="button" className={`${BTN_PRIMARY} min-h-11 shrink-0`} data-testid="incorporate-start-continue" disabled={!pick || (pick !== 'fresh' && ![...rows.companies.map(row => `company:${row.uid}`), ...rows.projects.map(row => `project:${row.id}`)].includes(pick))} onClick={onContinue}>Continue</button>
    </footer>
  </main>;
}

export default function IncorporateStart({ initialPick = null }) {
  const [tick, setTick] = useState(0);
  const [companies, setCompanies] = useState({ loading: true, items: [] });
  const [projects, setProjects] = useState({ loading: true, items: [] });
  const [pick, setPick] = useState(initialPick);
  const navigate = useNavigate();
  useEffect(() => { setPick(initialPick); }, [initialPick]);
  useEffect(() => {
    let live = true;
    setCompanies({ loading: true, items: [] }); setProjects({ loading: true, items: [] });
    const read = async (loader, key, set) => {
      try { const result = await loader(); if (!Array.isArray(result?.[key])) throw Error(); if (live) set({ loading: false, items: result[key] }); }
      catch { if (live) set({ loading: false, error: true, items: [] }); }
    };
    read(accountCompaniesApi.companies, 'companies', setCompanies);
    read(accountCompaniesApi.projects, 'projects', setProjects);
    return () => { live = false; };
  }, [tick]);
  const go = () => {
    if (pick === 'fresh') navigate('/incorporate?new=1');
    else { const [kind, id] = (pick || '').split(':'); if (id) navigate(incorporatePath(id, kind)); }
  };
  return <IncorporateStartView companies={companies} projects={projects} pick={pick} onPick={setPick} onContinue={go} retry={() => setTick(n => n + 1)} />;
}
