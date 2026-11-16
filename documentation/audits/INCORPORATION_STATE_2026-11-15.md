# Incorporation state: what can be paid for, what has approved templates, what has orders (2026-11-15)

**#6684, plan key E4 of #6680. This is a point-in-time note: it does not change after its date.**

## The question

- **What nobody knows yet:**
  - whether `uk_ltd`, `sg_pte` or `ee_oy` can be paid for in production;
  - whether any orders for them exist;
  - which incorporation templates have a counsel-approved body.
- **Who needs the answer:** owner decision 11 (#6681, question 11) and the backfill.

## Step 1 (built here): `scripts/report-incorporation-state.mjs`

The script is read only:
- every database statement is checked to be a `SELECT` before it runs;
- a SQLite source is opened read only;
- Stripe is only listed.

It prints counts and yes/no answers, and never a name, an email, a company name or an amount.

**What it reports for each of the six jurisdiction ids in `routes/legal.ts`:**
- `incorporations` rows, counted by status;
- whether an active Stripe catalogue product carries `metadata.jurisdiction_id` with an active one-time price (yes, no, or not checked when there is no key);
- for each template key:
  - whether an active, non-stub body exists;
  - whether a counsel approval exists. That means a D4811 `legal_reviews` decision of approved or approved-with-conditions for that template's current version, bound to that body's SHA-256.

**What it reports for the whole database:**
- any `jurisdiction_id` outside the six, with its count;
- how many projects hold more than one paid order (D367 paid statuses: `paid`, `packet_processing`, `packet_ready`, `filed`);
- whether the incorporation flow's own sources show a beneficial-ownership (BOI or FinCEN) filing step.
  - **On `main` today:** "no". This is read from the code, not from production.

**Tests:** `cloudflare-worker/test/report_incorporation_state_6684.test.mjs` runs it against a fixture database, and checks:
- the counts;
- that an approval of a different body does not count;
- that a missing table reads "not readable", never "no";
- that writes are refused;
- that the file is unchanged afterwards;
- that names and amounts never appear in the output.

## Step 2 (an operator on S01, production read access)

```text
node scripts/report-incorporation-state.mjs --d1 --env production
STRIPE_SECRET_KEY=<read key> node scripts/report-incorporation-state.mjs --d1 --env production   # adds the Stripe answer
```

Once that has run:
- post the output, counts and yes/no only, on #6684;
- update #6681, question 11.

**Results:** none yet. Step 2 has not run.
