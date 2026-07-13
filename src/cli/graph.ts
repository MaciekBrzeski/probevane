import { runVaneCommand } from '../vane/run-command.js';

// Vane trampoline — spec + handler live in vane/commands.vane + src/commands/graph.ts.
runVaneCommand('graph');
