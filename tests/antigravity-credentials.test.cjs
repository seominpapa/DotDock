const assert = require('node:assert/strict');
const { test } = require('node:test');
const { decodeAntigravityTokens } = require('../electron/antigravity-credentials.cjs');

const ACCESS = 'ya29.synthetic-access';
const REFRESH = '1//synthetic-refresh';
const SENTINEL = 'oauthTokenInfoSentinelKey';

function varint(number) {
  let value = BigInt(number);
  const bytes = [];
  do { bytes.push(Number(value & 127n) | (value > 127n ? 128 : 0)); value >>= 7n; } while (value);
  return Buffer.from(bytes);
}

function field(number, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}

function oauth(fields = []) {
  const timestamp = Buffer.concat([varint(8), varint(1800000000)]);
  return Buffer.concat([field(1, ACCESS), field(2, 'Bearer'), field(3, REFRESH), field(4, timestamp), ...fields]);
}

function entry(payload, sentinel = SENTINEL) {
  return Buffer.concat([field(1, sentinel), field(2, field(1, payload.toString('base64')))]);
}

function modern(payload = oauth(), sentinel = SENTINEL) {
  return field(1, entry(payload, sentinel)).toString('base64');
}

test('known unified-state sentinel decodes only access and refresh tokens', () => {
  const input = modern(oauth([field(5, 'private@example.invalid'), field(6, 'synthetic-client-secret')]));
  assert.deepEqual(decodeAntigravityTokens(input), { accessToken: ACCESS, refreshToken: REFRESH });
});

test('legacy jetski outer field six supports access-only and refresh-only credentials', () => {
  assert.deepEqual(decodeAntigravityTokens(field(6, oauth()).toString('base64')), { accessToken: ACCESS, refreshToken: REFRESH });
  assert.deepEqual(decodeAntigravityTokens(field(6, field(1, ACCESS)).toString('base64')), { accessToken: ACCESS });
  assert.deepEqual(decodeAntigravityTokens(field(6, field(3, REFRESH)).toString('base64')), { refreshToken: REFRESH });
});

test('unrelated entries never supply tokens and do not hide the known sentinel', () => {
  assert.equal(decodeAntigravityTokens(modern(oauth(), 'unrelatedSentinel')), null);
  const combined = Buffer.concat([field(1, entry(oauth(), 'unrelatedSentinel')), field(1, entry(oauth()))]);
  assert.deepEqual(decodeAntigravityTokens(combined.toString('base64')), { accessToken: ACCESS, refreshToken: REFRESH });
  assert.equal(decodeAntigravityTokens(field(5, oauth()).toString('base64')), null);
});

test('strict base64 rejects whitespace, invalid alphabet, bad padding, and noncanonical padding bits', () => {
  for (const input of [null, {}, Buffer.from('x'), '', `${modern()}\n`, `${modern()}!`, 'AB==', 'A===', 'AA=A', 'AAA']) {
    assert.equal(decodeAntigravityTokens(input), null);
  }
  const wrongInner = field(1, Buffer.concat([field(1, SENTINEL), field(2, field(1, 'AB=='))])).toString('base64');
  assert.equal(decodeAntigravityTokens(wrongInner), null);
});

test('truncated protobuf, invalid wire types, overflowing varints, and inconsistent lengths fail closed', () => {
  const malformed = [
    Buffer.from([0]), Buffer.from([11]), Buffer.from([10, 127, 1]),
    Buffer.from([...Array(10).fill(128), 1]),
    Buffer.from([8, ...Array(9).fill(255), 2]),
    Buffer.from([8, 128, 0]),
    Buffer.concat([Buffer.from([10]), varint(70000), Buffer.from([1])])
  ];
  for (const bytes of malformed) assert.equal(decodeAntigravityTokens(bytes.toString('base64')), null);
  const input = Buffer.from(modern(), 'base64');
  assert.equal(decodeAntigravityTokens(input.subarray(0, input.length - 1).toString('base64')), null);
});

test('invalid token prefixes, token types, and duplicate credential or sentinel fields are rejected', () => {
  for (const payload of [
    field(1, 'other-access-token'), field(3, 'other-refresh-token'),
    Buffer.concat([field(1, ACCESS), field(2, 'Basic')]),
    Buffer.concat([field(1, ACCESS), field(1, ACCESS)]),
    Buffer.from([8, 1]),
    Buffer.concat([field(1, ACCESS), field(4, Buffer.from([10, 1, 0]))])
  ]) assert.equal(decodeAntigravityTokens(modern(payload)), null);
  const duplicate = Buffer.concat([field(1, entry(oauth())), field(1, entry(oauth()))]);
  assert.equal(decodeAntigravityTokens(duplicate.toString('base64')), null);
});

test('input, known nesting, and aggregate field budgets prevent unbounded decoding', () => {
  assert.equal(decodeAntigravityTokens('A'.repeat(65540)), null);
  const excessive = oauth(Array.from({ length: 130 }, () => field(8, 'x')));
  assert.equal(decodeAntigravityTokens(modern(excessive)), null);
  let nested = oauth();
  for (let i = 0; i < 8; i++) nested = field(1, nested);
  assert.equal(decodeAntigravityTokens(modern(nested)), null);
});
