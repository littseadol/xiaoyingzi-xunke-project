import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, encoded] = stored.split(':');
  if (!salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sameSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isLoopback(address = ''): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

export function sessionCookie(header = ''): string {
  return (
    header
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('xy_session='))
      ?.slice(11) ?? ''
  );
}

export function hasSameOrigin(request: Pick<Request, 'headers'>): boolean {
  const origin = request.headers.origin;
  return Boolean(origin && origin === `https://${request.headers.host}`);
}
