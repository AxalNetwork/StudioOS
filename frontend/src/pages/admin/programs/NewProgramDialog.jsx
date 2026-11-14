// D964 (#2797, Programs part 11) — New program (PG2's header, dc:469), for a
// Super Admin, on part 2's `POST /api/admin/programs` (D955 §5). It takes
// Basics and How it runs, and adds a program as Proposed with an empty
// playbook draft. Part 2's refusals sit in place under the buttons, among them
// `program_key_taken`, and the dialog stays open.
import React, { useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { programProposalsApi } from '../../../lib/api/programProposals';
import { H2, Refusal, SUB } from './parts';
import { BasicsFields, HowItRunsFields } from './ProposalFields';
import { NEW_PROGRAM, NEW_PROGRAM_LINE, emptyForm, newProgramFields, proposalRefusal } from './proposalsModel';

const BTN = 'inline-flex min-h-[36px] items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';

export default function NewProgramDialog({ onClose, onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setRefusal(null); };

  async function create() {
    if (!form.name.trim() || !form.group) { setRefusal('Add a name and a group to create a program.'); return; }
    setBusy(true); setRefusal(null);
    try {
      const res = await programProposalsApi.newProgram(newProgramFields(form));
      onCreated({ name: form.name.trim(), key: res?.program?.key ?? res?.key ?? null });
    } catch (e) {
      setRefusal(proposalRefusal(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Lightbox label={NEW_PROGRAM} title={NEW_PROGRAM} sub={NEW_PROGRAM_LINE} onClose={onClose} width={620} testId="programs-new-dialog">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2.5">
          <h3 className={H2}>Basics</h3>
          <BasicsFields form={form} set={set} prefix="programs-new" />
        </section>
        <section className="flex flex-col gap-2.5">
          <h3 className={H2}>How it runs</h3>
          <HowItRunsFields form={form} set={set} prefix="programs-new" />
        </section>
        <p className={`m-0 ${SUB}`}>Terms and tools belong to a studio’s proposal, so they are not asked here.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} data-testid="programs-new-cancel">Cancel</button>
          <button type="button" className={PRIMARY} disabled={busy} onClick={create} data-testid="programs-new-create">{busy ? 'Creating…' : 'Create program'}</button>
        </div>
        <Refusal text={refusal} testId="programs-new-refusal" />
      </div>
    </Lightbox>
  );
}
