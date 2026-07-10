import { describe, it, expect, vi, beforeEach } from 'vitest';

const fimComplete = vi.fn();
const brainComplete = vi.fn();
vi.mock('../brain/openai-compat.js', () => ({ fimComplete: (...a: unknown[]) => fimComplete(...a) }));
vi.mock('../brain/select.js', () => ({ brainFor: () => ({ complete: brainComplete }) }));

const { planFeature, renderMarkdown } = await import('./planner.js');

describe('planFeature', () => {
  beforeEach(() => {
    fimComplete.mockReset();
    brainComplete.mockReset();
  });

  it('FIM path: infills the middle and reports mode "fim"', async () => {
    fimComplete.mockResolvedValue('Add route\n2. Add handler\n3. Add test');
    const plan = await planFeature('current', 'desired', { model: 'local:coder', mode: 'fim' });
    expect(plan.mode).toBe('fim');
    expect(plan.steps.map((s) => s.title)).toEqual(['Add route', 'Add handler', 'Add test']);
    expect(brainComplete).not.toHaveBeenCalled();
  });

  it('auto: falls back to chat when FIM is unavailable', async () => {
    fimComplete.mockRejectedValue(new Error('model has no FIM'));
    brainComplete.mockResolvedValue({ text: '1. Scaffold\n2. Implement\n3. Verify' });
    const plan = await planFeature('current', 'desired', { model: 'local:x', mode: 'auto' });
    expect(plan.mode).toBe('chat');
    expect(plan.steps).toHaveLength(3);
    expect(fimComplete).toHaveBeenCalledOnce();
    expect(brainComplete).toHaveBeenCalledOnce();
  });

  it('chat mode never touches FIM', async () => {
    brainComplete.mockResolvedValue({ text: '1. only step' });
    const plan = await planFeature('a', 'b', { model: 'local:x', mode: 'chat' });
    expect(plan.mode).toBe('chat');
    expect(fimComplete).not.toHaveBeenCalled();
  });

  it('mode "fim" throws instead of falling back when FIM yields nothing', async () => {
    fimComplete.mockRejectedValue(new Error('empty'));
    await expect(planFeature('a', 'b', { model: 'local:x', mode: 'fim' })).rejects.toThrow(/FIM/);
    expect(brainComplete).not.toHaveBeenCalled();
  });

  it('throws when the chat path produces no steps', async () => {
    brainComplete.mockResolvedValue({ text: 'sorry, cannot help' });
    await expect(planFeature('a', 'b', { model: 'local:x', mode: 'chat' })).rejects.toThrow(/no steps/);
  });

  it('renderMarkdown emits the state sections and bolded steps', async () => {
    fimComplete.mockResolvedValue('First\n2. Second');
    const plan = await planFeature('CUR', 'DES', { model: 'local:c', mode: 'fim' });
    const md = renderMarkdown(plan);
    expect(md).toContain('## Current state');
    expect(md).toContain('CUR');
    expect(md).toContain('## Desired state');
    expect(md).toContain('1. **First**');
    expect(md).toContain('2. **Second**');
  });
});
