### Pitch › Review: comments across the deck, approvals, figures and their sources (D4271, #4271)

- **Worker:** none new. Reads `GET /api/decks/:id/comments`, `/approval` (D1570), `/figures` (D1523), `/check` and `/reviews` (D900).
- **Client:** `/raise/pitch/review` draws `ReviewTile.jsx` above `PitchReview.jsx`. A thread opens `/raise/pitch/edit?card=<n>&comments=1`; a figure opens `/raise/evidence/claim/:uid`, or its card.
- **Who:** comments and approvals for the founders and invited advisors; an admin is pointed to Notes.
