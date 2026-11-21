# `frontend/src/pages/programs/catalog/` — the program map (D6966)

One file per program, `<key>.js`, named after the program's registry key
(`programsModel.js` `PROGRAMS`). Each default-exports plain data with no
imports: the registry key → canonical page → committed PDF, the availability
word, the name, purpose, audience, edition, slide count, the link preview and
the index card's line. Node scripts (`scripts/build-program-briefs.mjs`,
`scripts/lib/programCatalog.mjs`) read these files as well as the app.

## Rule for adding to it

Follow "Add a program" in `../README.md`: copy `spinout-lab.js`, name the file
after the key, and add the program's `../content/<key>.js` beside it. Never
edit another program's file; `../collect.js` refuses an entry whose key is not
its file name.
