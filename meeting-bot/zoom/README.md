# Zoom Python sidecar

B4 (#2582, D886). `native.py` maps the Linux `zoom-meeting-sdk` binding to the
existing `ZoomSdkBridge`. `sidecar.py` serializes commands on GLib's main loop.
`test_native.py` uses synthetic SDK objects; `mutation_native.py` rewrites the
native source in memory and checks the same scenarios before/after each mutant.

Install the pinned binding in `requirements.txt` on Linux x86_64 with Python
3.10+, GLib/PyGObject, PulseAudio and the native SDK's required runtime libraries.
B8 owns the image. This folder does not download an SDK or install software at
runtime. On macOS the native import is unavailable; tests never import it.
The binding source inspected is `noah-duncan/py-zoom-meeting-sdk`, and PyPI
0.0.27 is the deployment candidate. Its actual native SDK version and Linux
image loading still require B8 verification before enabling dispatch.

Node's `ZoomSidecar` starts one Python process per run. It passes a short-lived
SDK JWT on stdin, then the founder's fresh OBF on each join. No credentials in
argv. Only display/audio/library/path environment variables are inherited;
Worker callback secrets and OAuth credentials are excluded. stdout/stderr are discarded; fd 3 alone carries JSON lines. Native SDK
logging and crash dumps are disabled. Protocol messages are private data,
never logs. EOF kills an orphan immediately. Node bounds commands, response
lines and deadlines, rejects malformed data and kills a crashed/stalled child.
Native callbacks are held alive and released at leave; no recording files or
model calls are made. The sidecar never has an OAuth refresh/access token.

A caller supplies an SDK JWT signed with the credentials actually assigned to
Axal's Zoom app; do not guess whether they are separate from OAuth credentials.
B1's founder/run-scoped OBF mint shipped with #2671
(`POST /api/meeting-bots/:uid/zoom-credentials`); it never accepts
caller-supplied member or meeting IDs. Its `waitingForHost` answer is the
waiting state the founder's panel shows (#2582).

The core notice is sent before joining audio, requesting recording privilege
or starting raw recording. Host denial/timeout refuses recording; revocation
ends capture immediately. The SDK session ending on authorizing-user departure
also ends capture. GLib handles admission/waiting room and delegates roster,
rename/leave, active-speaker and raw-audio callbacks. No chat messages are read.
The binding exposes 32/48 kHz options; this sidecar requests mono 32 kHz and
averages adjacent samples to 16 kHz. Other formats are refused. M4 must measure
quality and timing; no live audio fidelity is claimed by these unit tests.

Per-participant audio is connected (#2582). `native.py` subscribes to both the
mixed callback and `onOneWayAudioRawDataReceived(data, user_id)`, names checked
against `zoom-meeting-sdk` 0.0.27's source (`ZoomSDKAudioRawDataDelegateCallbacks`'
keyword arguments), and emits each participant's own stream as a `voice` event
keyed by `user_id`, never the bot's own. Node decides which path runs; separate
streams are never concatenated into a mixed timeline. Free-account M3/M4/M6 and credentials
verification are the owner's final live check. Nothing here selects the adapter
in a factory, changes a feature flag or enables live dispatch.

Reference: https://github.com/noah-duncan/py-zoom-meeting-sdk

B8 packages pinned `requirements.txt` into the Linux image. `check_runtime.py`
checks native SDK callbacks at build time; the isolated CI boot verifies the
installed SDK and GLib. Real Zoom join/OBF behavior remains unverified.
