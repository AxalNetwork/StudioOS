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
B1 must supply the founder/run-scoped OBF mint through its existing helper.
No runtime mint endpoint exists on the inspected B1 main yet. Do not expose a
mint accepting caller-supplied member IDs or meeting IDs. B1 also needs a
waiting-state representation. These are integration prerequisites, not
implemented endpoints in this change.

The core notice is sent before joining audio, requesting recording privilege
or starting raw recording. Host denial/timeout refuses recording; revocation
ends capture immediately. The SDK session ending on authorizing-user departure
also ends capture. GLib handles admission/waiting room and delegates roster,
rename/leave, active-speaker and raw-audio callbacks. No chat messages are read.
The binding exposes 32/48 kHz options; this sidecar requests mono 32 kHz and
averages adjacent samples to 16 kHz. Other formats are refused. M4 must measure
quality and timing; no live audio fidelity is claimed by these unit tests.

Only mixed audio is connected to today's B2 core. Per-participant streams must
wait for S29's #2580 participant-key transport alignment; never concatenate
separate streams into a mixed timeline. Free-account M3/M4/M6 and credentials
verification are the owner's final live check. Nothing here selects the adapter
in a factory, changes a feature flag or enables live dispatch.

Reference: https://github.com/noah-duncan/py-zoom-meeting-sdk
