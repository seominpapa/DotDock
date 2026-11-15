const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { queryAntigravityLocal } = require('../electron/antigravity-local.cjs');

const service = '/exa.language_server_pb.LanguageServerService/';
const legacy = (fraction = 0.7, email = 'synthetic@example.invalid') => ({ userStatus: {
  ...(email === undefined ? {} : { email }),
  cascadeModelConfigData: { clientModelConfigs: [
    { modelId: 'gemini-synthetic', label: 'Gemini Synthetic', quotaInfo: { remainingFraction: fraction, resetTime: '2030-01-01T00:00:00Z' } }
  ] }
} });

async function localServer(t, handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const entry = { path: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
    requests.push(entry);
    handler(entry, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const endpoint = { port: server.address().port, protocol: 'http:', csrfToken: 'synthetic-local-csrf', pid: 123 };
  return { requests, endpoint, options: { discoverEndpoints: async () => [endpoint] } };
}

function json(response, data, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}

test('local summary is queried first and legacy models provide explicit family quotas and identity', async t => {
  const local = await localServer(t, ({ path: requestPath }, response) => {
    if (requestPath.endsWith('RetrieveUserQuotaSummary')) json(response, {}, 404);
    else json(response, legacy());
  });
  const result = await queryAntigravityLocal(local.options);
  assert.equal(result.status, 'ok');
  assert.equal(result.accountLabel, 'synthetic@example.invalid');
  assert.deepEqual(result.models, { 'gemini-synthetic': { label: 'Gemini Synthetic', displayName: 'Gemini Synthetic',
    quotaInfo: { remainingFraction: 0.7, resetTime: '2030-01-01T00:00:00Z' } } });
  assert.deepEqual(local.requests.map(request => request.path), [service + 'RetrieveUserQuotaSummary', service + 'GetUserStatus']);
  assert.deepEqual(local.requests.map(request => request.body), [{ forceRefresh: true }, {
    metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: 'unknown', locale: 'en' }
  }]);
  assert.ok(local.requests.every(request => request.headers['x-codeium-csrf-token'] === 'synthetic-local-csrf'));
  assert.ok(local.requests.every(request => request.headers.authorization === undefined));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-local-csrf|cascadeModelConfigData|userStatus/);
});

test('explicit summary families preserve fractions and reset times without mixing legacy models', async t => {
  const local = await localServer(t, ({ path: requestPath }, response) => json(response,
    requestPath.endsWith('GetUserStatus') ? legacy(0.01) : { response: { groups: [
      { displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-5h', remainingFraction: 0.9 },
        { bucketId: 'gemini-weekly', remaining: { case: 'remainingFraction', value: 0 }, reset_time: '2030-01-01T00:00:00Z' }] },
      { name: 'Claude and GPT', buckets: [{ id: '3p-weekly', remaining: { remaining_fraction: 0.4 } }] }
    ] } }));
  const result = await queryAntigravityLocal(local.options);
  assert.equal(result.status, 'ok');
  assert.equal(result.accountLabel, 'synthetic@example.invalid');
  const models = Object.values(result.models);
  assert.deepEqual(models.map(model => model.quotaInfo.remainingFraction), [0.9, 0, 0.4]);
  assert.ok(models[0].displayName.includes('Gemini'));
  assert.ok(models[2].displayName.includes('Claude'));
  assert.equal(models[1].quotaInfo.resetTime, '2030-01-01T00:00:00Z');
  assert.equal(result.models['gemini-synthetic'], undefined);
});

test('unrecognized global cadence summary falls back without guessing a model family', async t => {
  const local = await localServer(t, ({ path: requestPath }, response) => json(response,
    requestPath.endsWith('GetUserStatus') ? legacy(0.6) : { summary: { groups: [{ name: 'Quota', buckets: [
      { id: '5h', remainingFraction: 0.1 }, { id: 'weekly', remainingFraction: 0.2 }
    ] }] } }));
  const result = await queryAntigravityLocal(local.options);
  assert.equal(result.status, 'ok');
  assert.deepEqual(Object.keys(result.models), ['gemini-synthetic']);
  assert.equal(result.models['gemini-synthetic'].quotaInfo.remainingFraction, 0.6);
});

test('missing or invalid fractions never fabricate zero usage and unverified identity stays absent', async t => {
  const local = await localServer(t, ({ path: requestPath }, response) => json(response,
    requestPath.endsWith('GetUserStatus') ? { userStatus: { name: 'not-an-email', email: 'invalid', cascadeModelConfigData: { clientModelConfigs: [
      { label: 'Gemini Missing', quotaInfo: { resetTime: '2030-01-01T00:00:00Z' } },
      { label: 'Gemini Negative', quotaInfo: { remainingFraction: -0.1 } },
      { label: 'Gemini Excess', quotaInfo: { remainingFraction: 1.1 } },
      { label: 'Gemini Wrong Type', quotaInfo: { remainingFraction: true } }
    ] } } } : { groups: [{ name: 'Gemini', buckets: [
      { id: 'disabled', disabled: true, remainingFraction: 0 },
      { id: 'unknown', resetTime: '2030-01-01T00:00:00Z' }
    ] }] }));
  assert.deepEqual(await queryAntigravityLocal(local.options), { status: 'no-quota' });
});

test('legacy quota without an email does not invent or copy identity from another field', async t => {
  const data = legacy(0.25);
  delete data.userStatus.email;
  data.userStatus.name = 'person@example.invalid';
  const local = await localServer(t, ({ path: requestPath }, response) => json(response,
    requestPath.endsWith('GetUserStatus') ? data : {}));
  const result = await queryAntigravityLocal(local.options);
  assert.equal(result.status, 'ok');
  assert.equal(result.accountLabel, undefined);
  assert.equal(Object.hasOwn(result, 'accountLabel'), false);
});

test('redirects are never followed, malformed payloads are sanitized, and unauthorized is explicit', async t => {
  let externalRequests = 0;
  const local = await localServer(t, ({ path: requestPath }, response) => {
    if (requestPath.endsWith('RetrieveUserQuotaSummary')) {
      response.writeHead(302, { Location: 'https://example.invalid/synthetic-secret' }).end();
    } else response.writeHead(200).end('{synthetic-secret');
  });
  assert.deepEqual(await queryAntigravityLocal(local.options), { status: 'unrecognized' });
  assert.equal(local.requests.length, 2);
  const forbidden = await localServer(t, (_request, response) => { externalRequests++; json(response, { error: 'synthetic-secret' }, 403); });
  assert.deepEqual(await queryAntigravityLocal(forbidden.options), { status: 'unauthorized' });
  assert.equal(externalRequests, 2);
});

test('response body size and absolute request deadlines are bounded', async t => {
  const oversized = await localServer(t, (_request, response) => response.writeHead(200).end(' '.repeat(1024 * 1024 + 1)));
  assert.deepEqual(await queryAntigravityLocal(oversized.options), { status: 'unrecognized' });
  const stalled = await localServer(t, (_request, response) => { response.writeHead(200); response.write('{'); });
  const started = performance.now();
  assert.deepEqual(await queryAntigravityLocal({ ...stalled.options, requestTimeoutMs: 30, overallTimeoutMs: 100 }), { status: 'unavailable' });
  assert.ok(performance.now() - started < 700);
});

test('no endpoints and stalled discovery fail closed within the overall deadline', async () => {
  assert.deepEqual(await queryAntigravityLocal({ discoverEndpoints: async () => [] }), { status: 'unavailable' });
  const started = performance.now();
  assert.deepEqual(await queryAntigravityLocal({ discoverEndpoints: () => new Promise(() => {}), overallTimeoutMs: 25 }), { status: 'unavailable' });
  assert.ok(performance.now() - started < 700);
});

test('HTTPS disables certificate validation only for the pinned loopback request and caps candidates', async () => {
  const requests = [];
  const httpsRequest = (options, callback) => {
    requests.push(options);
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => process.nextTick(() => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.headers = {};
      callback(response);
      response.end(JSON.stringify(options.path.endsWith('GetUserStatus') ? { userStatus: {} } : {}));
    });
    return request;
  };
  const endpoints = Array.from({ length: 7 }, (_, index) => ({ port: 40000 + index, protocol: 'https:', csrfToken: 'synthetic-csrf', pid: index + 1 }));
  assert.deepEqual(await queryAntigravityLocal({ discoverEndpoints: async () => endpoints, httpsRequest }), { status: 'no-quota' });
  assert.equal(requests.length, 6);
  assert.ok(requests.every(options => options.hostname === '127.0.0.1' && options.family === 4 && options.agent === false));
  assert.ok(requests.every(options => options.rejectUnauthorized === false && options.servername === ''));
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});

test('invalid endpoints and header injection are rejected before requesting', async () => {
  let requests = 0;
  const base = { port: 40000, protocol: 'https:', csrfToken: 'synthetic-csrf', pid: 1 };
  const invalid = [{ ...base, port: 0 }, { ...base, port: 65536 }, { ...base, port: 2.5 },
    { ...base, protocol: 'file:' }, { ...base, csrfToken: 'x\r\nAuthorization: secret' }, { ...base, csrfToken: '' }];
  assert.deepEqual(await queryAntigravityLocal({ discoverEndpoints: async () => invalid,
    httpsRequest: () => { requests++; throw new Error('must not request'); } }), { status: 'unavailable' });
  assert.equal(requests, 0);
});

test('duplicate model identifiers retain separate quota readings and epoch reset times', async t => {
  const local = await localServer(t, ({ path: requestPath }, response) => json(response,
    requestPath.endsWith('GetUserStatus') ? { userStatus: { cascadeModelConfigData: { clientModelConfigs: [
      { modelId: 'gemini-shared', label: 'Gemini Low', quotaInfo: { remainingFraction: 0.1, resetTime: '1893456000' } },
      { modelId: 'gemini-shared', label: 'Gemini High', quotaInfo: { remainingFraction: 0.9 } }
    ] } } } : {}));
  const result = await queryAntigravityLocal(local.options);
  assert.equal(result.status, 'ok');
  assert.deepEqual(Object.values(result.models).map(model => model.quotaInfo.remainingFraction), [0.1, 0.9]);
  assert.equal(Object.values(result.models)[0].quotaInfo.resetTime, '1893456000');
});

test('the whole query cancels active requests and never mixes another endpoint identity', async t => {
  const noQuota = await localServer(t, (_request, response) => json(response, { userStatus: { email: 'other@example.invalid' } }));
  const data = legacy(0.5);
  delete data.userStatus.email;
  const quotas = await localServer(t, ({ path: requestPath }, response) => json(response, requestPath.endsWith('GetUserStatus') ? data : {}));
  const result = await queryAntigravityLocal({ discoverEndpoints: async () => [noQuota.endpoint, quotas.endpoint] });
  assert.equal(result.status, 'ok');
  assert.equal(result.accountLabel, undefined);

  const stalled = await localServer(t, (_request, response) => { response.writeHead(200); response.write('{'); });
  const started = performance.now();
  assert.deepEqual(await queryAntigravityLocal({ discoverEndpoints: async () => [stalled.endpoint, stalled.endpoint, stalled.endpoint],
    requestTimeoutMs: 50, overallTimeoutMs: 75 }), { status: 'unavailable' });
  assert.ok(performance.now() - started < 700);
  assert.ok(stalled.requests.length <= 2);
});

test('declared excessive body length, interrupted connections and discovery errors are sanitized', async t => {
  const oversized = await localServer(t, (_request, response) => {
    response.writeHead(200, { 'Content-Length': 1024 * 1024 + 1 });
    response.flushHeaders();
  });
  assert.deepEqual(await queryAntigravityLocal(oversized.options), { status: 'unrecognized' });
  const interrupted = await localServer(t, (_request, response) => response.socket.destroy());
  assert.deepEqual(await queryAntigravityLocal(interrupted.options), { status: 'unavailable' });
  assert.deepEqual(await queryAntigravityLocal({ discoverEndpoints: async () => { throw new Error('synthetic-secret'); } }), { status: 'unavailable' });
});
