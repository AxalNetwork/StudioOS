-- #5309 (D5309, D3724 §gaps 8 and 11) — the event cover's own columns.
--
-- Until now an event carried only `cover_url`: a link, with nothing said about
-- what the image shows, where it came from, or how to frame it. D3724's board
-- NE2 draws an uploaded cover with three crops, a focal point and alt text, and
-- §gap 11 names `cover_alt` as missing outright, so a screen reader had nothing
-- to read on any event cover.
--
-- `cover_alt`        what the image shows, the member's own words (≤ 200 chars).
-- `cover_source`     'uploaded' or 'generated'. NULL on every existing row: an
--                    event whose cover predates this migration has no recorded
--                    source, and the badge says so rather than guessing.
-- `cover_focal_json` {"x":0..1,"y":0..1} — the point every crop keeps in frame.
-- `cover_crops_json` {"card":{x,y,w,h},"social":{…},"square":{…}} in fractions
--                    of the stored image. The Worker stores ONE image and
--                    records the three rectangles; no Worker crops pixels.
ALTER TABLE events ADD COLUMN cover_alt TEXT;
ALTER TABLE events ADD COLUMN cover_source TEXT;
ALTER TABLE events ADD COLUMN cover_focal_json TEXT;
ALTER TABLE events ADD COLUMN cover_crops_json TEXT;
