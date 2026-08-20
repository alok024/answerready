import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIP, assertPublicUrl } from './ssrf';

test('IPv4 private ranges are blocked', () => {
  assert.equal(isBlockedIP('10.0.0.1'), true);
  assert.equal(isBlockedIP('10.255.255.255'), true);
  assert.equal(isBlockedIP('172.16.0.1'), true);
  assert.equal(isBlockedIP('172.31.255.255'), true);
  assert.equal(isBlockedIP('192.168.0.1'), true);
  assert.equal(isBlockedIP('192.168.255.255'), true);

  assert.equal(isBlockedIP('172.15.255.255'), false, 'just below 172.16/12');
  assert.equal(isBlockedIP('172.32.0.0'), false, 'just above 172.16/12');
  assert.equal(isBlockedIP('192.167.255.255'), false, 'not 192.168/16');
  assert.equal(isBlockedIP('11.0.0.0'), false, 'not 10/8');
});

test('IPv4 loopback is blocked', () => {
  assert.equal(isBlockedIP('127.0.0.1'), true);
  assert.equal(isBlockedIP('127.255.255.255'), true);
});

test('IPv4 link-local (169.254/16) is blocked', () => {
  assert.equal(isBlockedIP('169.254.0.1'), true);
  assert.equal(isBlockedIP('169.254.169.254'), true, 'cloud metadata address');
  assert.equal(isBlockedIP('169.253.255.255'), false, 'just below 169.254/16');
  assert.equal(isBlockedIP('169.255.0.0'), false, 'just above 169.254/16');
});

test('IPv4 CGNAT range (100.64/10) is blocked at its exact boundaries', () => {
  assert.equal(isBlockedIP('100.64.0.0'), true);
  assert.equal(isBlockedIP('100.100.0.1'), true);
  assert.equal(isBlockedIP('100.127.255.255'), true);
  assert.equal(isBlockedIP('100.63.255.255'), false, 'just below 100.64/10');
  assert.equal(isBlockedIP('100.128.0.0'), false, 'just above 100.64/10');
});

test('0.0.0.0 and the rest of 0/8 are blocked', () => {
  assert.equal(isBlockedIP('0.0.0.0'), true);
  assert.equal(isBlockedIP('0.1.2.3'), true);
});

test('ordinary public IPv4 addresses are not blocked', () => {
  assert.equal(isBlockedIP('8.8.8.8'), false);
  assert.equal(isBlockedIP('1.1.1.1'), false);
  assert.equal(isBlockedIP('93.184.216.34'), false);
});

test('IPv6 loopback and unspecified are blocked', () => {
  assert.equal(isBlockedIP('::1'), true);
  assert.equal(isBlockedIP('::'), true);
});

test('IPv6 link-local (fe80::/10) is blocked', () => {
  assert.equal(isBlockedIP('fe80::1'), true);
  assert.equal(isBlockedIP('FE80::1'), true, 'case-insensitive');
});

test('IPv6 unique local (fc00::/7) is blocked', () => {
  assert.equal(isBlockedIP('fc00::1'), true);
  assert.equal(isBlockedIP('fd12:3456:789a::1'), true);
});

test('ordinary public IPv6 addresses are not blocked', () => {
  assert.equal(isBlockedIP('2606:4700:4700::1111'), false);
  assert.equal(isBlockedIP('2001:4860:4860::8888'), false);
});

test('IPv4-mapped IPv6 in dotted-decimal notation resolves through to the IPv4 check', () => {
  assert.equal(isBlockedIP('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedIP('::ffff:10.0.0.1'), true);
  assert.equal(isBlockedIP('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedIP('::ffff:8.8.8.8'), false);
});

test('IPv4-mapped IPv6 in canonical hex-group notation resolves through to the IPv4 check', () => {
  assert.equal(isBlockedIP('::ffff:7f00:1'), true, '::ffff:7f00:1 is 127.0.0.1');
  assert.equal(isBlockedIP('::ffff:a9fe:a9fe'), true, '::ffff:a9fe:a9fe is 169.254.169.254');
  assert.equal(isBlockedIP('::ffff:c0a8:101'), true, '::ffff:c0a8:101 is 192.168.1.1');
  assert.equal(isBlockedIP('::ffff:808:808'), false, '::ffff:808:808 is 8.8.8.8, a public address');
});

test('WHATWG URL serializes IPv4-mapped IPv6 hosts to hex-group form, and assertPublicUrl still blocks them', async () => {
  const canonical = new URL('http://[::ffff:169.254.169.254]/').hostname;
  assert.equal(canonical, '[::ffff:a9fe:a9fe]', 'this is what the runtime actually sees as the hostname');

  await assert.rejects(
    () => assertPublicUrl('http://[::ffff:169.254.169.254]/'),
    /non-public address/,
    'the metadata-service address must stay blocked after URL normalization',
  );
  await assert.rejects(
    () => assertPublicUrl('http://[::ffff:127.0.0.1]/'),
    /non-public address/,
  );
});

test('non-IP input is rejected safe-by-default', () => {
  assert.equal(isBlockedIP('example.com'), true);
});
