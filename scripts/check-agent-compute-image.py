"""D4557: local-only immutable image build, isolation tests, scan, SBOM and synthetic profile measurements."""
import argparse
import json
from pathlib import Path
import subprocess
import time


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='studioos-agent-compute:local')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--trivy', default='trivy')
    parser.add_argument('--ca-file', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    build = ['docker', 'build', '--platform', 'linux/amd64', '-t', args.image, '-f', str(root / 'agent-compute/Dockerfile')]
    if args.ca_file: build += ['--secret', 'id=proxy_ca,src=' + str(args.ca_file.resolve())]
    run(build + [str(root / 'agent-compute')])
    inspect = json.loads(subprocess.check_output(['docker', 'image', 'inspect', args.image]))[0]
    image_id = inspect['Id']  # Local configuration ID; NOT a registry's deployable OCI manifest digest.
    common = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '16']
    run(common + ['--memory', '1g', '--cpus', '.25', '--mount', 'type=bind,src=' + str(root / 'agent-compute/test_runner.py') + ',dst=/tests/test_runner.py,readonly',
                  '--env', 'PYTHONPATH=/app', image_id, 'python', '/tests/test_runner.py'])
    scan = [args.trivy, 'image', '--db-repository', 'ghcr.io/aquasecurity/trivy-db:2', '--scanners', 'vuln']
    run(scan + ['--severity', 'HIGH,CRITICAL', '--exit-code', '1', '--format', 'json', '--output', str(output / 'scan.json'), image_id])
    scanned = json.loads((output / 'scan.json').read_text())
    if scanned.get('Metadata', {}).get('OS', {}).get('Family') != 'debian':
        raise RuntimeError('Runtime OS was not recognized; refusing an incomplete scan')
    run(scan + ['--format', 'cyclonedx', '--output', str(output / 'sbom.json'), image_id])
    sbom = json.loads((output / 'sbom.json').read_text())
    lock = json.loads((root / 'agent-compute/source-lock.json').read_text())
    sbom.setdefault('components', []).extend([
        {'type': 'application', 'name': 'CPython', 'version': lock['python']['version'], 'purl': 'pkg:generic/cpython@' + lock['python']['version'],
         'properties': [{'name': 'build:immutable-builder', 'value': lock['python']['builder']}]},
        {'type': 'library', 'name': 'zlib', 'version': lock['zlib']['version'], 'purl': 'pkg:generic/zlib@' + lock['zlib']['version'],
         'hashes': [{'alg': 'SHA-256', 'content': lock['zlib']['sha256']}], 'externalReferences': [{'type': 'distribution', 'url': lock['zlib']['url']}]},
    ])
    (output / 'sbom.json').write_text(json.dumps(sbom, indent=2) + '\n')
    # A deny-network synthetic calculation. This measures local process/container startup;
    # no Cloudflare cold-start, throughput, residency or invoice estimate is inferred.
    command = "import json;from runner import run_job;print(json.dumps(run_job({'workload':'python','operation':'sum','inputs':[{'name':'values.json','data':'WzEsMiwzXQ=='}]})))"
    samples = []
    for cpu, memory in [('.25', '512m'), ('.5', '1g')]:
        for _ in range(3):
            start = time.monotonic()
            result = json.loads(subprocess.check_output(common + ['--cpus', cpu, '--memory', memory, image_id, 'python', '-c', command]))
            if result['outcome'] != 'succeeded': raise RuntimeError('Profile calculation failed')
            samples.append({'cpu_limit': cpu, 'memory_limit': memory, 'local_container_wall_ms': round((time.monotonic() - start) * 1000),
                            **{key: result[key] for key in ['cpu_ms', 'wall_ms', 'peak_rss_bytes']}})
    (output / 'evidence.json').write_text(json.dumps({'local_image_id': image_id, 'image_bytes': inspect['Size'], 'source_lock': lock,
        'synthetic_local_only': True, 'hosted_preview': 'pending owner gate', 'cost': None, 'samples': samples}, indent=2) + '\n')


if __name__ == '__main__': main()
