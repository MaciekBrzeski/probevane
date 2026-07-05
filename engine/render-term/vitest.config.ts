import { defineConfig } from 'vitest/config';

// CellPainter tests land in Phase 2; until then don't fail the gate on an empty suite.
export default defineConfig({ test: { passWithNoTests: true } });
