#!/bin/bash
# D7885 (#7885): verified, organization-scoped runner preparation; enrollment is a separate privileged operator action.
set +x
set -euo pipefail
bootstrap_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec /usr/bin/python3 -I - "$bootstrap_dir" "$@" <<'PY'
# PYTHON_BEGIN
import argparse
import base64
import datetime as dt
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import pwd
import re
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid

REPOSITORY = 'AxalNetwork/StudioOS'
ORGANIZATION = 'AxalNetwork'
EXECUTOR_PATH = '.github/workflows/runner-executor.yml'
USERS = ('studioos-runner', 'studioos-job')
PRIVILEGED_GROUPS = {'root', 'wheel', 'admin', 'sudo', 'docker', 'lxd', 'disk', 'shadow', 'adm', 'systemd-journal', '_developer', 'procmod'}

class Refusal(Exception):
    pass

def require(condition, message):
    if not condition:
        raise Refusal(message)

def json_file(path):
    require(path.stat().st_size <= 65536, 'configuration_too_large')
    return json.loads(path.read_text())

def trusted_file(path, private=False):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'operator_file_must_be_root_owned_and_not_writable_by_jobs')
    require(not private or not info.st_mode & 0o077, 'private_operator_file_mode_0600_required')
    for parent in path.resolve().parents:
        entry = parent.stat()
        require(entry.st_uid == 0 and not entry.st_mode & 0o022, 'operator_file_parent_must_not_be_job_writable')

def load_registry(path):
    data = json_file(path)
    require(data.get('schema_version') == 1 and data.get('repository') == REPOSITORY and data.get('organization') == ORGANIZATION, 'unsupported_registry')
    require(set(data['profiles']) == {'linux-x64', 'macos-arm64', 'hosted'}, 'unsupported_profile_set')
    require(data.get('self_hosted_group_id') is None or (type(data.get('self_hosted_group_id')) is int and data['self_hosted_group_id'] > 0), 'invalid_group_id')
    require(data.get('processes_per_machine') == 1 and data.get('shared_capability') == 'studioos-worker-v1', 'unsupported_capacity_contract')
    require(re.fullmatch(r'[A-Za-z0-9 -]{1,64}', data.get('self_hosted_group', '')), 'invalid_group')
    for name, p in data['profiles'].items():
        if name == 'hosted':
            require(p == {'pool': 'github-hosted', 'runs_on': 'ubuntu-latest', 'github_os': 'Linux', 'github_arch': 'X64'}, 'hosted_pool_must_remain_separate')
            continue
        expected = ('Linux', 'x86_64', 'Linux', 'X64', 'x64') if name == 'linux-x64' else ('Darwin', 'arm64', 'macOS', 'ARM64', 'arm64')
        require(tuple(p.get(k) for k in ['system', 'machine', 'github_os', 'github_arch', 'node_arch']) == expected, 'invalid_platform_contract')
        require(p.get('pool') == 'self-hosted' and p['labels'] == ['self-hosted', expected[2], expected[3], 'studioos-worker-v1'], 'invalid_capability_labels')
        require(set(p['artifacts']) == {'runner', 'node', 'python'}, 'invalid_artifacts')
        for name_, artifact in p['artifacts'].items():
            require(re.fullmatch(r'[a-f0-9]{64}', artifact['sha256']), 'archive_digest_required')
            prefix = {'runner': f'https://github.com/actions/runner/releases/download/v{p["runner_version"]}/', 'node': f'https://nodejs.org/dist/v{p["node_version"]}/', 'python': 'https://github.com/astral-sh/python-build-standalone/releases/download/'}[name_]
            require(artifact['url'].startswith(prefix) and artifact['url'].endswith('.tar.gz'), 'unreviewed_archive_origin')
            require(artifact['directory'] == '.' or re.fullmatch(r'[A-Za-z0-9._-]+', artifact['directory']), 'invalid_archive_directory')
    return data

def select_profile(registry, name, system=None, machine=None):
    require(name in registry['profiles'], 'unsupported_profile')
    p = registry['profiles'][name]
    require(p['pool'] == 'self-hosted', 'hosted_profile_is_not_a_registration_target')
    require((system or platform.system(), machine or platform.machine()) == (p['system'], p['machine']), 'profile_does_not_match_native_os_and_architecture')
    return p

def command(args, *, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env if env is not None else {'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C.UTF-8'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    require(result.returncode == 0, 'host_command_failed')
    return result.stdout.strip()

def clean_env(home, tools):
    # No GH/App/provider/registration environment enters the service or job path.
    return {'HOME': str(home), 'PATH': str(tools / 'node/bin') + ':' + str(tools / 'python/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8'}

def capacity():
    cpu = len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else (os.cpu_count() or 1)
    if platform.system() == 'Darwin':
        memory = int(command(['/usr/sbin/sysctl', '-n', 'hw.memsize']))
    else:
        memory = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
        try:
            quota, period = Path('/sys/fs/cgroup/cpu.max').read_text().split()
            if quota != 'max': cpu = min(cpu, int(quota) / int(period))
            limit = Path('/sys/fs/cgroup/memory.max').read_text().strip()
            if limit != 'max': memory = min(memory, int(limit))
        except (OSError, ValueError): pass
    return {'cpu_effective': cpu, 'memory_bytes': memory}

def verify_tools(profile, root, run=command):
    if profile['system'] == 'Darwin':
        require(run(['/usr/sbin/sysctl', '-n', 'hw.optional.arm64']) == '1', 'native_arm64_required')
        translated = subprocess.run(['/usr/sbin/sysctl', '-in', 'sysctl.proc_translated'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        require(translated.stdout.strip() != '1', 'rosetta_is_not_supported')
    node = root / 'tools/node/bin/node'
    python = root / 'tools/python/bin/python3'
    values = json.loads(run([str(node), '--no-warnings', '--input-type=module', '-e', "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(':memory:');d.exec('CREATE VIRTUAL TABLE f USING fts5(t)');console.log(JSON.stringify({version:process.versions.node,arch:process.arch,sqlite:d.prepare('select sqlite_version() v').get().v,json:d.prepare(\"select json_valid('{}') v\").get().v}));d.close();"]))
    require(values['version'] == profile['node_version'] and values['arch'] == profile['node_arch'] and values['json'] == 1, 'pinned_node_native_architecture_and_sqlite_required')
    py = json.loads(run([str(python), '-I', '-c', "import json,platform;print(json.dumps({'version':platform.python_version(),'machine':platform.machine()}))"]))
    require(py == {'version': profile['python_version'], 'machine': profile['machine']}, 'pinned_native_python_required')
    runner_args = [str(root / 'listener/runner/bin/Runner.Listener'), '--version']
    observed_runner = listener_command(root,runner_args) if run is command and os.geteuid() == 0 else run(runner_args)
    require(observed_runner == profile['runner_version'], 'pinned_runner_required')
    git = run(['/usr/bin/git', '--version'])
    match = re.search(r'\b(\d+)\.(\d+)\.(\d+)', git)
    require(match and (2, 39, 0) <= tuple(map(int, match.groups())) < (3, 0, 0), 'supported_git_2_39_or_later_required')
    return {'node_version': values['version'], 'node_arch': values['arch'], 'python_version': py['version'], 'sqlite_version': values['sqlite'], 'runner_version': profile['runner_version'], 'git_version': match.group(0)}

def safe_extract(archive, destination):
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            target = (destination / member.name).resolve()
            require(target.is_relative_to(destination.resolve()) and not Path(member.name).is_absolute(), 'unsafe_archive_path')
            require(member.isfile() or member.isdir() or member.issym() or member.islnk(), 'unsafe_archive_member')
            if member.issym() or member.islnk():
                link = (target.parent if member.issym() else destination) / member.linkname
                require(not Path(member.linkname).is_absolute() and link.resolve().is_relative_to(destination.resolve()), 'unsafe_archive_link')
            member.mode &= 0o777
            # Root-owned private staging; ownership is explicitly assigned after extraction.
            member.uid = member.gid = 0
            member.uname = member.gname = ''
            source.extract(member, destination, set_attrs=True)

def verified_download(artifact, destination, fetch=None):
    fetch = fetch or (lambda url: urllib.request.urlopen(url, timeout=60))
    digest = hashlib.sha256()
    with fetch(artifact['url']) as response, destination.open('xb') as output:
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk: break
            total += len(chunk)
            require(total <= 1024 * 1024 * 1024, 'archive_too_large')
            digest.update(chunk); output.write(chunk)
    if digest.hexdigest() != artifact['sha256']:
        destination.unlink(missing_ok=True)
        raise Refusal('archive_digest_mismatch')

def validate_accounts(listener, job):
    require(listener.pw_uid != 0 and job.pw_uid != 0 and listener.pw_uid != job.pw_uid and listener.pw_gid != job.pw_gid, 'separate_non_root_listener_and_job_accounts_required')
    for account in [listener, job]:
        groups = {grp.getgrgid(g).gr_name for g in os.getgrouplist(account.pw_name, account.pw_gid)}
        require(not groups.intersection(PRIVILEGED_GROUPS), 'runner_accounts_must_not_have_privileged_groups')
    require(listener.pw_gid not in os.getgrouplist(job.pw_name, job.pw_gid), 'job_account_must_not_read_listener_group')

def accounts(root):
    for name, home in zip(USERS, [root / 'listener', root / 'jobs']):
        try: pwd.getpwnam(name)
        except KeyError:
            require(platform.system() == 'Linux', 'mac_accounts_require_operator_preparation')
            command(['/usr/sbin/useradd', '--system', '--user-group', '--no-create-home', '--home-dir', str(home), '--shell', '/usr/sbin/nologin', name])
    listener, job = (pwd.getpwnam(name) for name in USERS)
    validate_accounts(listener, job)
    require(grp.getgrgid(listener.pw_gid).gr_name == USERS[0] and grp.getgrgid(job.pw_gid).gr_name == USERS[1], 'matching_dedicated_account_groups_required')
    require(Path(listener.pw_dir).resolve() == (root/'listener').resolve() and Path(job.pw_dir).resolve() == (root/'jobs').resolve(), 'existing_accounts_belong_to_another_installation_drain_and_recover_first')
    return listener, job

def timestamp(text):
    require(isinstance(text, str) and text.endswith('Z'), 'utc_timestamp_required')
    try: return dt.datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()
    except ValueError: raise Refusal('invalid_timestamp')

def approval(data, registry, state, now=None, *, enrollment=True):
    now = time.time() if now is None else now
    allowed = {'schema_version','observed_at','runner_identity','repository','organization','group_name','group_id','visibility','selected_repositories','allows_public_repositories','restricted_to_workflows','selected_workflows','executor_revision','executor_file_sha256','job_isolation_verified','host_inventory_checked','drained','pilot_expires_at','budget_reference','provider_teardown_scheduled','enrollment_revoked'}
    require(not set(data).difference(allowed), 'unknown_operator_receipt_field')
    require(data.get('schema_version') == 1 and data.get('runner_identity') == state['identity'], 'receipt_identity_mismatch')
    require(0 <= now - timestamp(data.get('observed_at')) <= 900, 'operator_receipt_expired_or_future')
    require(data.get('drained') is True and data.get('host_inventory_checked') is True, 'operator_must_confirm_drained_inventory')
    if not enrollment: return data
    require(data.get('enrollment_revoked') is not True, 'enrollment_revoked')
    expected = f'{REPOSITORY}/{EXECUTOR_PATH}@refs/heads/main'
    require(data.get('repository') == REPOSITORY and data.get('organization') == ORGANIZATION, 'organization_scope_required')
    require(data.get('group_name') == registry['self_hosted_group'] and type(registry.get('self_hosted_group_id')) is int and registry['self_hosted_group_id'] > 0 and data.get('group_id') == registry['self_hosted_group_id'], 'approved_group_required')
    require(data.get('visibility') == 'selected' and data.get('selected_repositories') == [REPOSITORY] and data.get('allows_public_repositories') is True, 'studioos_only_group_required')
    require(data.get('restricted_to_workflows') is True and data.get('selected_workflows') == [expected], 'direct_main_executor_only')
    require(data.get('job_isolation_verified') is True, 'separate_job_identity_must_be_verified')
    require(re.fullmatch(r'[a-f0-9]{40}', data.get('executor_revision','')) and re.fullmatch(r'[a-f0-9]{64}', data.get('executor_file_sha256','')), 'pinned_published_executor_required')
    require(now < timestamp(data.get('pilot_expires_at')) <= now + 86400 and isinstance(data.get('budget_reference'), str) and 1 <= len(data['budget_reference']) <= 200, 'bounded_approved_pilot_required')
    if state['profile'] == 'linux-x64': require(data.get('provider_teardown_scheduled') is True, 'provider_teardown_must_be_scheduled_privately')
    return data

def published_executor(receipt, get=None):
    def request(path):
        with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path, headers={'Accept':'application/vnd.github+json','User-Agent':'StudioOS-runner-bootstrap-v1'}), timeout=30) as r:
            return json.load(r)
    get = get or request
    sha = receipt['executor_revision']
    relation = get('/compare/' + sha + '...main')
    require(relation.get('status') in ['ahead','identical'] and relation.get('merge_base_commit',{}).get('sha') == sha, 'executor_not_published_on_main')
    file = get('/contents/' + EXECUTOR_PATH + '?ref=' + sha)
    require(file.get('encoding') == 'base64' and file.get('type') == 'file', 'executor_workflow_missing')
    content = base64.b64decode(file['content'], validate=False)
    require(hashlib.sha256(content).hexdigest() == receipt['executor_file_sha256'], 'executor_content_changed')

def registration(root, registry, state, receipt=None):
    file = root / 'listener/runner/.runner'
    if not file.exists():
        require(not any((root / 'listener/runner' / f).exists() for f in ['.credentials','.credentials_rsaparams']), 'partial_registration_requires_operator_recovery')
        return None
    data = json_file(file)
    require(data.get('gitHubUrl','').rstrip('/') == 'https://github.com/' + ORGANIZATION, 'wrong_scope_drain_and_reenroll_at_organization')
    require(data.get('agentName') == state['identity'] and type(data.get('agentId')) is int and data['agentId'] > 0, 'existing_registration_identity_mismatch')
    require(data.get('poolName') == registry['self_hosted_group'], 'wrong_group_drain_and_reenroll')
    require(state.get('runner_id',data['agentId']) == data['agentId'] and state.get('group_id',data.get('poolId')) == data.get('poolId'), 'registration_changed_requires_operator_recovery')
    if registry.get('self_hosted_group_id') is not None: require(data.get('poolId') == registry['self_hosted_group_id'], 'runner_group_id_mismatch')
    if receipt: require(data.get('poolId') == receipt['group_id'], 'runner_group_id_mismatch')
    require(all((root / 'listener/runner' / f).is_file() and (root / 'listener/runner' / f).stat().st_size > 0 for f in ['.credentials','.credentials_rsaparams']), 'partial_registration_requires_operator_recovery')
    return data

def token_from_fd(fd):
    require(fd is not None and fd >= 3, 'private_token_fd_3_or_higher_required')
    chunks = []
    try:
        while sum(map(len, chunks)) <= 4096:
            chunk = os.read(fd, 4097 - sum(map(len, chunks)))
            if not chunk: break
            chunks.append(chunk)
    finally: os.close(fd)
    raw = b''.join(chunks)
    require(len(raw) <= 4096, 'invalid_registration_material')
    try: token = raw.decode().strip()
    except UnicodeDecodeError: raise Refusal('invalid_registration_material')
    require(re.fullmatch(r'[A-Za-z0-9_.-]{16,4096}', token), 'invalid_registration_material')
    return token

def listener_command(root, args, token=None):
    user = pwd.getpwnam(USERS[0])
    env = clean_env(Path(user.pw_dir), root / 'tools')
    if token is not None: env['ACTIONS_RUNNER_INPUT_TOKEN'] = token
    # subprocess privilege drop avoids token-bearing argv or a token-bearing sudo environment command.
    def drop():
        os.initgroups(user.pw_name, user.pw_gid); os.setgid(user.pw_gid); os.setuid(user.pw_uid)
    result = subprocess.run(args, cwd=root / 'listener/runner', env=env, preexec_fn=drop, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0, 'runner_configuration_failed_see_private_operator_diagnostics')
    return result.stdout.decode().strip()

def registration_args(root, registry, state):
    return [str(root / 'listener/runner/config.sh'), '--unattended', '--url', 'https://github.com/' + ORGANIZATION, '--name', state['identity'], '--runnergroup', registry['self_hosted_group'], '--labels', registry['shared_capability'], '--work', str(root / 'work'), '--disableupdate']

def service_spec(root, state, script, deadline):
    name = 'studioos-runner-' + state['identity'].split('-')[-1]
    argv = [str(script), '_serve', str(root), str(int(deadline))]
    if platform.system() == 'Linux':
        path = Path('/etc/systemd/system') / (name + '.service')
        require(all(re.fullmatch(r'[/A-Za-z0-9_.-]+', x) for x in argv), 'unsafe_service_path')
        text = '[Unit]\nDescription=StudioOS trusted runner pilot\nAfter=network-online.target\n[Service]\nType=simple\nUser='+USERS[0]+'\nGroup='+USERS[0]+'\nWorkingDirectory='+str(root / 'listener/runner')+'\nExecStart='+' '.join(argv)+'\nRestart=no\nKillMode=control-group\nTimeoutStopSec=30\nUMask=0077\n'
        return name, path, text.encode()
    label = 'com.axal.' + name
    path = Path('/Library/LaunchDaemons') / (label + '.plist')
    return label, path, plistlib.dumps({'Label':label,'ProgramArguments':argv,'UserName':USERS[0],'GroupName':USERS[0],'WorkingDirectory':str(root / 'listener/runner'),'RunAtLoad':False,'KeepAlive':False,'AbandonProcessGroup':False,'Umask':0o077})

def service(root, state, script, operation, deadline=None):
    name, path, content = service_spec(root, state, script, deadline or 0)
    if operation == 'start':
        if path.exists() or path.is_symlink(): trusted_file(path)
        path.write_bytes(content); path.chmod(0o644)
        if platform.system() == 'Linux':
            command(['/usr/bin/systemctl','daemon-reload']); command(['/usr/bin/systemctl','start',name])
        else:
            loaded = subprocess.run(['/bin/launchctl','print','system/'+name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if loaded.returncode == 0: command(['/bin/launchctl','bootout','system/'+name])
            command(['/bin/launchctl','bootstrap','system',str(path)])
            command(['/bin/launchctl','kickstart','system/'+name])
    elif operation == 'stop':
        if platform.system() == 'Linux':
            if path.exists() or service(root,state,script,'status'): command(['/usr/bin/systemctl','stop',name])
        else:
            if subprocess.run(['/bin/launchctl','print','system/'+name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0: command(['/bin/launchctl','bootout','system/'+name])
    elif operation == 'remove':
        service(root,state,script,'stop');path.unlink(missing_ok=True)
        if platform.system() == 'Linux': command(['/usr/bin/systemctl','daemon-reload'])
    elif platform.system() == 'Linux':
        return subprocess.run(['/usr/bin/systemctl','is-active','--quiet',name]).returncode == 0
    else:
        result = subprocess.run(['/bin/launchctl','print','system/'+name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        return result.returncode == 0 and 'state = running' in result.stdout
    return True

def other_listeners(root, managed_active=False):
    listing = command(['/bin/ps','-eo','uid=,args='])
    listeners = [line for line in listing.splitlines() if 'Runner.Listener' in line]
    own_uid = pwd.getpwnam(USERS[0]).pw_uid
    own = any(re.match(r'\s*'+str(own_uid)+r'\s', line) for line in listeners)
    return max(0, len(listeners) - (1 if managed_active and own else 0))

def private_files(root):
    for name in ['.runner','.credentials','.credentials_rsaparams','.env','.path']:
        p = root / 'listener/runner' / name
        if p.exists() or p.is_symlink():
            require(p.is_file() and not p.is_symlink(), 'registration_file_must_not_be_a_link')
            p.chmod(0o600)
    if (root / 'listener/runner/_diag').exists(): (root / 'listener/runner/_diag').chmod(0o700)

def clear_registration(root, state):
    for name in ['.runner','.credentials','.credentials_rsaparams','.env','.path']:
        (root/'listener/runner'/name).unlink(missing_ok=True)
    state.pop('runner_id',None);state.pop('group_id',None);state['phase']='verified'
    save_state(root,state)


def save_state(root, state):
    target = root / 'state.json'
    with tempfile.NamedTemporaryFile('w', dir=root, prefix='.state-', delete=False) as f:
        json.dump(state, f); f.flush(); os.fsync(f.fileno()); temporary = Path(f.name)
    temporary.chmod(0o600); temporary.replace(target)

def install(root, registry, profile, state, os_dependencies=False):
    listener, job = accounts(root)
    destinations = {'runner':root / 'listener/runner','node':root / 'tools/node','python':root / 'tools/python'}
    complete = all(destinations[k].is_dir() and (root / ('.installed-' + k)).exists() and (root / ('.installed-' + k)).read_text() == v['sha256'] for k,v in profile['artifacts'].items())
    if complete and state.get('pins') == profile['artifacts']:
        return verify_tools(profile,root)
    for path, owner, mode in [(root / 'listener',listener,0o700),(root / 'work',listener,0o700),(root / 'jobs',job,0o700),(root / 'cache',job,0o700)]:
        path.mkdir(exist_ok=True);os.chown(path,owner.pw_uid,owner.pw_gid);path.chmod(mode)
    require(state.get('pins') in [None, profile['artifacts']], 'pin_upgrade_requires_drained_removal_and_operator_review')
    state['pins'] = profile['artifacts'];state['phase'] = 'installing';save_state(root,state)
    destinations = {'runner':root / 'listener/runner','node':root / 'tools/node','python':root / 'tools/python'}
    for kind, artifact in profile['artifacts'].items():
        destination = destinations[kind]
        marker = root / ('.installed-' + kind)
        if destination.is_dir() and marker.exists() and marker.read_text() == artifact['sha256']: continue
        require(not destination.exists(), 'unmarked_partial_install_requires_operator_recovery')
        with tempfile.TemporaryDirectory(prefix='.partial-',dir=root) as temporary:
            temporary = Path(temporary); archive = temporary / 'archive.tar.gz'
            verified_download(artifact,archive);safe_extract(archive, temporary / 'files')
            source = temporary / 'files' / artifact['directory']
            require(source.is_dir(), 'archive_layout_changed')
            if kind == 'runner' and os_dependencies:
                require(platform.system() == 'Linux', 'os_dependency_install_is_linux_only')
                command(['/bin/bash', str(source / 'bin/installdependencies.sh')], env=clean_env(root,root/'tools'))
            # Assign ownership only in root-private staging, never by following listener-controlled paths.
            if kind == 'runner':
                for directory, dirs, files in os.walk(source):
                    os.chown(directory,listener.pw_uid,listener.pw_gid,follow_symlinks=False)
                    for name in dirs + files: os.chown(Path(directory)/name,listener.pw_uid,listener.pw_gid,follow_symlinks=False)
            destination.parent.mkdir(parents=True,exist_ok=True);source.rename(destination)
            marker.write_text(artifact['sha256']);marker.chmod(0o600)
    report = verify_tools(profile,root)
    state['phase']='verified';save_state(root,state)
    return report

def serve(root, deadline):
    require(os.geteuid() == pwd.getpwnam(USERS[0]).pw_uid != 0, 'service_must_use_listener_identity')
    remaining = deadline - time.time();require(0 < remaining <= 86400, 'pilot_deadline_invalid_or_expired')
    child = subprocess.Popen([str(root/'listener/runner/run.sh'),'--startuptype','service'],cwd=root/'listener/runner',env=clean_env(root/'listener',root/'tools'),start_new_session=True)
    def stop(*unused):
        if child.poll() is None:
            os.killpg(child.pid,signal.SIGTERM)
            try: child.wait(timeout=25)
            except subprocess.TimeoutExpired: os.killpg(child.pid,signal.SIGKILL);child.wait()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    try: return child.wait(timeout=remaining)
    except subprocess.TimeoutExpired: stop();return 0
    finally: stop()

def main(directory, argv):
    if argv and argv[0] == '_serve': return serve(Path(argv[1]),int(argv[2]))
    class PrivateParser(argparse.ArgumentParser):
        def error(self, message): raise Refusal('invalid_cli_arguments_do_not_pass_credential_values')
    parser=PrivateParser(description='D7885 verified runner bootstrap; no token values in arguments')
    parser.add_argument('action',choices=['plan','install','verify','register','start','status','stop','remove'])
    parser.add_argument('--profile',required=True,choices=['linux-x64','macos-arm64','hosted'])
    parser.add_argument('--root',default='/opt/studioos-runner-v1')
    parser.add_argument('--approval-file',type=Path)
    parser.add_argument('--token-fd',type=int)
    parser.add_argument('--install-os-deps',action='store_true')
    parser.add_argument('--revoked',action='store_true')
    args=parser.parse_args(argv)
    registry=load_registry(directory/'profiles.json');profile=select_profile(registry,args.profile)
    root=Path(args.root)
    require(root.is_absolute() and re.fullmatch(r'/[A-Za-z0-9_./-]+',str(root)) and root==root.resolve() and len(root.parts)>=3, 'use_a_dedicated_absolute_root_without_symlinks')
    if args.action=='plan':
        print(json.dumps({'schema_version':1,'profile':args.profile,'group':registry['self_hosted_group'],'group_id':registry['self_hosted_group_id'],'labels':profile['labels'],'processes_per_machine':1,'registration':'separate_operator_action','hosted_fallback':'unchanged','pins':profile['artifacts']}));return 0
    if args.action=='verify':
        print(json.dumps({'schema_version':1,'profile':args.profile,'identity':json_file(root/'state.json')['identity'] if (root/'state.json').exists() else None,'os':profile['github_os'],'architecture':profile['github_arch'],**capacity(),**verify_tools(profile,root),'online_idle_eligibility':'not_verified_by_local_preflight'}));return 0
    require(os.geteuid()==0,'privileged_operator_required')
    trusted_file(directory/'bootstrap.sh');trusted_file(directory/'profiles.json')
    require(not root.exists() or (root.stat().st_uid == 0 and not root.stat().st_mode & 0o022), 'install_root_must_be_root_owned_and_not_job_writable')
    require(not root.exists() or (root/'state.json').exists() or not any(root.iterdir()), 'existing_unmanaged_directory_is_not_an_install_target')
    require(args.action == 'install' or (root/'state.json').exists(), 'install_and_verify_first')
    for parent in root.parents:
        if parent.exists():
            entry = parent.stat()
            require(entry.st_uid == 0 and not entry.st_mode & 0o022, 'install_parent_must_be_root_owned_and_not_job_writable')
    root.mkdir(parents=True,exist_ok=True);root.chmod(0o755)
    if (root/'state.json').exists(): trusted_file(root/'state.json',private=True)
    lock=os.open(root/'.bootstrap.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise Refusal('another_lifecycle_operation_is_running')
        state=json_file(root/'state.json') if (root/'state.json').exists() else {'schema_version':1,'identity':'studioos-'+args.profile+'-'+uuid.uuid4().hex,'profile':args.profile,'phase':'new'}
        require(state['profile']==args.profile and re.fullmatch(r'studioos-'+re.escape(args.profile)+r'-[a-f0-9]{32}',state['identity']), 'existing_installation_profile_mismatch')
        if args.action=='install':
            save_state(root,state)
            report=install(root,registry,profile,state,args.install_os_deps);print(json.dumps({'phase':'verified','identity':state['identity'],**report}));return 0
        require((root/'state.json').exists(),'install_and_verify_first')
        if args.action=='status':
            existing=registration(root,registry,state)
            print(json.dumps({'identity':state['identity'],'profile':args.profile,'local_registration':bool(existing),'service_active':service(root,state,directory/'bootstrap.sh','status'),'online_idle_eligibility':'unverified_operator_inventory_required'}));return 0
        if args.action=='register':
            existing=registration(root,registry,state)
            if existing:
                private_files(root);print(json.dumps({'identity':state['identity'],'registration':'existing_not_duplicated','online_idle_eligibility':'unverified_operator_inventory_required'}));return 0
        require(args.approval_file is not None,'private_operator_receipt_required')
        trusted_file(args.approval_file,private=True)
        receipt=approval(json_file(args.approval_file),registry,state,enrollment=args.action in ['register','start'])
        listener,job=accounts(root)
        if args.action in ['register','start']:
            verify_tools(profile,root);published_executor(receipt)
            require(other_listeners(root,service(root,state,directory/'bootstrap.sh','status'))==0,'another_runner_is_present_drain_before_migration')
        if args.action=='register':
            token=token_from_fd(args.token_fd)
            try: listener_command(root,registration_args(root,registry,state),token)
            finally: token=None;private_files(root)
            record=registration(root,registry,state,receipt);state['runner_id']=record['agentId'];state['group_id']=record['poolId'];state['phase']='registered';save_state(root,state)
        elif args.action=='start':
            require(registration(root,registry,state,receipt),'organization_registration_required')
            if not service(root,state,directory/'bootstrap.sh','status'): service(root,state,directory/'bootstrap.sh','start',timestamp(receipt['pilot_expires_at']))
        elif args.action=='stop': service(root,state,directory/'bootstrap.sh','stop')
        elif args.action=='remove':
            require(not service(root,state,directory/'bootstrap.sh','status'),'drain_and_stop_service_before_removal')
            require(other_listeners(root)==0,'another_runner_is_present')
            existing=registration(root,registry,state)
            if existing and not args.revoked:
                token=token_from_fd(args.token_fd)
                try: listener_command(root,[str(root/'listener/runner/config.sh'),'remove','--unattended'],token)
                finally: token=None;private_files(root)
                require(not (root/'listener/runner/.runner').exists(),'unregister_did_not_complete')
            elif existing:
                require(receipt.get('enrollment_revoked') is True,'revocation_must_be_confirmed_by_operator')
            service(root,state,directory/'bootstrap.sh','remove')
            clear_registration(root,state)
        print(json.dumps({'identity':state['identity'],'action':args.action,'local_state':state['phase'],'online_idle_eligibility':'unverified_operator_inventory_required'}));return 0
    finally: os.close(lock)

if __name__=='__main__':
    try: sys.exit(main(Path(sys.argv[1]),sys.argv[2:]))
    except (Refusal,OSError,ValueError,KeyError,subprocess.SubprocessError):
        # External output, receipt contents and registration material are never echoed.
        error=sys.exc_info()[1]
        print(json.dumps({'error':str(error) if isinstance(error,Refusal) else 'bootstrap_operation_failed_see_private_operator_diagnostics'}),file=sys.stderr)
        sys.exit(1)
# PYTHON_END
PY
