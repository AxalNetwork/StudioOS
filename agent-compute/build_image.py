"""D4557: hash-verified build inputs; compiler, package manager and temporary CA never reach the runtime."""
import hashlib
import io
import json
import os
from pathlib import Path
import ssl
import subprocess
import tarfile
import urllib.request

source = Path(__file__).parent
lock = json.loads((source / "source-lock.json").read_text())
certificate = Path("/run/secrets/proxy_ca")
environment = dict(os.environ)
if certificate.exists():
    environment["PIP_CERT"] = str(certificate)
subprocess.run(["python", "-m", "pip", "install", "--no-cache-dir", "--only-binary=:all:", "--require-hashes", "-r", str(source / "requirements.txt")], env=environment, check=True)
context = ssl.create_default_context(cafile=str(certificate) if certificate.exists() else None)
with urllib.request.urlopen(lock["zlib"]["url"], context=context) as response:
    compressed = response.read(5 * 1024 * 1024)
if hashlib.sha256(compressed).hexdigest() != lock["zlib"]["sha256"]:
    raise RuntimeError("zlib source digest mismatch")
with tarfile.open(fileobj=io.BytesIO(compressed)) as archive:
    archive.extractall("/tmp/zlib-source", filter="data")
directory = Path("/tmp/zlib-source") / ("zlib-" + lock["zlib"]["version"])
subprocess.run(["./configure", "--prefix=/usr/local"], cwd=directory, check=True)
subprocess.run(["make", "-j2"], cwd=directory, check=True)
subprocess.run(["make", "install"], cwd=directory, check=True)
environment["LD_LIBRARY_PATH"] = "/usr/local/lib"
subprocess.run(["python", str(source / "build_runtime.py"), "/runtime"], env=environment, check=True)
manifest = Path("/runtime/usr/share/agent-compute")
manifest.mkdir(parents=True)
(manifest / "source-lock.json").write_text(json.dumps(lock, indent=2))
license_text = directory / "LICENSE"
if not license_text.exists():
    license_text = directory / "README"
(manifest / "zlib-license.txt").write_bytes(license_text.read_bytes())
