"""D4557: hash-verified build inputs; compiler, package manager and temporary CA never reach the runtime."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import subprocess
import tarfile

source = Path(__file__).parent
lock = json.loads((source / "source-lock.json").read_text())
certificate = Path("/run/secrets/proxy_ca")
environment = dict(os.environ)
if certificate.exists():
    environment["PIP_CERT"] = str(certificate)
subprocess.run(["python", "-m", "pip", "install", "--no-cache-dir", "--only-binary=:all:", "--require-hashes", "-r", str(source / "requirements.txt")], env=environment, check=True)
if lock["zlib"]["url"] != "https://github.com/madler/zlib/releases/download/v1.4/zlib-1.4.tar.gz" or lock["zlib"]["version"] != "1.4":
    raise RuntimeError("zlib source URL is not the reviewed immutable release")
download = ["curl", "--fail", "--silent", "--show-error", "--location", "--max-redirs", "5",
            "--proto", "=https", "--proto-redir", "=https", "--max-time", "120", "--max-filesize", "5242880"]
if certificate.exists():
    download.extend(["--cacert", str(certificate)])
download.append("https://github.com/madler/zlib/releases/download/v1.4/zlib-1.4.tar.gz")
compressed = subprocess.run(download, check=True, stdout=subprocess.PIPE, timeout=125).stdout
if hashlib.sha256(compressed).hexdigest() != lock["zlib"]["sha256"]:
    raise RuntimeError("zlib source digest mismatch")
destination = Path(tempfile.mkdtemp(prefix="agent-compute-zlib-", dir="/tmp"))
expected_root = "zlib-" + lock["zlib"]["version"]
with tarfile.open(fileobj=io.BytesIO(compressed)) as archive:
    count, expanded = 0, 0
    for member in archive:
        name = PurePosixPath(member.name)
        count += 1; expanded += member.size
        if (count > 2000 or expanded > 64 * 1024 * 1024 or name.is_absolute() or not name.parts
                or name.parts[0] != expected_root or ".." in name.parts or "\\" in member.name):
            raise RuntimeError("zlib source archive refused")
        target = destination.joinpath(*name.parts)
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
        elif member.isfile():
            target.parent.mkdir(parents=True, exist_ok=True)
            stream = archive.extractfile(member)
            if stream is None: raise RuntimeError("zlib source file missing")
            with stream, target.open("xb") as output:
                shutil.copyfileobj(stream, output)
            target.chmod(member.mode & 0o755)
        else:
            raise RuntimeError("zlib source links and special files are refused")
directory = destination / expected_root
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
