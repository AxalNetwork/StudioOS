### Distribution Newsletter (D4495, #4495; part of #3722)

`/grow/distribution/newsletter` uses #4484's Distribution shell; `CycleRoute`
renders `NewsletterTab.jsx` for `tab="newsletter"`. It is the not-connected
state, the only one until the Beehiiv connector (#2407) exists: a "Connect
Beehiiv" door marked "Not offered yet" and three results (opens, clicks,
unsubscribes) that read "Not recorded". It makes no API call, so no list,
editor or subscriber is drawn. Axal's own house newsletter (D810,
`/api/newsletter`) is never used for a founder.
