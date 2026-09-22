import { CryptoService } from '../crypto.service.js';
import type { AppConfig } from '../../config/app.config.js';

const config = {
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig;

describe('CryptoService', () => {
  const crypto = new CryptoService(config);

  it('round-trips a page token', () => {
    const token = 'EAAG-page-access-token';
    expect(crypto.decrypt(crypto.encrypt(token))).toBe(token);
  });

  it('never produces the same ciphertext twice', () => {
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = Buffer.from(crypto.encrypt('secret'), 'base64');
    const lastByte = encrypted.length - 1;
    encrypted.writeUInt8(encrypted.readUInt8(lastByte) ^ 0xff, lastByte);
    expect(() => crypto.decrypt(encrypted.toString('base64'))).toThrow();
  });
});
