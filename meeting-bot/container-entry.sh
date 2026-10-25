#!/bin/sh
# B8: private local display/audio services. No meeting data or credentials in argv.
set -eu
pulseaudio --start --exit-idle-time=-1 >/dev/null 2>&1
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/dev/null 2>&1 &
attempt=0
while [ ! -S /tmp/.X11-unix/X99 ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then exit 1; fi
  sleep 0.1
done
exec node --experimental-strip-types --no-warnings src/entry.ts
