# design/incoming — new Claude Design UIs waiting to be integrated

**Drop new Claude Design exports here.** This is the intake queue: a canvas
lands in this folder, gets triaged, gets built, and then the row in
`documentation/architecture/ROUTE_MAP.md` records what shipped and what did not.

Nothing in this folder is built, bundled, imported or served. It is source
material. The app never reads it at runtime.

## Where the existing canvases live

The 107 canvases from the first integration pass are in `design/canvases/`,
sorted by whether a live route exists for them:

| Folder | Meaning |
| --- | --- |
| `canvases/integrated/` | 53 — a route is running on main for this canvas. |
| `canvases/backlog/` | 27 — triaged, no route yet. |
| `canvases/out-of-scope/` | 27 — deliberately not being built. |

**A canvas that is already implemented does not belong in this folder.** Once
its route is live, move it to `canvases/integrated/`; this queue should only
ever hold work that is still outstanding.

## The pipeline

1. **Land it.** Save the export here as `<Surface Name>.dc.html`, keeping the
   name Claude Design gave it so it can be matched against the design source
   later. One file per canvas.
2. **Triage it** into one of six grades, and add a row to
   `documentation/architecture/ROUTE_MAP.md`:

   | Grade | Meaning |
   | --- | --- |
   | CURRENT | The shipped surface already matches. Nothing to do. |
   | RESKIN | Backend exists and is wired; this is presentation only. |
   | UPGRADE | Surface exists; the canvas adds zones or fields to it. |
   | NEW | No surface exists yet. |
   | DEFERRED | Real, but not this pass. Say what it is waiting on. |
   | OUT OF SCOPE | Not being built. Say why. |

3. **Check the data before the pixels.** For every number, name or figure the
   canvas shows, find the column it comes from. This is the step that decides
   the work:
   - the column exists and something already writes it → wire it;
   - the column exists and *nothing reads it* → that is the common case here,
     and it is a wiring job, not a backend job;
   - the column does not exist → it is a migration, and a migration is a
     decision, not a detail. Raise it before building around it.
4. **Build it**, worker route first (`cloudflare-worker/src/routes/`), then the
   page.
5. **Record the gap.** Whatever the canvas asks for that you did not build,
   write the reason into the `ROUTE_MAP.md` row *and* into the page, where the
   user can see it.
6. **Move the file** into `design/canvases/integrated/` once its route is live
   — or into `backlog/` if it is triaged but not yet built. This queue holds
   only what has not been triaged.

## The rule that matters most

**A canvas is a proposal, not a specification.** These designs are drawn with
plausible sample content — named companies, advisors with specialities, reach
figures, conversion rates. If the platform does not store the fact behind one of
those, the surface must say it is not recorded. It must not render the sample.

That is not a style preference. The audit that started this integration found
whole surfaces — a partner's "portfolio", an advisor's "practice", a fund's
performance — that were canvas sample data shipped as fact, and a public
directory naming three advisors who do not exist. Every one of them looked
finished.

## Do not touch

Two constraints carry over from the current pass, both deliberate:

- **The Spin-Out Lab is not a target.** Not for diffs, not for upgrades, not for
  re-routing.
- **`/studio`, `/founder`, `/partner-portal` and `/office-hours` are untouched**
  in this pass.

And do not create `/founder`, `/investor`, `/advisor` or `/partner` as new
top-level roots — the persona is a role gate on an existing route, not a URL
prefix.
