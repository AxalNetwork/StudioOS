#!/usr/bin/env node
/** D5566: pinned Trivy SBOM/vulnerability evidence; no publish, account credentials or admission override. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
const scanner = 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08'; // 0.67.2
const env = { ...process.env }; for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
const image = process.env.WORKSPACE_IMAGE || 'studioos-workspace-s39:local';
if (!/^[a-z0-9][a-z0-9/_.:@-]{0,250}$/.test(image)) throw Error('Invalid image reference');
const out = resolve(process.env.WORKSPACE_SCAN_DIR || '/tmp/workspace-image-scan'); mkdirSync(out, { recursive: true });
const docker = args => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
try {
  const fd = openSync(out + '/image.tar', 'w', 0o600);
  try { execFileSync('docker', ['--host=unix:///var/run/docker.sock', 'image', 'save', image], { env, stdio: ['ignore', fd, 'pipe'] }); } finally { closeSync(fd); }
  docker(['pull', scanner]);
  const args = ['--host=unix:///var/run/docker.sock', 'run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=1g', '--cpus=1',
    '-v', out + ':/evidence', '-v', '/etc/ssl/certs:/etc/ssl/certs:ro', '-e', 'SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt'];
  // Keep Docker's configured reachable proxy defaults; the outer hostname need not resolve in an inner container.
  // The coding sandbox independently clears every proxy variable and has no network.
  const result = spawnSync('docker', [...args, scanner, '--cache-dir', '/tmp/trivy-cache', 'image', '--input', '/evidence/image.tar', '--scanners', 'vuln', '--db-repository', 'ghcr.io/aquasecurity/trivy-db:2', '--java-db-repository', 'ghcr.io/aquasecurity/trivy-java-db:1', '--format', 'json', '--output', '/evidence/vulnerabilities.json'], { env, stdio: 'inherit', timeout: 600000 });
  if (result.status !== 0) throw Error('Vulnerability inventory unavailable; image remains ineligible');
  docker(['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '-v', out + ':/evidence', scanner,
    'convert', '--format', 'cyclonedx', '--output', '/evidence/sbom.cdx.json', '/evidence/vulnerabilities.json']);
  const report = JSON.parse(readFileSync(out + '/vulnerabilities.json', 'utf8'));
  if (!Array.isArray(report.Results)) throw Error('Unreadable vulnerability inventory');
  const counts = Object.create(null);
  for (const row of report.Results) for (const finding of row.Vulnerabilities || []) counts[finding.Severity] = (counts[finding.Severity] || 0) + 1;
  const identity = JSON.parse(docker(['image', 'inspect', image]).toString())[0];
  const pass = !(counts.CRITICAL || counts.HIGH || counts.UNKNOWN);
  writeFileSync(out + '/provenance.json', JSON.stringify({ version: 1, image_id: identity.Id, scanner, counts, vulnerability_gate: pass ? 'pass' : 'deny',
    image_signature: 'not_published_or_attested', admission: 'disabled_pending_trusted_registry_and_hosted_proof' }, null, 2));
  console.log(JSON.stringify({ counts, vulnerability_gate: pass ? 'pass' : 'deny', admission: 'disabled' }));
  if (!pass) process.exitCode = 1;
} finally { rmSync(out + '/image.tar', { force: true }); }
