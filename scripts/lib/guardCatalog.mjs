/** D5505 (#5505): the ordered guard catalog consumed by CLI tools and wiring checks. */
import { readFileSync } from 'node:fs';
import { selectGuards } from './guardRunner.mjs';
export const GUARDS = JSON.parse(readFileSync(new URL('../guard-commands.json', import.meta.url), 'utf8'));
export const guardCommands = selectGuards(GUARDS).map(g => g.command.join(' '));
export const guardChain = guardCommands.join(' && ');
