import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSameOrigin,
  isLoopback,
  passwordHash,
  passwordMatches,
  sameSecret,
  sessionCookie,
} from '../src/server/security.js';

test('密码独立盐化，正确密码才能通过', () => {
  const first = passwordHash('test-password');
  assert.notEqual(first, passwordHash('test-password'));
  assert.equal(passwordMatches('test-password', first), true);
  assert.equal(passwordMatches('wrong', first), false);
  assert.equal(passwordMatches('test-password', 'invalid'), false);
});

test('进程令牌精确比较，回环地址不接受局域网冒充', () => {
  assert.equal(sameSecret('secret', 'secret'), true);
  assert.equal(sameSecret('', 'secret'), false);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('192.168.1.100'), false);
});

test('Cookie 提取精确命中，同源检查拒绝跨站和缺失来源', () => {
  assert.equal(sessionCookie('other=value; xy_session=token; third=value'), 'token');
  assert.equal(sessionCookie('not_xy_session=token'), '');
  assert.equal(
    hasSameOrigin({ headers: { host: 'localhost:8443', origin: 'https://localhost:8443' } }),
    true,
  );
  assert.equal(
    hasSameOrigin({ headers: { host: 'localhost:8443', origin: 'https://other.test' } }),
    false,
  );
  assert.equal(hasSameOrigin({ headers: { host: 'localhost:8443' } }), false);
});
