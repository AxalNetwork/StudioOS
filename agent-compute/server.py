"""D4557: private VM port, exactly one request before the host destroys the VM."""
import http.server
import json
import base64
import time
from runner import run_job

spent = False


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, value):
        data = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404, {"ready": self.path == "/health"})

    def do_POST(self):
        global spent
        if self.path != "/run":
            return self.reply(404, {"code": "not_found"})
        # Signature, scope, generation and nonce were redeemed by the owning
        # Worker before this private VM port is reached. This is execution
        # context, never an independent grant issuer or a callback credential.
        grant = self.headers.get("X-Compute-Grant", "")
        try:
            if not 1 <= len(grant) <= 4096:
                raise ValueError()
            payload, signature = grant.split(".")
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * ((4 - len(payload) % 4) % 4)))
            if claims.get("aud") != "executor.bootstrap" or claims.get("exp", 0) <= time.time() * 1000 or not signature:
                raise ValueError()
        except (ValueError, TypeError, UnicodeError):
            return self.reply(403, {"code": "grant_context_invalid"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= 12 * 1024 * 1024:
            return self.reply(413, {"code": "input_size"})
        if spent:
            return self.reply(409, {"code": "already_used"})
        spent = True
        try:
            request = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeError):
            return self.reply(400, {"code": "request_invalid"})
        try:
            self.reply(200, run_job(request))
        except Exception:
            self.reply(500, {"code": "runtime_failed"})


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", 8080), Handler)
    server.serve_forever()
