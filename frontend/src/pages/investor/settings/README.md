# Investor Firm Settings

`InvestorFirmSettings.jsx` edits the caller’s firm profile and thesis using the existing investor-profile API (D6287).

D6287 part 2 adds, over existing reads only:

- `FirmStatusBlocks.jsx`: the four read-only status blocks (identity and accreditation, licences, funds, team seats), each with its own loading and Unavailable state.
- `FirmDealFit.jsx`: “In your deal flow now” after a save, with the session-only before/after compare.
- `FirmTeamSeats.jsx`: the seat list, Send invite, the link shown once, and Revoke as Scope → Review → Result.
- `firmSettingsModel.js`: the pure rules the three read (completeness, fit rows and moves, seat plan, refusal sentences).

A new piece of this page goes in its own file here and is named in this list.
