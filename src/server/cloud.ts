import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { IceServer } from '../shared/types.js';
import type { Store } from './store.js';

export interface TurnOptions {
  urls: string[];
  secret: string;
}

export function normalizeOrigin(value: string): string {
  const address = new URL(value);
  if (
    address.protocol !== 'https:' ||
    address.username ||
    address.password ||
    address.pathname !== '/' ||
    address.search ||
    address.hash
  )
    throw new Error('云端网站地址必须是无路径、无账号信息的 HTTPS 地址');
  return address.origin;
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function turnServers(options?: TurnOptions, now = Date.now()): IceServer[] {
  if (!options) return [];
  if (
    options.secret.length < 32 ||
    !options.urls.length ||
    options.urls.some((url) => !/^turns?:[a-zA-Z0-9.[\]:-]+(?:\?transport=(udp|tcp))?$/.test(url))
  )
    throw new Error('TURN 配置需至少 32 位随机密钥及有效的 turn:/turns: 地址');
  const username = `${Math.floor(now / 1000) + 3600}:classroom`;
  return [
    {
      urls: options.urls,
      username,
      credential: createHmac('sha1', options.secret).update(username).digest('base64'),
    },
  ];
}

export class DeviceBinding {
  private invitation: { digest: string; expiresAt: number } | null = null;
  private attempts = 0;
  private resetAt = 0;

  constructor(private store: Store) {}

  issue(now = Date.now()): { code: string; expiresAt: string } {
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = now + 10 * 60000;
    this.invitation = { digest: tokenDigest(code), expiresAt };
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  claim(code: unknown, now = Date.now()): string {
    if (now >= this.resetAt) {
      this.attempts = 0;
      this.resetAt = now + 60000;
    }
    if (++this.attempts > 20) throw new Error('绑定尝试过多，请一分钟后再试');
    if (
      typeof code !== 'string' ||
      !this.invitation ||
      this.invitation.expiresAt <= now ||
      tokenDigest(code.trim().toUpperCase()) !== this.invitation.digest
    )
      throw new Error('绑定码不正确或已过期，请在网站重新生成');
    this.invitation = null;
    const token = randomBytes(32).toString('hex');
    this.store.set('deviceBinding', {
      digest: tokenDigest(token),
      pairedAt: new Date(now).toISOString(),
    });
    return token;
  }

  authorized(token: string): boolean {
    const binding = this.store.get<{ digest: string }>('deviceBinding');
    return Boolean(token.length === 64 && binding && tokenDigest(token) === binding.digest);
  }

  status(): { pairedAt: string | null } {
    return { pairedAt: this.store.get<{ pairedAt: string }>('deviceBinding')?.pairedAt ?? null };
  }

  revoke(): void {
    this.invitation = null;
    this.store.set('deviceBinding', null);
  }
}
