#!/bin/sh
# D8008 prepared probe: owner runs inside the exact verified JobContainer as UID 10000.
# Not an admission port, a canary substitute, an installer or a standalone host command.
set -eu
test "$(id -u):$(id -g)" = 10000:10000
test "$(uname -s):$(uname -m)" = Linux:x86_64
test "$HOME" = /work/home
for cmd in sh sleep mkdir cp chmod git npm; do command -v "$cmd" >/dev/null; done
test -x /usr/local/bin/node
test -x /usr/local/bin/python3
test -r /input-plan.json
test -d /input
test ! -e /var/run/docker.sock
# Absence probes supplement, never replace, host inspection of mounts/credentials.
test -z "${GH_TOKEN-}${GITHUB_TOKEN-}${ACTIONS_RUNTIME_TOKEN-}${ACTIONS_ID_TOKEN_REQUEST_TOKEN-}${ACTIONS_ID_TOKEN_REQUEST_URL-}"
mkdir -p /work/home /work/probe
printf ok > /work/probe/write
printf ok > /tmp/studioos-runtime-probe
if (printf denied > /etc/studioos-runtime-probe) 2>/dev/null; then
  echo 'FAIL: candidate can write /etc' >&2; exit 1
fi
if (printf denied > /input/.studioos-runtime-probe) 2>/dev/null; then
  echo 'FAIL: candidate can write /input' >&2; exit 1
fi
printf '#!/bin/sh\nexit 0\n' > /tmp/studioos-noexec-probe
chmod 700 /tmp/studioos-noexec-probe
if /tmp/studioos-noexec-probe 2>/dev/null; then
  echo 'FAIL: /tmp permits direct execution' >&2; exit 1
fi
printf '#!/bin/sh\nexit 0\n' > /work/probe/exec
chmod 700 /work/probe/exec
/work/probe/exec
/usr/local/bin/node --input-type=module - <<'JS'
import { DatabaseSync } from 'node:sqlite';
if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node !== '22.23.3') throw Error('native Node mismatch');
const db = new DatabaseSync(':memory:');
db.exec('CREATE VIRTUAL TABLE probe USING fts5(body)');
db.exec("INSERT INTO probe VALUES ('runtime')");
if (db.prepare("SELECT count(*) AS n FROM probe WHERE probe MATCH 'runtime'").get().n !== 1) throw Error('FTS5 missing');
if (db.prepare("SELECT json_valid('{}') AS n").get().n !== 1) throw Error('JSON missing');
console.log(JSON.stringify({node: process.versions.node, sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, arch:process.arch}));
db.close();
JS
/usr/local/bin/python3 - <<'PY'
import platform, ssl, sqlite3, hashlib, bz2, lzma, ctypes, zlib, locale, zoneinfo
assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
assert platform.python_version() == '3.11.18'
assert ssl.create_default_context().get_ca_certs(), 'CA trust missing'
assert locale.setlocale(locale.LC_CTYPE, 'C.UTF-8')
assert zoneinfo.ZoneInfo('UTC')
assert sqlite3.connect(':memory:').execute("select json_valid('{}')").fetchone()[0] == 1
print('python=' + platform.python_version() + ' openssl=' + ssl.OPENSSL_VERSION + ' sqlite=' + sqlite3.sqlite_version)
PY
git --version
npm --version
rm /tmp/studioos-runtime-probe /tmp/studioos-noexec-probe
rm -r /work/probe
echo 'Native probe passed; build/scan/signature/host boundary/shard gates remain separate.'
