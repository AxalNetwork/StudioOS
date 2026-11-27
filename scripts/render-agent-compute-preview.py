"""D4557 part 3: validate and render the disabled owner-approved preview config.

This only writes local configuration. Image authentication and remote deployment
remain separate protected workflow steps. Never prints configuration or env data.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import tomllib


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def render(template, values):
    require(values.get('SCHEDULING_POLICY') == 'durable_object', 'scheduling decision missing')
    account = values.get('CLOUDFLARE_ACCOUNT_ID', '')
    require(re.fullmatch(r'[a-f0-9]{32}', account), 'isolated account missing')
    source = re.fullmatch(r'ghcr\.io/axalnetwork/studioos-agent-compute@sha256:([a-f0-9]{64})', values.get('SOURCE_IMAGE_REF', ''))
    target = re.fullmatch(r'registry\.cloudflare\.com/([a-f0-9]{32})/studioos-agent-compute@sha256:([a-f0-9]{64})', values.get('IMAGE_REF', ''))
    require(source and target and target[1] == account and source[1] == target[2], 'pinned image copy mismatch')
    require(re.fullmatch(r'AxalNetwork/StudioOS/\.github/workflows/[a-z0-9_-]+\.yml', values.get('IMAGE_SIGNER_WORKFLOW', '')), 'image signer missing')
    names = [values.get(key, '') for key in ['HOST_NAME', 'BROKER_NAME']]
    require(all(re.fullmatch(r'studioos-[a-z0-9-]*preview[a-z0-9-]*', name) and len(name) <= 63 for name in names)
            and len(set(names)) == 2, 'separate preview names required')
    config = copy.deepcopy(template)
    require(set(config.get('env', {})) == {'preview'}, 'preview-only config required')
    preview = config['env']['preview']
    for settings in [config.get('vars', {}), preview.get('vars', {})]:
        require(settings.get('COMPUTE_ENABLED') == 'off'
                and settings.get('COMPUTE_SCHEDULING_POLICY') == 'durable_object', 'disabled policy mismatch')
    require(config.get('workers_dev') is False and config.get('preview_urls') is False
            and preview.get('workers_dev') is False and preview.get('preview_urls') is False, 'private host required')
    apps = preview.get('containers', [])
    require(len(apps) == 2 and {app.get('class_name') for app in apps}
            == {'PythonComputeContainer', 'DocumentComputeContainer'}, 'compute applications missing')
    for app in apps:
        require(set(app) == {'class_name', 'scheduling_policy', 'images'}
                and app['scheduling_policy'] == 'durable_object', 'unsupported application fields')
        require(app['images'] == {'runtime': {'dockerfile': './agent-compute/Dockerfile', 'build_context': './agent-compute'}}, 'runtime image template mismatch')
        app['images'] = {'runtime': {'image': values['IMAGE_REF']}}
    bindings = preview.get('durable_objects', {}).get('bindings', [])
    require({(item.get('name'), item.get('class_name')) for item in bindings}
            == {('COMPUTE_PYTHON', 'PythonComputeContainer'), ('COMPUTE_DOCUMENTS', 'DocumentComputeContainer')}
            and len(bindings) == 2, 'container bindings mismatch')
    migrations = preview.get('migrations', [])
    require(any(set(item.get('new_sqlite_classes', [])) == {'PythonComputeContainer', 'DocumentComputeContainer'} for item in migrations), 'SQLite classes required')
    require(preview.get('services') == [{'binding': 'BROKER', 'service': 'studioos-preview'}], 'broker template mismatch')
    preview['name'], preview['services'][0]['service'] = names
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        config = render(tomllib.loads(Path(args.config).read_text()), os.environ)
        Path(args.output).write_text(json.dumps(config, indent=2) + '\n')
    except (ValueError, KeyError, TypeError, OSError):
        parser.exit(1, 'compute preview configuration refused\n')


if __name__ == '__main__':
    main()
