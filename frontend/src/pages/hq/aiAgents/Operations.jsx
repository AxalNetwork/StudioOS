// D4522: connect HQ reads to the existing Super Admin APIs, independently of rollout.
import React, { useEffect, useState } from "react";
import CohortCard from "./CohortCard.jsx";
import { adminAiAgentsApi as api } from "../../../lib/api/adminAiAgents";
const missing = "Not recorded";
const money = (v) => (v == null ? missing : `$${(v / 1e6).toFixed(2)}`);
const text = (v) =>
  v == null
    ? missing
    : typeof v === "object"
      ? Array.isArray(v)
        ? v.map(text).join(" · ") || "None"
        : Object.entries(v)
            .map(([k, x]) => `${k.replaceAll("_", " ")}: ${text(x)}`)
            .join(" · ")
      : String(v);
const box =
  "rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";
export function useRead(read, key = "") {
  const [state, set] = useState({ loading: true }),
    [retry, again] = useState(0);
  useEffect(() => {
    let live = true;
    set({ loading: true });
    Promise.resolve()
      .then(read)
      .then(
        (data) => {
          if (live) set({ data });
        },
        () => {
          if (live) set({ error: true });
        },
      );
    return () => {
      live = false;
    };
  }, [key, retry]); // read is deliberately keyed by the requested resource
  return { ...state, retry: () => again((n) => n + 1) };
}
function Reading({ state, children }) {
  if (state.loading) return <p role="status">Loading…</p>;
  if (state.error)
    return (
      <p role="alert">
        Could not be read.{" "}
        <button className="underline min-h-11" onClick={state.retry}>
          Try again
        </button>
      </p>
    );
  return children(state.data);
}
function Table({ rows, columns }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map(([label]) => (
              <th className="p-2 text-left" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={r.uid ?? r.id ?? i}>
                {columns.map(([label, read]) => (
                  <td className="p-2 align-top" key={label}>
                    {read(r)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="p-4">
                No entries recorded.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Overview() {
  const state = useRead(() => api.overview());
  return (
    <Reading state={state}>
      {(d) => (
        <div className="space-y-4">
          <CohortCard />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ["Agents active", d.agents_active],
              [
                "Skills published",
                d.skills_published?.axal == null ||
                d.skills_published?.companies == null
                  ? null
                  : d.skills_published.axal + d.skills_published.companies,
              ],
              ["Runs this week", d.runs?.week],
              ["AI spend this month", money(d.spend_month?.spent_microusd)],
              ["Proposals accepted %", d.proposals_accepted_pct],
              ["Runs failed %", d.runs_failed_pct],
            ].map(([k, v]) => (
              <section className={box} key={k}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-axal-muted dark:text-gray-400">
                  {k}
                </h2>
                <p className="mt-1 font-mono text-2xl font-bold">{text(v)}</p>
              </section>
            ))}
          </div>
          <section className={box}>
            <h2>Needs attention</h2>
            {d.needs_attention.map((a) => (
              <div key={a.kind}>
                <h3>{a.label}</h3>
                {a.available === false ? (
                  <p>{missing}</p>
                ) : a.items?.length ? (
                  <ul>
                    {a.items.map((v, i) => (
                      <li key={i}>{text(v)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No items recorded.</p>
                )}
              </div>
            ))}
          </section>
          <section className={box}>
            <h2>Spend by area · 30 days</h2>
            <Table
              rows={d.spend_by_area_30d}
              columns={[
                ["Area", (r) => r.label],
                ["Spend", (r) => money(r.spent_microusd)],
              ]}
            />
          </section>
        </div>
      )}
    </Reading>
  );
}
export function Runs() {
  const [cursor, setCursor] = useState(""),
    [uid, select] = useState(null);
  const state = useRead(() => api.runs({ cursor }), cursor);
  return (
    <section className={box}>
      <h2>Runs</h2>
      <Reading state={state}>
        {(d) => (
          <>
            <Table
              rows={d.runs}
              columns={[
                [
                  "Time",
                  (r) => (
                    <button
                      className="underline min-h-11"
                      onClick={() => select(r.uid)}
                    >
                      {r.at}
                    </button>
                  ),
                ],
                ["Agent", (r) => r.agent?.name],
                ["Skills", (r) => r.skills.map((s) => s.name).join(", ")],
                ["Team", (r) => text(r.team)],
                ["Model", (r) => text(r.model)],
                ["Tokens", (r) => text(r.tokens)],
                ["Cost", (r) => money(r.cost_microusd)],
                ["Status", (r) => r.status],
              ]}
            />
            {cursor && (
              <button onClick={() => setCursor("")}>First page</button>
            )}
            {d.next_cursor && (
              <button onClick={() => setCursor(d.next_cursor)}>
                Next page
              </button>
            )}
          </>
        )}
      </Reading>
      {uid && <RunDetail key={uid} uid={uid} close={() => select(null)} />}
    </section>
  );
}
function RunDetail({ uid, close }) {
  const state = useRead(() => api.run(uid), uid);
  return (
    <section className={box}>
      <button onClick={close}>Close run</button>
      <Reading state={state}>
        {(d) => (
          <>
            <h3>Run details</h3>
            {["steps", "inputs", "output", "cost", "errors"].map((k) => (
              <p key={k}>
                <strong>{k}: </strong>
                {text(d.run?.[k])}
              </p>
            ))}
          </>
        )}
      </Reading>
    </section>
  );
}
export function Spend() {
  const [by, setBy] = useState("agent");
  const state = useRead(() => api.spend(by), by);
  return (
    <section className={box}>
      <h2>Spend</h2>
      <label>
        Group by{" "}
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          {["agent", "skill", "company", "model"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <Reading state={state}>
        {(d) => (
          <>
            <p>
              Spent: {money(d.spent_microusd)} · Budget:{" "}
              {money(d.budget_microusd)} · Projected:{" "}
              {money(d.projected_microusd)}
            </p>
            <Table
              rows={d.lines}
              columns={[
                ["Name", (r) => r.label],
                ["Spend", (r) => money(r.spent_microusd)],
                ["Runs", (r) => text(r.runs)],
              ]}
            />
            <h3>Teams at their cap</h3>
            <p>{text(d.teams_at_cap)}</p>
          </>
        )}
      </Reading>
    </section>
  );
}
export function Audit() {
  const [cursor, setCursor] = useState(""),
    [error, setError] = useState(false);
  const state = useRead(() => api.audit({ cursor }), cursor);
  return (
    <section className={box}>
      <h2>Admin audit</h2>
      <button
        className="min-h-11 underline"
        onClick={() => {
          setError(false);
          api.auditCsv().catch(() => setError(true));
        }}
      >
        Download CSV
      </button>
      {error && <p role="alert">The export could not be read. Try again.</p>}
      <Reading state={state}>
        {(d) => (
          <>
            <Table
              rows={d.rows}
              columns={[
                ["Time", (r) => r.at],
                ["Admin", (r) => text(r.admin?.name)],
                ["Action", (r) => r.action],
                ["Area", (r) => r.area],
                ["Subject", (r) => r.subject],
                ["Reason", (r) => r.reason],
                ["Before", (r) => text(r.before)],
                ["After", (r) => text(r.after)],
              ]}
            />
            {cursor && (
              <button onClick={() => setCursor("")}>First page</button>
            )}
            {d.next_cursor && (
              <button onClick={() => setCursor(d.next_cursor)}>
                Next page
              </button>
            )}
          </>
        )}
      </Reading>
    </section>
  );
}
export function Policies() {
  const state = useRead(() => api.policy());
  const [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const change = async (paused) => {
    setBusy(true);
    setError(false);
    try {
      if (paused) await api.resumeAll(reason);
      else await api.pauseAll(reason, confirm);
      setReason("");
      setConfirm("");
      state.retry();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Reading state={state}>
      {(d) =>
        !d.policy ? (
          <p role="alert">
            Policy could not be read.{" "}
            <button onClick={state.retry}>Try again</button>
          </p>
        ) : (
          <div className="space-y-4">
            <section className={box}>
              <h2>Platform AI policy</h2>
              <h3>Models by area</h3>
              <p>{text(d.policy.area_models)}</p>
              <h3>Locked models</h3>
              <p>{text(d.policy.locks)}</p>
              <h3>Caps</h3>
              {[
                "platform_budget",
                "default_team_cap",
                "max_team_cap",
                "per_run_ceiling",
              ].map((k) => (
                <p key={k}>
                  {k.replaceAll("_", " ")}: {money(d.policy[`${k}_microusd`])}
                </p>
              ))}
              <h3>Allowed read tools</h3>
              <p>{text(d.policy.read_tools)}</p>
            </section>
            <section className={box}>
              <h2>Guardrails</h2>
              <Table
                rows={d.guardrails}
                columns={[
                  ["Rule", (r) => r.rule],
                  ["Enforced by", (r) => r.check],
                  ["Violations · 30 days", (r) => text(r.violations_30d)],
                ]}
              />
            </section>
            <section className={box}>
              <h2>
                {d.policy.paused.on
                  ? "AI agents are paused"
                  : "Pause all AI agents"}
              </h2>
              <p>
                Open proposals stay decidable. This does not enable the agent
                rollout.
              </p>
              <label>
                Reason · required
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="block border dark:bg-gray-800"
                />
              </label>
              {!d.policy.paused.on && (
                <label>
                  Type PAUSE to confirm
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="block border dark:bg-gray-800"
                  />
                </label>
              )}
              <button
                className="min-h-11 underline disabled:opacity-50"
                disabled={
                  busy ||
                  reason.trim().length < 10 ||
                  reason.trim().length > 500 ||
                  (!d.policy.paused.on && confirm !== "PAUSE")
                }
                onClick={() => change(d.policy.paused.on)}
              >
                {busy
                  ? "Saving…"
                  : d.policy.paused.on
                    ? "Resume AI agents"
                    : "Pause all AI agents"}
              </button>
              {error && (
                <p role="alert">
                  The change could not be saved. Read the current policy before
                  trying again.{" "}
                  <button onClick={state.retry}>Refresh policy</button>
                </p>
              )}
            </section>
          </div>
        )
      }
    </Reading>
  );
}
