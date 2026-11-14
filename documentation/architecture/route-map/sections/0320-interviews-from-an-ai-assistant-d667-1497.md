### Interviews from an AI assistant (D667, #1497)

The interview tools of the StudioOS MCP connector (D665) are
`submit_interview`, `propose_placements` and `structure_with_axalvc` (`structure_with_studioos` until D1315, still an alias), in
`services/assistantInterviews.ts`. They are registered on #1496's
`/mcp` server, behind `MCP_SERVER_ENABLED`, so no SPA route is new.
What they write is reviewed on the Interview Session page's review step
(#1473), which reads `GET /api/founder/validate/sessions/:id/placements`.
That read now labels each run's `source` (`assistant` or `studioos`) and the
assistant's `submitted_via_name`. See `decisions/D667.md`.

