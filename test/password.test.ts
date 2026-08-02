import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';

describe('password hashing', () => {
  it('a hash verifies against its own password', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', encoded)).toBe(true);
  });

  it('a hash fails against a different password', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', encoded)).toBe(false);
  });

  it('the encoded format round-trips: pbkdf2$sha256$<iterations>$<salt>$<hash>', async () => {
    const encoded = await hashPassword('hunter2');
    const parts = encoded.split('$');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe('sha256');
    expect(Number(parts[2])).toBeGreaterThan(0);
    expect(parts[3].length).toBeGreaterThan(0);
    expect(parts[4].length).toBeGreaterThan(0);
  });

  it('two hashes of the same password are different (random salt)', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('rejects a malformed encoded string rather than throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });
});
