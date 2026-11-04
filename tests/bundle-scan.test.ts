/** The bundle scanner must catch a privileged credential and must not fail on public values. */
import { describe, expect, it } from 'vitest';
import { isInfo, scanText } from '../scripts/cto/scan-bundle.mjs';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref: 'lxbcynzgeuqzmynkuzqg', role })}.c2lnbmF0dXJlLXZhbHVl`;
const failing = (text: string, env: Record<string, string> = {}) => scanText(text, env).filter((k: string) => !isInfo(k));

describe('bundle scanner', () => {
  it('flags a service-role JWT and allows the public anon key', () => {
    expect(failing(`const k="${jwt('service_role')}"`)).toContain('jwt:service_role');
    expect(failing(`const k="${jwt('anon')}"`)).toEqual([]);
  });

  it('flags secret-key shapes and the literal value of a server secret from the environment', () => {
    expect(failing('x="sb_secret_abcdefghijklmnop"')).toContain('supabase_secret_key');
    expect(failing('x="sk-or-abcdefghijklmnop"')).toContain('openrouter_key');
    expect(failing('x="a-very-long-cron-secret-value"', { CRON_SECRET: 'a-very-long-cron-secret-value' })).toContain('value:CRON_SECRET');
  });

  it('fails on the service-role variable name but reports other variable names as information only', () => {
    expect(failing('process.env.SUPABASE_SERVICE_ROLE_KEY')).toContain('name:SUPABASE_SERVICE_ROLE_KEY');
    const found = scanText('label: "CRON_SECRET: protects the daily job"', {});
    expect(found).toEqual(['name:CRON_SECRET']);
    expect(found.every(isInfo)).toBe(true);
  });

  it('does not match a longer identifier that merely contains a variable name', () => {
    expect(scanText('MY_CRON_SECRET_LABEL', {})).toEqual([]);
  });
});
