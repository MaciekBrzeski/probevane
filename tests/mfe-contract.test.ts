import { describe, it, expect } from 'vitest';
import { remoteContractTest, hostContractTest, exposeName } from '../src/mfe/contract.js';

describe('exposeName', () => {
  it('strips ./ and flattens slashes', () => {
    expect(exposeName('./Cart')).toBe('Cart');
    expect(exposeName('./ui/Button')).toBe('ui-Button');
    expect(exposeName('./')).toBe('default');
  });
});

describe('remoteContractTest', () => {
  it('typed: emits a compile-time conformance check', () => {
    const f = remoteContractTest('cart', './Cart', '../../src/Cart', { name: 'CartContract', from: 'cart-contracts' });
    expect(f.typed).toBe(true);
    expect(f.file).toBe('Cart.contract.test.ts');
    expect(f.content).toContain("import type { CartContract } from 'cart-contracts'");
    expect(f.content).toContain('const _conforms: CartContract');
    expect(f.content).toContain("describe('cart contract: ./Cart'");
  });

  it('structural: no type import, notes publishing a contract', () => {
    const f = remoteContractTest('cart', './Cart', '../../src/Cart');
    expect(f.typed).toBe(false);
    expect(f.content).not.toContain('import type');
    expect(f.content).toContain('structural');
    expect(f.content).toContain('expect(Exposed === undefined).toBe(false)');
  });
});

describe('hostContractTest', () => {
  it('mocks the federated specifier and consumes it', () => {
    const f = hostContractTest('host', 'cart', './Cart', { name: 'CartContract', from: '@mf-types/cart/Cart' });
    expect(f.file).toBe('cart-Cart.contract.test.ts');
    expect(f.content).toContain("vi.mock('cart/Cart'");
    expect(f.content).toContain("import Remote from 'cart/Cart'");
    expect(f.content).toContain('const _expects: CartContract');
    expect(f.content).toContain("describe('host ↔ cart contract: ./Cart'");
  });

  it('structural host test when no contract type', () => {
    const f = hostContractTest('host', 'cart', './Cart');
    expect(f.typed).toBe(false);
    expect(f.content).not.toContain('import type');
    expect(f.content).toContain("vi.mock('cart/Cart'");
  });
});
