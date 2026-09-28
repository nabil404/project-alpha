import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../../config/app.config';
import {
  newOAuthState,
  openFlow,
  readCookie,
  sealFlow,
  stateMatches,
  type PageConnectFlow,
} from '../page-connect-flow';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);

const owner = { userId: 'user-a', merchantId: 'merchant-a' };
const now = 1_000_000;
const flow: PageConnectFlow = {
  stage: 'authorized',
  userToken: 'EAAG-user-token',
  ...owner,
  expiresAt: now + 60_000,
};

describe('page connect flow cookie', () => {
  it('round-trips for the seller and shop that started it', () => {
    expect(openFlow(crypto, sealFlow(crypto, flow), owner, now)).toEqual(flow);
  });

  it('never carries the user token in the clear', () => {
    expect(sealFlow(crypto, flow)).not.toContain('EAAG-user-token');
  });

  it('is ignored once expired', () => {
    expect(openFlow(crypto, sealFlow(crypto, flow), owner, flow.expiresAt)).toBeNull();
  });

  it('is ignored for another seller or another shop', () => {
    const sealed = sealFlow(crypto, flow);
    expect(openFlow(crypto, sealed, { ...owner, userId: 'user-b' }, now)).toBeNull();
    expect(openFlow(crypto, sealed, { ...owner, merchantId: 'merchant-b' }, now)).toBeNull();
  });

  it('is ignored when tampered with, missing or not ours', () => {
    const sealed = Buffer.from(sealFlow(crypto, flow), 'base64');
    sealed.writeUInt8(sealed.readUInt8(sealed.length - 1) ^ 0xff, sealed.length - 1);
    expect(openFlow(crypto, sealed.toString('base64'), owner, now)).toBeNull();
    expect(openFlow(crypto, undefined, owner, now)).toBeNull();
    expect(openFlow(crypto, 'not-base64-ciphertext', owner, now)).toBeNull();
    expect(openFlow(crypto, crypto.encrypt('{"stage":"other"}'), owner, now)).toBeNull();
  });

  it('matches the OAuth state exactly', () => {
    const state = newOAuthState();
    expect(stateMatches(state, state)).toBe(true);
    expect(stateMatches(state, `${state}x`)).toBe(false);
    expect(stateMatches(state, newOAuthState())).toBe(false);
    expect(stateMatches(state, undefined)).toBe(false);
  });
});

describe('readCookie', () => {
  it('finds one cookie among several and decodes it', () => {
    expect(readCookie('a=1; page_connect=ab%2Bc%3D; b=2', 'page_connect')).toBe('ab+c=');
  });

  it('answers undefined when absent or malformed', () => {
    expect(readCookie(undefined, 'page_connect')).toBeUndefined();
    expect(readCookie('a=1; xpage_connect=2', 'page_connect')).toBeUndefined();
    expect(readCookie('page_connect=%E0%A4%A', 'page_connect')).toBeUndefined();
  });
});
