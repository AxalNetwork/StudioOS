# Tail archive consumer

`src/` contains the studioos-only archive handler, conditional batch writer and private metadata protocol. The root Worker owns producer wiring. This consumer and the independent observer must have no tail consumer of their own.

D5676 keeps raw NDJSON in the existing archive and sends only authenticated metadata through an optional binding to a separate observer, never back to studioos. The observer binding/secret are not provisioned here. Archive writes continue when telemetry is unavailable, with explicit unknown telemetry. Retention metadata is a hint, not an expiration or lock policy; changing bucket policy needs a separate owner decision.
