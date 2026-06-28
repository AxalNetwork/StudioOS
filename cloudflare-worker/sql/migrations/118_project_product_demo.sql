-- Task #31 — Product demo source on projects. Feeds the Spin-Out Demo Day
-- deck's new "Product demo" slide (slot 6). Founders set these on the project
-- detail page (demo video link, live demo URL, caption/description, and a
-- screenshot image); the deck reads them as its single source of truth.
-- Additive + nullable so existing projects are unaffected.
ALTER TABLE projects ADD COLUMN product_demo_video_url TEXT;
ALTER TABLE projects ADD COLUMN product_demo_live_url TEXT;
ALTER TABLE projects ADD COLUMN product_demo_caption TEXT;
ALTER TABLE projects ADD COLUMN product_demo_screenshot_url TEXT;
