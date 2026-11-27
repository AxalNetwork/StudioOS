"""D4557: assemble actual Python/ELF dependencies, retaining package metadata for everything copied."""
from pathlib import Path
import re
import shutil
import subprocess
import sys

root = Path(sys.argv[1])
lib = root / "usr/local/lib"
shutil.copytree("/usr/local/lib/python3.12", lib / "python3.12", symlinks=True)
for pattern in ["lib-dynload/_ssl*", "lib-dynload/_hashlib*", "lib-dynload/_sqlite3*", "lib-dynload/_curses*",
                "lib-dynload/_bz2*", "lib-dynload/_lzma*", "lib-dynload/_dbm*", "lib-dynload/_gdbm*", "lib-dynload/readline*",
                "lib-dynload/_uuid*", "lib-dynload/nis*", "lib-dynload/_tkinter*", "lib-dynload/_test*", "ensurepip",
                "test", "idlelib", "tkinter", "site-packages/pip", "site-packages/pip-*.dist-info"]:
    for path in (lib / "python3.12").glob(pattern):
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
for cache in root.rglob("__pycache__"):
    shutil.rmtree(cache)
(root / "usr/local/bin").mkdir(parents=True)
shutil.copy2("/usr/local/bin/python3.12", root / "usr/local/bin/python3.12")
(root / "usr/local/bin/python").symlink_to("python3.12")
packages = set()


def copy_dependency(source):
    source = Path(source)
    destination = root / source.relative_to("/")
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source.resolve(), destination)
    for candidate in [str(source), str(source.resolve())]:
        owner = subprocess.run(["dpkg-query", "-S", candidate], capture_output=True, text=True)
        if owner.returncode == 0:
            match = re.search(r"^([a-z0-9+.-]+(?::[a-z0-9+.-]+)?): ", owner.stdout, flags=re.M)
            if match:
                packages.add(match.group(1))
                break
    else:
        if not str(source).startswith('/usr/local/'):
            raise RuntimeError('No package provenance for runtime dependency: ' + str(source))


queue = [path for path in root.rglob("*") if path.is_file() and path.open("rb").read(4) == b"\x7fELF"]
visited = set()
while queue:
    copied = queue.pop()
    original = Path("/") / copied.relative_to(root)
    if original in visited:
        continue
    visited.add(original)
    # Native wheels are not used: only the pinned CPython and built zlib supply ELF files.
    linked = subprocess.run(["ldd", str(original)], capture_output=True, text=True)
    if "not found" in linked.stdout:
        raise RuntimeError("Unresolved runtime dependency")
    for dependency in re.findall(r"(?:=>\s+|^\s*)(/[^\s]+)", linked.stdout, flags=re.M):
        copy_dependency(dependency)
        target = root / Path(dependency).relative_to("/")
        if Path(dependency) not in visited:
            queue.append(target)

# Explicit upstream components have no Debian package owner. They are listed
# separately in the image SBOM, with the Dockerfile's immutable source hashes.
status = root / "var/lib/dpkg/status"
status.parent.mkdir(parents=True)
status.write_text("\n\n".join(subprocess.check_output(["dpkg-query", "-s", package], text=True).strip() for package in sorted(packages)) + "\n")
(root / "etc").mkdir()
shutil.copy2("/etc/os-release", root / "etc/os-release")
(root / "etc/passwd").write_text("compute:x:10001:10001:Compute:/nonexistent:/nonexistent\n")
(root / "etc/group").write_text("compute:x:10001:\n")
for package in packages:
    name = package.split(":")[0]
    copyright_file = Path("/usr/share/doc") / name / "copyright"
    if copyright_file.exists():
        target = root / "usr/share/doc" / name / "copyright"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(copyright_file, target)
print("Runtime Debian packages:", ", ".join(sorted(packages)))
