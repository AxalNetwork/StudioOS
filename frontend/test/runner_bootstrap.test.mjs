// D7885 (#7885): offline native-profile, integrity, private enrollment and recoverable lifecycle contracts; no real registration/provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../../scripts/ci/runners/bootstrap.sh', import.meta.url));
const profiles = fileURLToPath(new URL('../../scripts/ci/runners/profiles.json', import.meta.url));
const source = readFileSync(script, 'utf8');
const python = source.split('# PYTHON_BEGIN\n')[1].split('# PYTHON_END')[0];
function fixture(body) {
  const code = `import types,json,tempfile,io,tarfile,hashlib,os,stat,subprocess,unittest.mock as mock\nfrom pathlib import Path\nb=types.ModuleType('fixture_bootstrap')\nexec(${JSON.stringify(python)}, b.__dict__)\nr=b.load_registry(Path(${JSON.stringify(profiles)}))\np=r['profiles']['linux-x64']\ndef refuses(fn, reason):\n try: fn()\n except b.Refusal as e: assert reason in str(e),str(e)\n else: raise AssertionError('expected refusal: '+reason)\n${body}\n`;
  const result = spawnSync('python3', ['-c', code], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('fixed profiles retain native AND labels and a separate standard-hosted pool; two hosts need no new YAML', () => {
  fixture(`assert b.select_profile(r,'linux-x64','Linux','x86_64')['labels']==['self-hosted','Linux','X64','studioos-worker-v1']
assert b.select_profile(r,'macos-arm64','Darwin','arm64')['labels']==['self-hosted','macOS','ARM64','studioos-worker-v1']
assert r['profiles']['hosted']['runs_on']=='ubuntu-latest'
for name,system,machine in [('linux-x64','Darwin','arm64'),('macos-arm64','Darwin','x86_64'),('linux-x64','Linux','aarch64')]: refuses(lambda:b.select_profile(r,name,system,machine),'native_os_and_architecture')
refuses(lambda:b.select_profile(r,'hosted','Linux','x86_64'),'not_a_registration_target')
assert len({b.uuid.uuid4().hex for _ in range(2)})==2
for identity in ['studioos-linux-x64-'+('a'*32),'studioos-linux-x64-'+('b'*32)]:
 args=b.registration_args(Path('/opt/studioos-runner-v1'),r,{'identity':identity})
 assert args[args.index('--labels')+1]=='studioos-worker-v1'
 assert '--no-default-labels' not in args and '--replace' not in args
 assert args[args.index('--url')+1]=='https://github.com/AxalNetwork'
`);
});

test('native Node/Python exact versions and Node SQLite/FTS are checked; missing or emulated runtimes fail', () => {
  fixture(`def run(args):
 if args[-1]=='--version' and 'Runner.Listener' in args[0]: return p['runner_version']
 if args[0]=='/usr/bin/git':return 'git version 2.43.0'
 if 'node' in args[0]:return json.dumps({'version':p['node_version'],'arch':'x64','sqlite':'3.50.4','json':1})
 return json.dumps({'version':p['python_version'],'machine':'x86_64'})
assert b.verify_tools(p,Path('/opt/test'),run)['sqlite_version']=='3.50.4'
for field,value,error in [('node_version','0.0.0','pinned_node'),('node_arch','arm64','pinned_node'),('python_version','0.0.0','pinned_native_python'),('machine','arm64','pinned_native_python'),('runner_version','0.0.0','pinned_runner')]:
 q=dict(p);q[field]=value;refuses(lambda:b.verify_tools(q,Path('/opt/test'),run),error)
def missing(args):raise FileNotFoundError('missing runtime')
try:b.verify_tools(p,Path('/opt/test'),missing)
except FileNotFoundError:pass
else:raise AssertionError('missing runtime accepted')
`);
});

test('download digest is mandatory before extraction; traversal, escaping links and devices are refused', () => {
  fixture(`with tempfile.TemporaryDirectory() as t:
 root=Path(t)
 data=b'controlled archive bytes'; artifact={'url':'https://example.invalid/pin','sha256':hashlib.sha256(data).hexdigest()}
 b.verified_download(artifact,root/'good',lambda url:io.BytesIO(data));assert (root/'good').read_bytes()==data
 refuses(lambda:b.verified_download(artifact,root/'bad',lambda url:io.BytesIO(b'altered')),'digest_mismatch');assert not (root/'bad').exists()
 for name,kind,link in [('../outside','file',''),('link','link','../../outside'),('/absolute','file',''),('device','device','')]:
  archive=root/'bad.tar.gz'
  with tarfile.open(archive,'w:gz') as f:
   entry=tarfile.TarInfo(name)
   if kind=='link':entry.type=tarfile.SYMTYPE;entry.linkname=link
   elif kind=='device':entry.type=tarfile.CHRTYPE
   else:entry.size=1
   f.addfile(entry,io.BytesIO(b'x') if kind=='file' else None)
  refuses(lambda:b.safe_extract(archive,root/'out'),'unsafe_archive')
`);
});

const receipt = `r['self_hosted_group_id']=7
state={'identity':'studioos-linux-x64-'+('a'*32),'profile':'linux-x64'}
proof={'schema_version':1,'observed_at':'2026-11-20T12:00:00Z','runner_identity':state['identity'],'repository':'AxalNetwork/StudioOS','organization':'AxalNetwork','group_name':r['self_hosted_group'],'group_id':7,'visibility':'selected','selected_repositories':['AxalNetwork/StudioOS'],'allows_public_repositories':True,'restricted_to_workflows':True,'selected_workflows':['AxalNetwork/StudioOS/.github/workflows/runner-executor.yml@refs/heads/main'],'executor_revision':'b'*40,'executor_file_sha256':'c'*64,'job_isolation_verified':True,'host_inventory_checked':True,'drained':True,'pilot_expires_at':'2026-11-20T13:00:00Z','budget_reference':'approved-private-reference','provider_teardown_scheduled':True}
now=b.timestamp('2026-11-20T12:05:00Z')
`;
test('recent privileged approval requires exact repository/group/workflow, isolated job identity and bounded pilot', () => {
  fixture(receipt + `assert b.approval(proof,r,state,now)==proof
missing=dict(r);missing['self_hosted_group_id']=None;refuses(lambda:b.approval(proof,missing,state,now),'approved_group')
for field,value,reason in [('observed_at','2026-11-20T11:00:00Z','expired'),('observed_at','2026-11-20T12:06:00Z','future'),('runner_identity','other','identity'),('repository','Other/Repo','scope'),('visibility','all','studioos_only'),('selected_repositories',['Other/Repo'],'studioos_only'),('restricted_to_workflows',False,'direct_main'),('selected_workflows',['AxalNetwork/StudioOS/.github/workflows/ci.yml@refs/heads/main'],'direct_main'),('job_isolation_verified',False,'job_identity'),('host_inventory_checked',False,'drained'),('drained',False,'drained'),('enrollment_revoked',True,'revoked'),('provider_teardown_scheduled',False,'teardown'),('pilot_expires_at','2026-11-22T00:00:00Z','bounded'),('executor_revision','main','pinned_published')]:
 q=dict(proof);q[field]=value;refuses(lambda:b.approval(q,r,state,now),reason)
q=dict(proof);q['token']='not-allowed';refuses(lambda:b.approval(q,r,state,now),'unknown_operator')
# A drained operator may stop/remove a revoked enrollment; the same receipt cannot start it.
q=dict(proof);q['enrollment_revoked']=True;assert b.approval(q,r,state,now,enrollment=False)==q
`);
});

test('a main-published exact executor is independently verified; branch-only, missing and changed workflows fail', () => {
  fixture(receipt + `content=b'name: trusted executor';proof['executor_file_sha256']=hashlib.sha256(content).hexdigest()
def get(path):
 if path.startswith('/compare/'):return {'status':'ahead','merge_base_commit':{'sha':'b'*40}}
 return {'type':'file','encoding':'base64','content':b.base64.b64encode(content).decode()}
b.published_executor(proof,get)
refuses(lambda:b.published_executor(proof,lambda path:{'status':'diverged','merge_base_commit':{'sha':'a'*40}}),'not_published')
q=dict(proof);q['executor_file_sha256']='d'*64;refuses(lambda:b.published_executor(q,get),'content_changed')
`);
});

test('existing organization registration is reused; repository-only, wrong-group and partial registration are rejected', () => {
  fixture(receipt + `with tempfile.TemporaryDirectory() as t:
 root=Path(t);directory=root/'listener/runner';directory.mkdir(parents=True)
 assert b.registration(root,r,state) is None
 row={'gitHubUrl':'https://github.com/AxalNetwork','agentName':state['identity'],'agentId':1,'poolName':r['self_hosted_group'],'poolId':7}
 for f in ['.credentials','.credentials_rsaparams']:(directory/f).write_text('synthetic listener credential')
 def put(value):(directory/'.runner').write_text(json.dumps(value))
 put(row);assert b.registration(root,r,state,proof)['agentId']==1
 for field,value,reason in [('gitHubUrl','https://github.com/AxalNetwork/StudioOS','wrong_scope'),('poolName','Default','wrong_group'),('poolId',9,'group_id'),('agentName','other','identity')]:
  q=dict(row);q[field]=value;put(q);refuses(lambda:b.registration(root,r,state,proof),reason)
 put(row);(directory/'.credentials').unlink();refuses(lambda:b.registration(root,r,state,proof),'partial_registration')
`);
});

test('tokens stay off argv, input is bounded, child output is suppressed and generated service environment has no credentials', () => {
  fixture(`read,write=os.pipe();os.write(write,b'SYNTHETIC_REGISTRATION_MATERIAL');os.close(write)
assert b.token_from_fd(read)=='SYNTHETIC_REGISTRATION_MATERIAL'
refuses(lambda:b.token_from_fd(0),'private_token_fd')
read,write=os.pipe();os.write(write,b'x'*4097);os.close(write);refuses(lambda:b.token_from_fd(read),'invalid_registration')
args=b.registration_args(Path('/opt/test'),r,{'identity':'studioos-linux-x64-'+('a'*32)})
assert '--token' not in args and not any('SYNTHETIC' in str(a) for a in args)
with mock.patch.object(b.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_dir='/opt/test/listener',pw_uid=1001,pw_gid=1001,pw_name='studioos-runner')):
 with mock.patch.object(b.subprocess,'run',return_value=types.SimpleNamespace(returncode=1,stdout=b'SYNTHETIC_REGISTRATION_MATERIAL',stderr=b'SYNTHETIC_REGISTRATION_MATERIAL')) as call:
  refuses(lambda:b.listener_command(Path('/opt/test'),args,'SYNTHETIC_REGISTRATION_MATERIAL'),'configuration_failed')
  assert call.call_args.kwargs['env']['ACTIONS_RUNNER_INPUT_TOKEN']=='SYNTHETIC_REGISTRATION_MATERIAL'
  assert 'SYNTHETIC' not in repr(call.call_args.args[0])
assert not any('TOKEN' in k or 'SECRET' in k for k in b.clean_env(Path('/opt/listener'),Path('/opt/tools')))
`);
  const bad = spawnSync('bash', [script, 'register', '--profile', 'linux-x64', '--token', 'SYNTHETIC_DO_NOT_ECHO'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.doesNotMatch(bad.stdout + bad.stderr, /SYNTHETIC_DO_NOT_ECHO/);
});

test('native service definitions use one dedicated listener, bounded supervisor and recoverable Linux/Mac start paths', () => {
  fixture(`state={'identity':'studioos-linux-x64-'+('a'*32)}
with mock.patch.object(b.platform,'system',return_value='Linux'):
 name,path,data=b.service_spec(Path('/opt/test'),state,Path('/usr/local/share/studioos/bootstrap.sh'),123456)
 assert 'User=studioos-runner' in data.decode() and 'KillMode=control-group' in data.decode() and 'Restart=no' in data.decode()
 assert '_serve /opt/test 123456' in data.decode() and 'TOKEN' not in data.decode()
with mock.patch.object(b.platform,'system',return_value='Darwin'):
 name,path,data=b.service_spec(Path('/opt/test'),state,Path('/usr/local/share/studioos/bootstrap.sh'),123456)
 spec=b.plistlib.loads(data);assert spec['UserName']=='studioos-runner' and spec['KeepAlive'] is False
 assert spec['ProgramArguments'][-1]=='123456' and spec['AbandonProcessGroup'] is False
`);
});

test('separate unprivileged accounts, private credential modes and single-listener inventory are enforced', () => {
  fixture(`listener=types.SimpleNamespace(pw_uid=1001,pw_gid=1001,pw_name='studioos-runner')
job=types.SimpleNamespace(pw_uid=1002,pw_gid=1002,pw_name='studioos-job')
with mock.patch.object(b.os,'getgrouplist',side_effect=lambda name,gid:[gid]),mock.patch.object(b.grp,'getgrgid',side_effect=lambda gid:types.SimpleNamespace(gr_name='isolated')):
 b.validate_accounts(listener,job)
 job.pw_uid=1001;refuses(lambda:b.validate_accounts(listener,job),'separate_non_root');job.pw_uid=1002
with mock.patch.object(b.os,'getgrouplist',side_effect=lambda name,gid:[gid]),mock.patch.object(b.grp,'getgrgid',return_value=types.SimpleNamespace(gr_name='docker')):
 refuses(lambda:b.validate_accounts(listener,job),'privileged_groups')
with tempfile.TemporaryDirectory() as t:
 root=Path(t);directory=root/'listener/runner';directory.mkdir(parents=True)
 for f in ['.runner','.credentials','.credentials_rsaparams','.env','.path']:(directory/f).write_text('synthetic')
 b.private_files(root)
 assert all(stat.S_IMODE((directory/f).stat().st_mode)==0o600 for f in ['.runner','.credentials','.credentials_rsaparams','.env','.path'])
with mock.patch.object(b,'command',return_value='1001 ./bin/Runner.Listener run\\n1001 ./bin/Runner.Listener run\\n'),mock.patch.object(b.pwd,'getpwnam',return_value=listener):
 assert b.other_listeners(Path('/opt/test'),True)==1
 assert b.other_listeners(Path('/opt/test'),False)==2
`);
});

test('installation resumes verified artifacts and rerunning it does not touch registration or duplicate service', () => {
  fixture(`with tempfile.TemporaryDirectory() as t:
 root=Path(t);state={'identity':'studioos-linux-x64-'+('a'*32),'profile':'linux-x64','phase':'registered','pins':p['artifacts']}
 for k,v in p['artifacts'].items():(root/('.installed-'+k)).write_text(v['sha256'])
 for path in ['listener/runner','tools/node','tools/python']:(root/path).mkdir(parents=True)
 listener=types.SimpleNamespace(pw_uid=1001,pw_gid=1001);job=types.SimpleNamespace(pw_uid=1002,pw_gid=1002)
 with mock.patch.object(b,'accounts',return_value=(listener,job)),mock.patch.object(b,'verify_tools',return_value={'node_version':p['node_version']}),mock.patch.object(b,'verified_download') as download,mock.patch.object(b,'service') as service:
  first=b.install(root,r,p,state);second=b.install(root,r,p,state)
  assert first==second and state['phase']=='registered';assert download.call_count==service.call_count==0
 # A pin change cannot overwrite an installation that may own a registration.
 q=dict(p);q['artifacts']=dict(p['artifacts']);q['artifacts']['node']=dict(p['artifacts']['node'],sha256='f'*64)
 with mock.patch.object(b,'accounts',return_value=(listener,job)),mock.patch.object(b.os,'chown'):
  refuses(lambda:b.install(root,r,q,state),'pin_upgrade')
`);
});

test('the CLI is read-only by default and never accepts a per-machine runs-on target', () => {
  const plan = spawnSync('bash', [script, 'plan', '--profile', 'linux-x64'], { encoding: 'utf8' });
  if (process.platform === 'linux' && process.arch === 'x64') {
    assert.equal(plan.status, 0, plan.stderr);
    const output = JSON.parse(plan.stdout);
    assert.equal(output.registration, 'separate_operator_action');
    assert.equal(output.processes_per_machine, 1);
    assert.equal(output.hosted_fallback, 'unchanged');
  } else {
    assert.notEqual(plan.status, 0);
  }
  const hosted = spawnSync('bash', [script, 'plan', '--profile', 'hosted'], { encoding: 'utf8' });
  assert.notEqual(hosted.status, 0);
  assert.match(hosted.stderr, /not_a_registration_target/);
  assert.doesNotMatch(source, /--replace|--no-default-labels/);
});

test('an interrupted download resumes without repeating completed artifacts or creating a registration', () => {
  fixture(`with tempfile.TemporaryDirectory() as t:
 root=Path(t);state={'identity':'studioos-linux-x64-'+('a'*32),'profile':'linux-x64','phase':'new'}
 listener=types.SimpleNamespace(pw_uid=1001,pw_gid=1001);job=types.SimpleNamespace(pw_uid=1002,pw_gid=1002)
 calls=[];failed=[False]
 def download(artifact,destination):
  kind=next(k for k,v in p['artifacts'].items() if v is artifact);calls.append(kind)
  if kind=='node' and not failed[0]:failed[0]=True;raise b.Refusal('fixture_interruption')
  with tarfile.open(destination,'w:gz') as f:
   name=('' if artifact['directory']=='.' else artifact['directory']+'/')+'bin/fixture'
   entry=tarfile.TarInfo(name);entry.size=1;f.addfile(entry,io.BytesIO(b'x'))
 with mock.patch.object(b,'accounts',return_value=(listener,job)),mock.patch.object(b.os,'chown'),mock.patch.object(b,'verified_download',side_effect=download),mock.patch.object(b,'verify_tools',return_value={'node_version':p['node_version']}),mock.patch.object(b,'service') as service:
  refuses(lambda:b.install(root,r,p,state),'fixture_interruption')
  assert state['phase']=='installing' and (root/'.installed-runner').exists() and not (root/'tools/node').exists()
  b.install(root,r,p,state);b.install(root,r,p,state)
  assert calls==['runner','node','node','python'];assert state['phase']=='verified';assert service.call_count==0
  assert not (root/'listener/runner/.runner').exists()
`);
});

test('Mac service reload uses the new pilot deadline, and absent Linux services stop/remove idempotently', () => {
  fixture(`state={'identity':'studioos-macos-arm64-'+('a'*32)}
with mock.patch.object(b.platform,'system',return_value='Darwin'),mock.patch.object(b.Path,'write_bytes'),mock.patch.object(b.Path,'chmod'),mock.patch.object(b.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)),mock.patch.object(b,'command') as command:
 b.service(Path('/opt/test'),state,Path('/usr/local/share/studioos/bootstrap.sh'),'start',123456)
 calls=[x.args[0] for x in command.call_args_list]
 assert [x[1] for x in calls]==['bootout','bootstrap','kickstart']
with mock.patch.object(b.platform,'system',return_value='Linux'),mock.patch.object(b.Path,'exists',return_value=False),mock.patch.object(b.Path,'unlink'),mock.patch.object(b.subprocess,'run',return_value=types.SimpleNamespace(returncode=3)),mock.patch.object(b,'command') as command:
 b.service(Path('/opt/test'),state,Path('/usr/local/share/studioos/bootstrap.sh'),'stop')
 b.service(Path('/opt/test'),state,Path('/usr/local/share/studioos/bootstrap.sh'),'remove')
 assert all('stop' not in x.args[0] for x in command.call_args_list)
`);
});

test('root tool verification never executes listener-owned runner code as root, and private files reject links', () => {
  fixture(`def run(args):
 if args[0]=='/usr/bin/git':return 'git version 2.43.0'
 if 'node' in args[0]:return json.dumps({'version':p['node_version'],'arch':'x64','sqlite':'3.51.3','json':1})
 return json.dumps({'version':p['python_version'],'machine':'x86_64'})
with mock.patch.object(b.os,'geteuid',return_value=0),mock.patch.object(b,'trusted_file') as trusted,mock.patch.object(b,'command',side_effect=run) as command,mock.patch.object(b,'listener_command',return_value=p['runner_version']) as listener:
 b.verify_tools(p,Path('/opt/test'),run=b.command)
 assert listener.call_count==1
 assert trusted.call_count==2
 assert not any('Runner.Listener' in str(c.args) for c in command.call_args_list)
with tempfile.TemporaryDirectory() as t:
 root=Path(t);directory=root/'listener/runner';directory.mkdir(parents=True)
 target=root/'unrelated';target.write_text('untouched');target.chmod(0o644)
 (directory/'.credentials').symlink_to(target)
 refuses(lambda:b.private_files(root),'must_not_be_a_link')
 assert stat.S_IMODE(target.stat().st_mode)==0o644
`);
});

test('confirmed local removal clears stale server IDs so a fresh registration can use its new ID', () => {
  fixture(receipt + `with tempfile.TemporaryDirectory() as t:
 root=Path(t);directory=root/'listener/runner';directory.mkdir(parents=True)
 state.update({'runner_id':1,'group_id':7,'phase':'registered'})
 for f in ['.runner','.credentials','.credentials_rsaparams','.env','.path']:(directory/f).write_text('synthetic')
 b.clear_registration(root,state)
 assert state['phase']=='verified' and 'runner_id' not in state and 'group_id' not in state
 assert not any((directory/f).exists() for f in ['.runner','.credentials','.credentials_rsaparams','.env','.path'])
 row={'gitHubUrl':'https://github.com/AxalNetwork','agentName':state['identity'],'agentId':2,'poolName':r['self_hosted_group'],'poolId':7}
 (directory/'.runner').write_text(json.dumps(row))
 for f in ['.credentials','.credentials_rsaparams']:(directory/f).write_text('synthetic')
 assert b.registration(root,r,state,proof)['agentId']==2
`);
});

test('the bounded supervisor preserves child failure and terminates its process group at the pilot deadline', () => {
  fixture(`user=types.SimpleNamespace(pw_uid=1001)
# Exercise the scoped supervisor only behind a mocked successful security gate.
with mock.patch.object(b,'isolation_enrollment_gate'),mock.patch.object(b.pwd,'getpwnam',return_value=user),mock.patch.object(b.os,'geteuid',return_value=1001),mock.patch.object(b.time,'time',return_value=1000),mock.patch.object(b.signal,'signal'):
 child=mock.Mock();child.wait.return_value=7;child.poll.return_value=7
 with mock.patch.object(b.subprocess,'Popen',return_value=child):assert b.serve(Path('/opt/test'),1100)==7
 child=mock.Mock();child.pid=123;child.wait.side_effect=[b.subprocess.TimeoutExpired('fixture',100),0];child.poll.side_effect=[None,0]
 with mock.patch.object(b.subprocess,'Popen',return_value=child),mock.patch.object(b.os,'killpg') as kill:
  assert b.serve(Path('/opt/test'),1100)==0
  kill.assert_called_once_with(123,b.signal.SIGTERM)
 refuses(lambda:b.serve(Path('/opt/test'),999),'deadline_invalid')
`);
});

test('a second root on the same host cannot duplicate an existing dedicated-account installation', () => {
  fixture(`users={'studioos-runner':types.SimpleNamespace(pw_uid=1001,pw_gid=1001,pw_name='studioos-runner',pw_dir='/opt/old/listener'),'studioos-job':types.SimpleNamespace(pw_uid=1002,pw_gid=1002,pw_name='studioos-job',pw_dir='/opt/old/jobs')}
with mock.patch.object(b.pwd,'getpwnam',side_effect=lambda name:users[name]),mock.patch.object(b,'validate_accounts'),mock.patch.object(b.grp,'getgrgid',side_effect=lambda gid:types.SimpleNamespace(gr_name='studioos-runner' if gid==1001 else 'studioos-job')),mock.patch.object(b,'command') as command:
 refuses(lambda:b.accounts(Path('/opt/second')),'another_installation')
 assert command.call_count==0
`);
});


test('credential hard links and replaced runner directories cannot change unrelated modes', () => {
  fixture(`with tempfile.TemporaryDirectory() as t:
 root=Path(t);directory=root/'listener/runner';directory.mkdir(parents=True)
 target=root/'unrelated';target.write_text('untouched');target.chmod(0o644)
 os.link(target,directory/'.credentials')
 refuses(lambda:b.private_files(root),'must_not_be_a_link')
 assert stat.S_IMODE(target.stat().st_mode)==0o644
 (directory/'.credentials').unlink();directory.rmdir()
 directory.symlink_to(root,target_is_directory=True)
 refuses(lambda:b.private_files(root),'must_not_be_a_link')
 assert stat.S_IMODE(target.stat().st_mode)==0o644
 (root/'.credentials').write_text('preserve')
 refuses(lambda:b.clear_registration(root,{}),'must_not_be_a_link')
 assert (root/'.credentials').read_text()=='preserve'
`);
});


test('root preflight refuses untrusted Node and Python paths before executing either', () => {
  fixture(`for rejected in ['node','python']:
 def trust(path):
  if rejected in str(path):raise b.Refusal('untrusted_runtime')
 with mock.patch.object(b.os,'geteuid',return_value=0),mock.patch.object(b,'trusted_file',side_effect=trust),mock.patch.object(b,'command') as run:
  refuses(lambda:b.verify_tools(p,Path('/opt/test'),run=b.command),'untrusted_runtime')
  run.assert_not_called()
`);
});

// Real private filesystem/state/locks; only privileged host ownership and service/account ports are synthetic.
const operatorFixture = `from contextlib import contextmanager,ExitStack,redirect_stdout
@contextmanager
def operator(root):
 original_stat=b.Path.stat
 protected={root,*root.parents}
 def root_stat(path,*args,**kwargs):
  info=original_stat(path,*args,**kwargs)
  if path in protected:
   values=list(info);values[0]&=~0o022;values[4]=0;return os.stat_result(values)
  return info
 with ExitStack() as stack:
  stack.enter_context(mock.patch.object(b.Path,'stat',root_stat))
  stack.enter_context(mock.patch.object(b.os,'geteuid',return_value=0))
  stack.enter_context(mock.patch.object(b,'trusted_file'))
  yield
def invoke(root,action):
 output=io.StringIO()
 with redirect_stdout(output):
  result=b.main(Path(${JSON.stringify(profiles)}).parent,[action,'--profile','linux-x64','--root',str(root)])
 return result,json.loads(output.getvalue())
`;

test('register acknowledges a complete existing enrollment without a token or activation, while new enrollment and start remain gated', () => {
  fixture(operatorFixture + `with tempfile.TemporaryDirectory() as t:
 root=Path(t)/'install';directory=root/'listener/runner';directory.mkdir(parents=True)
 state={'identity':'studioos-linux-x64-'+('a'*32),'profile':'linux-x64','phase':'registered','runner_id':11,'group_id':r['self_hosted_group_id']}
 b.save_state(root,state)
 row={'gitHubUrl':'https://github.com/AxalNetwork','agentName':state['identity'],'agentId':11,'poolName':r['self_hosted_group'],'poolId':r['self_hosted_group_id']}
 (directory/'.runner').write_text(json.dumps(row))
 for name in ['.credentials','.credentials_rsaparams']:(directory/name).write_text('synthetic fixture material')
 with operator(root),mock.patch.object(b,'isolation_enrollment_gate',wraps=b.isolation_enrollment_gate) as gate,mock.patch.object(b,'listener_command') as configure,mock.patch.object(b,'token_from_fd') as token,mock.patch.object(b,'service') as service:
  for _ in range(2):
   result,report=invoke(root,'register')
   assert result==0 and report['identity']==state['identity']
   assert report['registration']=='existing_not_duplicated'
   assert report['online_idle_eligibility']=='unverified_operator_inventory_required'
  assert json.loads((root/'state.json').read_text())==state
  assert json.loads((directory/'.runner').read_text())==row
  gate.assert_not_called();configure.assert_not_called();token.assert_not_called();service.assert_not_called()
  (directory/'.runner').write_text(json.dumps(dict(row,gitHubUrl='https://github.com/AxalNetwork/StudioOS')))
  refuses(lambda:invoke(root,'register'),'wrong_scope')
  (directory/'.runner').unlink();(directory/'.credentials').unlink();(directory/'.credentials_rsaparams').unlink()
  refuses(lambda:invoke(root,'register'),'isolation_canary_required')
  refuses(lambda:invoke(root,'start'),'isolation_canary_required')
  assert gate.call_count==2
  configure.assert_not_called();token.assert_not_called();service.assert_not_called()
`);
});

const archiveFixture = `import copy,shutil
catalog=copy.deepcopy(r);profile=catalog['profiles']['linux-x64'];archives={};downloads=[]
for kind,artifact in profile['artifacts'].items():
 stream=io.BytesIO()
 with tarfile.open(fileobj=stream,mode='w:gz') as archive:
  name=('' if artifact['directory']=='.' else artifact['directory']+'/')+'bin/fixture'
  content=('synthetic '+kind+' archive').encode();entry=tarfile.TarInfo(name);entry.size=len(content);entry.mode=0o755
  archive.addfile(entry,io.BytesIO(content))
 payload=stream.getvalue();artifact['sha256']=hashlib.sha256(payload).hexdigest();archives[artifact['sha256']]=payload
verified_download=b.verified_download
def download(artifact,destination):
 downloads.append(next(kind for kind,item in profile['artifacts'].items() if item is artifact))
 return verified_download(artifact,destination,lambda url:io.BytesIO(archives[artifact['sha256']]))
listener=types.SimpleNamespace(pw_uid=1001,pw_gid=1001);job=types.SimpleNamespace(pw_uid=1002,pw_gid=1002)
@contextmanager
def installation(root):
 with operator(root),ExitStack() as stack:
  stack.enter_context(mock.patch.object(b,'load_registry',return_value=catalog))
  stack.enter_context(mock.patch.object(b,'accounts',return_value=(listener,job)))
  stack.enter_context(mock.patch.object(b.os,'chown'))
  stack.enter_context(mock.patch.object(b,'verified_download',side_effect=download))
  # These archives are intentionally not runtimes: native compatibility is a separate qualification gate.
  stack.enter_context(mock.patch.object(b,'verify_tools',return_value={'fixture_tools':'synthetic'}))
  yield
`;

test('fresh install verifies and extracts pinned fixture archives, persists one identity and remains idempotent without enrollment or service creation', () => {
  fixture(operatorFixture + archiveFixture + `with tempfile.TemporaryDirectory() as t:
 root=Path(t)/'install'
 with installation(root),mock.patch.object(b,'listener_command') as configure,mock.patch.object(b,'service') as service:
  first,report=invoke(root,'install');state=json.loads((root/'state.json').read_text())
  second,again=invoke(root,'install')
  assert first==second==0 and report==again and report['identity']==state['identity']
  assert state['phase']=='verified' and json.loads((root/'state.json').read_text())==state
  assert downloads==['runner','node','python']
  for kind,item in profile['artifacts'].items():assert (root/('.installed-'+kind)).read_text()==item['sha256']
  assert (root/'listener/runner/bin/fixture').read_text()=='synthetic runner archive'
  assert not any((root/'listener/runner'/name).exists() for name in ['.runner','.credentials','.credentials_rsaparams'])
  configure.assert_not_called();service.assert_not_called()
`);
});

test('a crash after artifact publication refuses the unmarked destination and recovers only after scoped operator repair', () => {
  fixture(operatorFixture + archiveFixture + `with tempfile.TemporaryDirectory() as t:
 root=Path(t)/'install';write_text=b.Path.write_text;interrupted=[False]
 def marker_write(path,*args,**kwargs):
  if path==root/'.installed-node' and not interrupted[0]:interrupted[0]=True;raise OSError('synthetic power-loss window')
  return write_text(path,*args,**kwargs)
 with installation(root),mock.patch.object(b,'listener_command') as configure,mock.patch.object(b,'service') as service,mock.patch.object(b.Path,'write_text',marker_write):
  try:invoke(root,'install')
  except OSError:pass
  else:raise AssertionError('publication interruption was ignored')
  state=json.loads((root/'state.json').read_text());identity=state['identity']
  assert state['phase']=='installing' and (root/'tools/node').is_dir() and not (root/'.installed-node').exists()
  refuses(lambda:invoke(root,'install'),'unmarked_partial_install')
  assert downloads==['runner','node']
  # The private fixture is drained; emulate only the documented incomplete-artifact removal.
  shutil.rmtree(root/'tools/node')
  result,report=invoke(root,'install');assert result==0 and report['identity']==identity
  assert json.loads((root/'state.json').read_text())['phase']=='verified'
  assert downloads==['runner','node','node','python']
  assert (root/'listener/runner/bin/fixture').read_text()=='synthetic runner archive'
  assert not (root/'listener/runner/.runner').exists()
  configure.assert_not_called();service.assert_not_called()
`);
});

test('Linux service restart replaces the deadline in one unit and repeated stop/removal leaves no unit behind', () => {
  fixture(`with tempfile.TemporaryDirectory() as t:
 root=Path(t);state={'identity':'studioos-linux-x64-'+('a'*32)};script=Path('/opt/studioos-bootstrap/bootstrap.sh')
 real_spec=b.service_spec;active=[False];calls=[]
 def spec(*args,**kwargs):
  name,path,content=real_spec(*args,**kwargs);return name,root/path.name,content
 def command(args,**kwargs):
  calls.append(args)
  if args[1]=='start':active[0]=True
  if args[1]=='stop':active[0]=False
  return ''
 def status(*args,**kwargs):return types.SimpleNamespace(returncode=0 if active[0] else 3)
 with mock.patch.object(b.platform,'system',return_value='Linux'),mock.patch.object(b,'service_spec',side_effect=spec),mock.patch.object(b,'trusted_file'),mock.patch.object(b,'command',side_effect=command),mock.patch.object(b.subprocess,'run',side_effect=status):
  b.service(root,state,script,'start',123456)
  units=list(root.glob('*.service'));assert len(units)==1 and '_serve '+str(root)+' 123456' in units[0].read_text()
  assert b.service(root,state,script,'status') is True
  b.service(root,state,script,'stop');assert b.service(root,state,script,'status') is False
  b.service(root,state,script,'start',234567)
  assert list(root.glob('*.service'))==units and '234567' in units[0].read_text() and '123456' not in units[0].read_text()
  assert 'User=studioos-runner' in units[0].read_text() and 'Restart=no' in units[0].read_text()
  b.service(root,state,script,'stop');b.service(root,state,script,'stop')
  b.service(root,state,script,'remove');b.service(root,state,script,'remove')
  assert not list(root.glob('*.service')) and b.service(root,state,script,'status') is False
  assert len({call[-1] for call in calls if call[1]=='start'})==1
`);
});
