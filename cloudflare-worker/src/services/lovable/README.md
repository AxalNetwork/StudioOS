# services/lovable — Build in Lovable (D1082, #2947)

Part 2 of #2398: the launch link from a Validate experiment and from Build ›
Prototype / MVP. The Worker never calls Lovable; it records the founder's
press as one `build_handoffs` row (D1068's store, `provider = 'lovable'`).

| File | What it is |
| --- | --- |
| `prompt.ts` | The two deterministic templates (`landingTestPrompt`, `prototypePrompt`), the 4,000-character cap, `buildWithUrl` (`https://lovable.dev/#prompt=` and the encoded prompt, nothing else), the stores a prompt is never built from (`NEVER_INCLUDE`), and the privacy check (`lintForSend` as `public`, plus this venture's interviewees' names as whole words). A finding names its kind, never the words. |
| `launch.ts` | Draft, check, launch and the launches read for each cycle, and `lovableHandler`, the one handler `cycle_validate.ts` and `cycle_build.ts` mount at `/lovable/*`: the write gate, a support session refused at launch, the row and the activity line in one batch. |
| `signups.ts` | D1312 (#3432, part 4): an experiment's sign-up address. The token is derived from the row's `uid` with the index secret and only its hash is stored (migration 646); `acceptSignup` takes one form post (honeypot, a keyed-hash duplicate check, `waitlist_signups` with `source = 'lovable'`, no name or email); make, turn off, the slots' views and `liveAddress` for the prompt. |

The rule for adding here: nothing in this folder sends anything to Lovable,
and no log holds a prompt, a token, an address or an email. Part 3 (#2948) reads the app's address back; it
does not belong here.
