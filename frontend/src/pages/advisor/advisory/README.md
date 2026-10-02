# Advisor advisory pages

`AdvisorAdvisoryWorkspace.jsx` is the older tabbed shell. Clients and Contracts
still use it at `/advisor/advisory/clients` and `/advisor/advisory/contracts`.
The Practice zones provide the current opportunities, engagements and delivery
surfaces; do not create another booking or payment flow here.

`ClientsPage.jsx` derives its roster from the signed-in advisor's booking
history. `kit.jsx` groups clients by user ID, never by their display name.

`PrivateClientNote.jsx` edits one note per advisor/client pair through the
advisor API. Mount it with both owner and client IDs as its React key: switching
accounts or clients must discard the previous draft and pending load. Load failures block
editing; save failures retain the draft. Notes belong to the authenticated
advisor and stay separate from shared booking records, client briefs and sent
deliverables. Migration 369 declares the private store; only booked clients are
eligible, and the API checks the current advisor role and profile ownership.
