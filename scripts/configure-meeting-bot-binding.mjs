#!/usr/bin/env node
// Owner provisioning step AFTER both bot hosts exist. Default prints for review.
import { readFileSync, writeFileSync } from 'node:fs';
import { withMeetingBotBinding } from './lib/meetingBotBinding.mjs';
const file=new URL('../wrangler.toml',import.meta.url);
if(process.argv.length>3||(process.argv[2]&&process.argv[2]!=='--write'))throw Error('invalid_arguments');
const output=withMeetingBotBinding(readFileSync(file,'utf8'));
if(process.argv[2]==='--write')writeFileSync(file,output);else process.stdout.write(output);
