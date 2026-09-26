import type { OpenAPIObject } from '@nestjs/swagger';
import { ERROR_RESPONSE_REF } from '../api-coded-error.js';
import { mergeAuthDocument, SESSION_COOKIE_SCHEME } from '../merge-auth-document.js';
import { stubAuth } from './stub-auth.js';

const BASE_PATH = '/api/v1/auth';

const nestDocument: OpenAPIObject = {
  openapi: '3.0.0',
  info: { title: 'API', version: '1' },
  paths: { '/health': { get: { responses: { '200': { description: 'ok' } } } } },
  components: { schemas: { ErrorResponse: { type: 'object' } } },
};

describe('mergeAuthDocument', () => {
  let merged: OpenAPIObject;

  beforeAll(async () => {
    const authDocument = await stubAuth().api.generateOpenAPISchema();
    merged = mergeAuthDocument(nestDocument, authDocument, BASE_PATH);
  });

  it('mounts Better Auth paths under its basePath and keeps ours', () => {
    expect(merged.paths['/health']).toBe(nestDocument.paths['/health']);
    expect(merged.paths[`${BASE_PATH}/sign-up/email`]?.post).toBeDefined();
    expect(merged.paths[`${BASE_PATH}/organization/list`]?.get).toBeDefined();
    expect(merged.paths['/sign-up/email']).toBeUndefined();
  });

  it('documents the session cookie as optional on every auth operation', () => {
    const signUp = merged.paths[`${BASE_PATH}/sign-up/email`]?.post;

    expect(signUp?.security).toEqual([{}, { [SESSION_COOKIE_SCHEME]: [] }]);
    expect(JSON.stringify(merged.paths)).not.toContain('bearerAuth');
  });

  it('points every auth error response at the coded envelope', () => {
    const signUp = merged.paths[`${BASE_PATH}/sign-up/email`]?.post;

    expect(signUp?.responses['400']).toEqual({
      description: expect.any(String),
      content: { 'application/json': { schema: { $ref: ERROR_RESPONSE_REF } } },
    });
    // Success bodies are Better Auth's own and stay as generated.
    expect(JSON.stringify(signUp?.responses['200'])).toContain('"user"');
  });

  it('files Better Auth tags under an Auth family', () => {
    expect(merged.paths[`${BASE_PATH}/sign-up/email`]?.post?.tags).toEqual(['Auth']);
    expect(merged.paths[`${BASE_PATH}/organization/list`]?.get?.tags).toEqual([
      'Auth: Organization',
    ]);
  });

  it('merges component schemas and keeps ours', () => {
    expect(merged.components?.schemas).toMatchObject({
      ErrorResponse: { type: 'object' },
      User: expect.any(Object),
      Organization: expect.any(Object),
    });
  });

  it('refuses to overwrite a schema defined on both sides', () => {
    const clashing = { ...nestDocument, components: { schemas: { User: { type: 'object' } } } };

    expect(() =>
      mergeAuthDocument(clashing, { paths: {}, components: { schemas: { User: {} } } }, BASE_PATH),
    ).toThrow('OpenAPI schema "User" is defined by both the API and Better Auth');
  });

  it('does not mutate the Nest document', () => {
    expect(Object.keys(nestDocument.paths)).toEqual(['/health']);
  });
});
