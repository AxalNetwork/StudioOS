"""D4557 part 2: one approved deterministic operation; no shell, eval or model transport."""
import base64
import csv
import ctypes
import hashlib
import io
import json
import math
import multiprocessing
import os
import resource
import signal
import select
import stat
import time
import zipfile
from defusedxml import ElementTree as xml
from pathlib import Path

MIB = 1024 * 1024
LIMITS = {
    "python": (60, 120, 512, 5 * MIB),
    "document_convert": (120, 300, 1024, 8 * MIB),
    "spreadsheet": (60, 120, 512, 8 * MIB),
}
INPUT_CAP = 8 * MIB
EXPANDED_CAP = 64 * MIB
ENTRY_CAP = 256
FAILURE_CODES = frozenset(json.loads(Path(__file__).with_name('failureCodes.ts').read_text().split('export default ', 1)[1].strip().removesuffix(';')))


def install_syscall_fence():
    """Linux x86-64 only: parser code gets no exec, new process, socket, ptrace or filesystem write."""
    class Filter(ctypes.Structure):
        _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte), ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]
    class Program(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ushort), ("filters", ctypes.POINTER(Filter))]
    deny = [41, 42, 43, 49, 50, 53, 56, 57, 58, 59, 76, 77, 82, 83, 84, 85, 86, 87, 88, 90, 91, 92, 93, 94,
            101, 105, 106, 117, 119, 126, 132, 133, 165, 166, 235, 258, 259, 260, 263, 264, 265, 266, 268, 272,
            248, 249, 250, 280, 288, 298, 304, 308, 310, 311, 316, 321, 322, 323, 425, 426, 427, 435, 437, 438, 440]
    rules = [(0x20, 0, 0, 4), (0x15, 1, 0, 0xC000003E), (0x06, 0, 0, 0x80000000), (0x20, 0, 0, 0)]
    rules.extend([(0x35, 0, 1, 0x40000000), (0x06, 0, 0, 0x80000000)])
    for syscall in deny:
        rules.extend([(0x15, 0, 1, syscall), (0x06, 0, 0, 0x00050001)])
    for syscall, offset in [(2, 24), (257, 32)]:
        rules.extend([(0x15, 0, 4, syscall), (0x20, 0, 0, offset),
                      (0x45, 0, 1, 3 | 64 | 512 | 1024 | 0x400000), (0x06, 0, 0, 0x00050001), (0x20, 0, 0, 0)])
    rules.append((0x06, 0, 0, 0x7FFF0000))
    array = (Filter * len(rules))(*(Filter(*rule) for rule in rules))
    program = Program(len(rules), array)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0 or libc.prctl(22, 2, ctypes.byref(program), 0, 0) != 0:
        raise Refused("process_policy")


class Refused(Exception):
    """Only this bounded code, never document content, leaves a failed job."""


def safe_name(value):
    import re
    return isinstance(value, str) and len(value) <= 120 and ".." not in value and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._()-]*", value))


def check_office(data):
    """Validate actual expanded bytes before any Office library opens the document."""
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > ENTRY_CAP:
            raise Refused("archive_entries")
        names = set()
        for entry in entries:
            parts = entry.filename.split("/")
            if (entry.filename in names or entry.filename.startswith("/") or "\\" in entry.filename
                    or any(part in (".", "..") for part in parts) or any("\x00" in part for part in parts)
                    or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1):
                raise Refused("archive_path")
            names.add(entry.filename)
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise Refused("archive_compression")
            if entry.file_size > EXPANDED_CAP or entry.file_size > max(1, entry.compress_size) * 100:
                raise Refused("archive_expansion")
            with archive.open(entry) as source:
                tail = b""
                while chunk := source.read(65536):
                    total += len(chunk)
                    if total > EXPANDED_CAP:
                        raise Refused("archive_expansion")
                    joined = (tail + chunk).replace(b"\x00", b"").upper()
                    if b"<!DOCTYPE" in joined or b"<!ENTITY" in joined:
                        raise Refused("xml_entities")
                    tail = chunk[-48:]
        if "[Content_Types].xml" not in names:
            raise Refused("office_format")


def decode_request(request):
    if not isinstance(request, dict) or set(request) != {"workload", "operation", "inputs"}:
        raise Refused("request_invalid")
    workload = request["workload"]
    operations = {"python": ["sum", "count"], "document_convert": ["extract"], "spreadsheet": ["extract", "sum", "count"]}
    if workload not in operations or request["operation"] not in operations[workload]:
        raise Refused("operation_refused")
    raw = request["inputs"]
    if not isinstance(raw, list) or not 1 <= len(raw) <= (3 if workload == "document_convert" else 5):
        raise Refused("inputs_invalid")
    files, size = {}, 0
    for item in raw:
        if not isinstance(item, dict) or set(item) != {"name", "data"} or not safe_name(item["name"]) or item["name"] in files:
            raise Refused("input_name")
        if not isinstance(item["data"], str) or len(item["data"]) > (INPUT_CAP + 2) // 3 * 4:
            raise Refused("input_size")
        try:
            data = base64.b64decode(item["data"], validate=True)
        except (ValueError, TypeError):
            raise Refused("input_encoding") from None
        size += len(data)
        if len(data) > INPUT_CAP or size > INPUT_CAP:
            raise Refused("input_size")
        suffix = item["name"].rsplit(".", 1)[-1].lower()
        allowed = {"python": ("json", "csv"), "document_convert": ("pdf", "docx", "xlsx", "pptx"), "spreadsheet": ("csv", "xlsx", "json")}
        if suffix not in allowed[workload]:
            raise Refused("input_type")
        if suffix in ("docx", "xlsx", "pptx"):
            check_office(data)
        files[item["name"]] = data
    return workload, request["operation"], files


def values(name, data):
    suffix = name.rsplit(".", 1)[-1].lower()
    if suffix == "json":
        return json.loads(data)
    if suffix == "csv":
        rows = []
        for row in csv.reader(io.StringIO(data.decode("utf-8-sig"))):
            if len(rows) >= 10000 or len(row) > 100:
                raise Refused("document_cells")
            rows.append(row)
        return rows
    if suffix == "xlsx":
        import openpyxl
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
        try:
            result, count = {}, 0
            if len(book.worksheets) > 32:
                raise Refused("document_cells")
            for sheet in book:
                rows = []
                for row in sheet.iter_rows(values_only=True):
                    count += len(row)
                    if count > 100000 or len(rows) >= 10000 or len(row) > 100:
                        raise Refused("document_cells")
                    rows.append([str(cell) if cell is not None else None for cell in row])
                result[sheet.title] = rows
            return result
        finally:
            book.close()
    if suffix == "pdf":
        from pypdf import PdfReader
        book = PdfReader(io.BytesIO(data), strict=True)
        if book.is_encrypted or len(book.pages) > 256:
            raise Refused("document_pages")
        return [page.extract_text()[:100000] for page in book.pages]
    if suffix == "docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            document = xml.fromstring(archive.read("word/document.xml"), forbid_dtd=True)
        paragraphs = [part for part in document.iter() if part.tag.rsplit("}", 1)[-1] == "p"]
        if len(paragraphs) > 10000:
            raise Refused("document_pages")
        return ["".join(part.text or "" for part in paragraph.iter() if part.tag.rsplit("}", 1)[-1] == "t") for paragraph in paragraphs]
    if suffix == "pptx":
        import re
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            slides = sorted((name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide[0-9]+\.xml", name)), key=lambda name: int(re.search(r"slide([0-9]+)\.xml", name).group(1)))
            if len(slides) > 256:
                raise Refused("document_pages")
            return [[part.text or "" for part in xml.fromstring(archive.read(name), forbid_dtd=True).iter() if part.tag.rsplit("}", 1)[-1] == "t"] for name in slides]
    raise Refused("input_type")


def numbers(value, depth=0):
    if depth > 32:
        raise Refused("document_depth")
    if isinstance(value, dict):
        return [number for child in value.values() for number in numbers(child, depth + 1)]
    if isinstance(value, list):
        return [number for child in value for number in numbers(child, depth + 1)]
    if isinstance(value, bool) or value is None:
        return []
    try:
        number = float(value)
    except (ValueError, TypeError):
        return []
    if not math.isfinite(number):
        raise Refused("number_invalid")
    return [number]


def execute(request):
    workload, operation, files = decode_request(request)
    parsed = {name: values(name, data) for name, data in files.items()}
    if operation in ("sum", "count"):
        amounts = numbers(parsed)
        parsed = {operation: math.fsum(amounts) if operation == "sum" else len(amounts)}
    output = json.dumps(parsed, allow_nan=False, ensure_ascii=True, separators=(",", ":")).encode()
    if len(output) > LIMITS[workload][3]:
        raise Refused("output_limit")
    return {"name": "result.json", "bytes": len(output), "sha256": hashlib.sha256(output).hexdigest(), "data": base64.b64encode(output).decode()}


def child(request, read_fd, write_fd, cpu_s, memory_mb):
    os.close(read_fd)
    # An untrusted parser must never write document content to container logs.
    null_fd = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null_fd, 1)
    os.dup2(null_fd, 2)
    os.close(null_fd)
    os.setsid()
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s))
    resource.setrlimit(resource.RLIMIT_AS, (memory_mb * MIB, memory_mb * MIB))
    resource.setrlimit(resource.RLIMIT_FSIZE, (INPUT_CAP, INPUT_CAP))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    try:
        install_syscall_fence()
        answer = {"ok": True, "artifact": execute(request)}
    except Exception as error:
        answer = {"ok": False, "code": str(error) if isinstance(error, Refused) else "operation_failed"}
    try:
        encoded = json.dumps(answer, separators=(",", ":")).encode()
        if len(encoded) > 12 * MIB:
            encoded = b'{"ok":false,"code":"output_limit"}'
        while encoded:
            written = os.write(write_fd, encoded)
            encoded = encoded[written:]
    finally:
        os.close(write_fd)
    os._exit(0 if answer.get('ok') is True else 1)


def run_job(request):
    workload = request.get("workload") if isinstance(request, dict) else None
    if workload not in LIMITS:
        return {"outcome": "failed", "failure_code": "workload_refused", "artifacts": [], "cpu_ms": 0, "wall_ms": 0, "peak_rss_bytes": 0, "exit_code": 1}
    cpu_s, wall_s, memory_mb, _ = LIMITS[workload]
    read_fd, write_fd = os.pipe()
    process = multiprocessing.get_context("fork").Process(target=child, args=(request, read_fd, write_fd, cpu_s, memory_mb))
    began = time.monotonic()
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    process.start()
    os.close(write_fd)
    answer = None
    try:
        chunks, total = [], 0
        while True:
            remaining = wall_s - (time.monotonic() - began)
            if remaining <= 0 or not select.select([read_fd], [], [], remaining)[0]:
                break
            chunk = os.read(read_fd, 65536)
            if not chunk:
                process.join(max(0, wall_s - (time.monotonic() - began)))
                if process.exitcode in (0, 1):
                    try:
                        decoded = json.loads(b"".join(chunks))
                        if isinstance(decoded, dict):
                            answer = decoded
                    except (ValueError, UnicodeError, RecursionError):
                        answer = None  # Malformed child output is a failed closed result.
                break
            total += len(chunk)
            if total > 12 * MIB:
                break
            chunks.append(chunk)
    finally:
        if process.is_alive():
            # Includes a child stuck after sending: no descendant survives this job.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                process.kill()
        process.join()
        os.close(read_fd)
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    elapsed = math.ceil((time.monotonic() - began) * 1000)
    ok = bool(answer and answer.get("ok") is True and process.exitcode == 0 and isinstance(answer.get("artifact"), dict))
    code = answer.get('code') if answer else None
    if code not in FAILURE_CODES:
        code = 'wall_limit' if elapsed >= wall_s * 1000 else 'resource_limit'
    return {"outcome": "succeeded" if ok else "timed_out" if elapsed >= wall_s * 1000 else "failed",
            "failure_code": None if ok else code,
            "artifacts": [answer["artifact"]] if ok else [], "cpu_ms": math.ceil((usage.ru_utime + usage.ru_stime - before.ru_utime - before.ru_stime) * 1000),
            "wall_ms": elapsed, "peak_rss_bytes": int(usage.ru_maxrss) * 1024, "exit_code": process.exitcode}
