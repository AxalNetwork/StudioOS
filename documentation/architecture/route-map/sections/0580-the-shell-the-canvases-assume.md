## The shell the canvases assume

Every `Pages · *` canvas renders a fixed 9-row sidebar that does not match
`sidebarConfig.js` for any role:

- founder — Home · Validate · Build · Raise · Grow · Network · Research · Trust · Company Settings
- investor — Home · Deals · Portfolio · Axal VC Fund · Fund (locked) · Network · Research · Trust · Firm Settings
- partner — Home · Spin-Out Lab · Pipeline · Delivery · Offers · Network · Research; Company Settings is the pinned footer
- advisor — Home · Practice · Cohorts · Expertise · Network · Research · Practice Settings

Adopting the detail-layer pages implies an IA change, not just new routes. Note
the canvases still model Growth and Research as "Preview", which live has already
shipped — as mock shells.

