## Research fund shortlist store (D7845)

`research_fund_shortlist.ts` mounts before the existing Research router at `/api/research/fund-shortlist`. POST atomically saves up to 50 served catalogue records into caller-private dossiers. GET `/requests/:requestId` reconciles only that caller’s request. Both use the existing single-fund save authentication gate. There is no new screen in this change; #7856 owns the shortlist screen. The frontend API module is `researchFundShortlist.js`.
