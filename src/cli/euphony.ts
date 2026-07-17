import { runVaneCommand } from '../vane/run-command.js';

// 2-line trampoline — the command surface + arg parsing live in vane/commands.vane
// (`command euphony`); the logic is src/commands/euphony.ts `run(ctx)`.
void runVaneCommand('euphony');
