#!/usr/bin/env node
// Owner provisioning step AFTER both bot hosts exist. Default prints for review.
import { readFileSync, writeFileSync } from 'node:fs';
import { withMeetingBotBinding, withMeetingBotTopology } from './lib/meetingBotBinding.mjs';
const file=new URL('../wrangler.toml',import.meta.url);
if(process.argv.length>3||(process.argv[2]&&process.argv[2]!=='--write'))throw Error('invalid_arguments');
const topologyFile=new URL('../cloudflare-worker/src/services/topology.ts',import.meta.url);
// Validate both inputs before writing either file.
const output=withMeetingBotBinding(readFileSync(file,'utf8'));
const topology=withMeetingBotTopology(readFileSync(topologyFile,'utf8'));
if(process.argv[2]==='--write'){writeFileSync(file,output);writeFileSync(topologyFile,topology);}
else process.stdout.write('# Proposed wrangler.toml\n'+output+'\n// Proposed cloudflare-worker/src/services/topology.ts\n'+topology);
