import { describe, it, expect } from 'vitest';
import { redact } from '../src/distill/collect.js';

describe('redact', () => {
  it('redacts API_KEY=value pattern', () => {
    const input = 'API_KEY=sk-abc123abcdefabcdefabcdefabcdef';
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-abc123abcdefabcdefabcdefabcdef');
  });

  it('redacts api_key: value pattern (colon separated)', () => {
    const input = 'api_key: supersecretvaluethatislong';
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('supersecretvaluethatislong');
  });

  it('redacts token= pattern', () => {
    const input = 'token=abc123def456ghi789jkl012mno345pqr';
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('abc123def456ghi789jkl012mno345pqr');
  });

  it('redacts secret: value pattern', () => {
    const input = 'secret: myverysecretpasswordvaluexyz';
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('myverysecretpasswordvaluexyz');
  });

  it('redacts password= value pattern (short value)', () => {
    const input = 'password=hunter2short';
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('hunter2short');
  });

  it('redacts bearer token pattern', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9';
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('redacts standalone long hex run (>=32 chars)', () => {
    // This is a standalone long hex string not preceded by a key
    const longHex = 'abcdef1234567890abcdef1234567890';
    const input = `checksum: ${longHex}`;
    const result = redact(input);
    // "checksum" is not in the key pattern, but the 32-char hex value should be redacted
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain(longHex);
  });

  it('redacts standalone long base64 run (>=32 chars)', () => {
    const longBase64 = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9payload123456789ABCDEFGHIJ';
    const input = `some text with token ${longBase64} embedded`;
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain(longBase64);
  });

  it('leaves ordinary short text unchanged', () => {
    const input = 'Hello world, this is a normal sentence.';
    const result = redact(input);
    expect(result).toBe(input);
  });

  it('leaves short alphanumeric strings unchanged', () => {
    const input = 'user=alice count=42';
    const result = redact(input);
    expect(result).toBe(input);
  });

  it('redacts multiple secrets in one string', () => {
    const input = 'API_KEY=sk-abc123abcdefabcdefabcdefabcdef password=tooshort token=verylongtokenvalue1234567890abc';
    const result = redact(input);
    expect(result).not.toContain('sk-abc123abcdefabcdefabcdefabcdef');
    expect(result).not.toContain('tooshort');
    expect(result).not.toContain('verylongtokenvalue1234567890abc');
    const redactedCount = (result.match(/\[REDACTED\]/g) ?? []).length;
    expect(redactedCount).toBeGreaterThanOrEqual(3);
  });

  it('is case-insensitive for key names', () => {
    const input = 'TOKEN=SomeSecretValue123 Secret=AnotherOne456';
    const result = redact(input);
    expect(result).not.toContain('SomeSecretValue123');
    expect(result).not.toContain('AnotherOne456');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts a task string resembling a real API_KEY assignment', () => {
    const task = 'Run tests with API_KEY=sk-abc123abcdefabcdefabcdefabcdef and report results';
    const result = redact(task);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-abc123abcdefabcdefabcdefabcdef');
    // Non-secret parts are preserved
    expect(result).toContain('Run tests with');
    expect(result).toContain('and report results');
  });
});
