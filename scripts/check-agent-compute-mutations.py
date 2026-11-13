"""D4557: mutation journeys in an isolated source copy, never editing a live test tree."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

TS = [
 ('.github/workflows/agent-compute-image.yml', 'contents: read', 'contents: read\n  packages: write', 'general compute deploys'),
 ('.github/workflows/agent-compute-image.yml', '--dry-run --containers-rollout none', '--containers-rollout none', 'general compute deploys'),
 ('.github/workflows/agent-compute-preview.yml', "github.ref == 'refs/heads/main'", 'true', 'general compute deploys'),
 ('.github/workflows/agent-compute-preview.yml', 'environment: agent-compute-preview', 'environment: unprotected-compute-preview', 'general compute deploys'),
 ('.github/workflows/agent-compute-preview.yml', 'needs: gate', 'needs: []', 'general compute deploys'),
 ('.github/workflows/agent-compute-preview.yml', '--source-digest "$GITHUB_SHA"', '', 'general compute deploys'),
 ('.github/workflows/agent-compute-preview.yml', '--signer-workflow "$IMAGE_SIGNER_WORKFLOW"', '', 'general compute deploys'),
 ('.github/workflows/agent-compute-preview.yml', "get('prevent_self_review') is True", "get('prevent_self_review') is False", 'general compute deploys'),
 ('wrangler.agent-compute.toml', 'COMPUTE_ENABLED = "off"', 'COMPUTE_ENABLED = "on"', 'general compute deploys'),
 ('cloudflare-worker/sql/migrations/202611122121_4557_compute_host.sql', 'request_uid TEXT REFERENCES agent_compute_requests(uid) ON DELETE SET NULL', 'request_uid TEXT REFERENCES agent_compute_requests(uid) ON DELETE CASCADE', 'request erasure preserves'),
 ('cloudflare-worker/src/routes/agent_compute.ts', 'AND o.owner_user_id = ?', 'AND ? IS NOT NULL', 'artifact delivery'),
 ('cloudflare-worker/src/routes/agent_compute.ts', "(scope.kind === 'company' ? scope.id : scope.company_id) !== spec.company_id", 'false', 'artifact delivery'),
 ('cloudflare-worker/src/routes/agent_compute.ts', 'if (error instanceof Error && AUTH_ERROR_STATUSES[error.message]) throw error;', 'void error;', 'every signed-in route refuses'),
 ('cloudflare-worker/src/services/agents/computeBridge.ts', 'WHERE e.request_uid = r.uid AND a.sponsor_user_id = ?1)', 'WHERE e.request_uid = r.uid AND a.sponsor_user_id = ?1 AND 0)', 'after a sponsor change'),
 ('cloudflare-worker/src/agents/engine.ts', 'NOT EXISTS(SELECT 1 FROM agent_compute_requests WHERE task_id = ?)', 'EXISTS(SELECT 1 FROM agent_compute_requests WHERE task_id = ?)', 'created between'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', "spec.value.allowed_regions[0] !== 'global'", 'false', 'cross-scope'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', "spec.value.network_policy.mode !== 'deny'", 'false', 'cross-scope'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'spec.value.artifact_sink_ref !== value.job_uid', 'false', 'cross-scope'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'spec.value.idempotency_key !== value.job_uid', 'false', 'cross-scope'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'sponsor.tenant_id !== spec.value.tenant_id', 'false', 'cross-scope'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'digest !== artifact.sha256', 'false', 'artifact bytes'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'decoded.byteLength !== artifact.bytes', 'false', 'artifact bytes'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'names.has(artifact.name)', 'false', 'artifact bytes'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'result.peak_rss_bytes > limits.memory_mb * 1024 * 1024', 'false', 'artifact bytes'),
 ('cloudflare-worker/src/services/agents/computeHost.ts', 'if (size > cap)', 'if (false)', 'dishonest'),
 ('agent-compute/host.ts', 'current.boot_attempted = true', 'current.boot_attempted = false', 'failed stop'),
 ('agent-compute/host.ts', "row.state = timedOut ? 'timed_out' : 'cancelled'", "row.state = 'running'", 'cancellation kills|deadline alarms'),
 ('agent-compute/host.ts', 'if (selected.duplicate)', 'if (false)', 'failed stop'),
 ('agent-compute/host.ts', "await deps.broker.complete(row, result, token.value.token)", 'void result', 'dispatch persists'),
 ('agent-compute/vm.ts', 'enableInternet: false', 'enableInternet: true', 'default scheduling'),
 ('agent-compute/vm.ts', '!imageMatches(observed.image)', 'false', 'empty or different'),
 ('agent-compute/vm.ts', "profile.schedulingPolicy === 'durable_object'", 'true', 'newer policy'),
 ('agent-compute/vm.ts', 'if (await control.inspect() !== null)', 'if (false)', 'readiness has'),
 ('agent-compute/worker.ts', "await storage.put('forgotten', true)", "await storage.put('forgotten', false)", 'erasure retains'),
 ('agent-compute/worker.ts', "await storage.delete(['host', 'security'])", 'void storage', 'erasure retains'),
 ('agent-compute/worker.ts', "if (this.ctx.container && await this.ctx.container.inspect() !== null)", 'if (false)', 'observed survivor'),
 ('agent-compute/worker.ts', 'row.cleanup_required = true; await storage.put', 'row.cleanup_required = false; await storage.put', 'terminal record'),
 ('cloudflare-worker/src/services/agents/compute.ts', "WHERE j.status IN ('queued', 'dispatched', 'running') OR e.cleanup_required = 1) < 4", "WHERE j.status IN ('queued', 'dispatched', 'running') OR e.cleanup_required = 1) < 40", 'global SQL quota'),
 ('cloudflare-worker/src/services/agents/computeBridge.ts', "if (forgotten.cleanup_required)", 'if (true)', 'erasure confirms'),
 ('cloudflare-worker/src/services/agents/computeBridge.ts', 'if (!computeConfigured(env))', 'if (false)', 'disabling compute'),
]
PYTHON = [
 ('forbid_dtd=True', 'forbid_dtd=False', 'test_independent_xml_parser'),
 ('".." not in value', 'True', 'test_names'),
 ('request["operation"] not in operations[workload]', 'False', 'test_names'),
 ('or size > INPUT_CAP', 'or False', 'test_names'),
 ('if (entry.filename in names', 'if (False', 'test_archive_paths'),
 ('if len(entries) > ENTRY_CAP:', 'if False:', 'test_archive_expansion'),
 ('if entry.file_size > EXPANDED_CAP or entry.file_size > max(1, entry.compress_size) * 100:', 'if False:', 'test_archive_expansion'),
 ('if b"<!DOCTYPE" in joined or b"<!ENTITY" in joined:', 'if False:', 'test_archive_expansion'),
 ('if b"<!DOCTYPE" in joined or b"<!ENTITY" in joined:', 'if entry.filename.lower().endswith((".xml", ".rels")) and (b"<!DOCTYPE" in joined or b"<!ENTITY" in joined):', 'test_archive_expansion'),
 ('if len(output) > LIMITS[workload][3]:', 'if False:', 'test_output'),
 ('if depth > 32:', 'if False:', 'test_output'),
 ('if not math.isfinite(number):', 'if False:', 'test_output'),
 ('        install_syscall_fence()', '        pass', 'test_parser'),
 ('resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s))', 'resource.setrlimit(resource.RLIMIT_CPU, (20, 20))', 'test_cpu'),
 ('resource.setrlimit(resource.RLIMIT_AS, (memory_mb * MIB, memory_mb * MIB))', 'pass', 'test_cpu'),
]
SERVER = [
 ('if spent:', 'if False:', 'test_private_http'),
 ('claims.get("aud") != "executor.bootstrap"', 'False', 'test_private_http'),
 ('claims.get("exp", 0) <= time.time() * 1000', 'False', 'test_private_http'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--match', default='', help='Run mutations whose test name includes this text; controls still run in full')
    args = parser.parse_args()
    if not any(args.match in case[-1] for case in TS + PYTHON + SERVER):
        parser.error('No mutation matches the requested test name')
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='compute-mutations-4557-') as directory:
        copy = Path(directory); copy.chmod(0o755)
        for name in ['cloudflare-worker/src', 'cloudflare-worker/test', 'cloudflare-worker/sql', 'agent-compute', '.github/workflows']:
            shutil.copytree(root / name, copy / name, ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
        for name in ['scripts', 'frontend', 'meeting-bot', 'cloudflare-worker/node_modules', 'cloudflare-worker/ai-workers', 'infra']:
            (copy / name).symlink_to((root / name).resolve(), target_is_directory=True)
        for name in ['wrangler.toml', 'wrangler.agent-compute.toml', 'package.json', 'cloudflare-worker/package.json']:
            shutil.copy2(root / name, copy / name)
        # Schema fixtures need an isolated cache: a killed mutant must not leave
        # a lock in another worktree's shared dependency cache.
        dependencies = copy / 'node_modules'; dependencies.mkdir()
        for dependency in (root / 'node_modules').iterdir():
            if dependency.name != '.cache':
                (dependencies / dependency.name).symlink_to(dependency.resolve(), target_is_directory=dependency.is_dir())
        tests = sorted(str(path.relative_to(copy)) for path in (copy / 'cloudflare-worker/test').glob('compute_*4557.test.ts')) + ['cloudflare-worker/test/authz_sweep_d4570.test.ts', 'cloudflare-worker/test/topology_d209.test.ts']
        command = [args.node, '--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs', '--test', '--test-concurrency=2']
        def run_ts(pattern=None):
            result = subprocess.run(command + (['--test-name-pattern', pattern] if pattern else []) + tests, cwd=copy, capture_output=True, text=True, timeout=180)
            return result.returncode, result.stdout + result.stderr
        code, log = run_ts()
        if code: raise RuntimeError('Unmutated Worker controls failed:\n' + log[:2000] + '\n...\n' + log[-12000:])
        for path, old, new, pattern in TS:
            if args.match not in pattern: continue
            source = copy / path; original = source.read_text()
            if old not in original: raise RuntimeError('Stale mutation: ' + old)
            try:
                source.write_text(original.replace(old, new))
                code, log = run_ts(pattern)
                if not code or 'not ok' not in log or 'SyntaxError' in log: raise RuntimeError('Mutation was not killed by an assertion: ' + old + '\n' + log[-2000:])
                print('KILLED Worker:', old, flush=True)
            finally: source.write_text(original)
        for name, cases in [('runner.py', PYTHON), ('server.py', SERVER)]:
            source = copy / 'agent-compute' / name; original = source.read_text(); source.chmod(0o644)
            for old, new, pattern in cases:
                if args.match not in pattern: continue
                if old not in original: raise RuntimeError('Stale image mutation: ' + old)
                try:
                    source.write_text(original.replace(old, new))
                    command_image = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '1g', '--cpus', '.25', '--pids-limit', '16',
                        '--mount', 'type=bind,src=' + str(source) + ',dst=/app/' + name + ',readonly', '--mount', 'type=bind,src=' + str(root / 'agent-compute/test_runner.py') + ',dst=/tests/test_runner.py,readonly',
                        '--env', 'PYTHONPATH=/app', args.image, 'python', '/tests/test_runner.py', '-k', pattern]
                    result = subprocess.run(command_image, capture_output=True, text=True, timeout=30)
                    log = result.stdout + result.stderr
                    if result.returncode == 0 or 'FAIL:' not in log: raise RuntimeError('Image mutation not killed by an assertion: ' + old + '\n' + log[-2000:])
                    print('KILLED image:', old, flush=True)
                finally: source.write_text(original)
        code, log = run_ts()
        if code: raise RuntimeError('Restored controls failed:\n' + log[-5000:])
        print('Restored Worker controls pass; image controls separately pass in image acceptance.', flush=True)


if __name__ == '__main__': main()
