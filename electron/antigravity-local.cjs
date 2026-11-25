const http = require('node:http');
const https = require('node:https');
const { parsePeriodQuotas } = require('./antigravity-quota.cjs');

const SERVICE = '/exa.language_server_pb.LanguageServerService/';
const MAX_BYTES = 1024 * 1024;
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '';
const fraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
const family = value => /gemini/i.test(value) ? 'gemini' : /claude|gpt|openai|sonnet|opus/i.test(value) ? 'claude-gpt' : null;

function quotaInfo(remainingFraction, resetTime) {
  const reset = text(resetTime);
  const epoch = Number(reset);
  const validReset = reset && (Number.isFinite(Date.parse(reset)) || (/^\d+(?:\.\d+)?$/.test(reset) && epoch > 0 && epoch < 8.64e12));
  return { remainingFraction, ...(validReset ? { resetTime: reset } : {}) };
}

function summaryModels(payload) {
  const groups = payload?.response?.groups ?? payload?.summary?.groups ?? payload?.groups;
  if (!Array.isArray(groups)) return { recognized: false };
  const entries = [];
  let recognized = groups.length === 0;
  for (const [groupIndex, group] of groups.slice(0, 100).entries()) {
    if (!isRecord(group) || !Array.isArray(group.buckets)) continue;
    const groupLabel = text(group.displayName) || text(group.name);
    for (const [bucketIndex, bucket] of group.buckets.slice(0, 100).entries()) {
      if (!isRecord(bucket)) continue;
      const id = text(bucket.bucketId) || text(bucket.id);
      const label = [groupLabel, text(bucket.displayName) || text(bucket.name) || id].filter(Boolean).join(' ');
      const modelFamily = family(label);
      if (!modelFamily) continue;
      recognized = true;
      const raw = bucket.remainingFraction ?? bucket.remaining_fraction
        ?? bucket.remaining?.remainingFraction ?? bucket.remaining?.remaining_fraction
        ?? (bucket.remaining?.case === 'remainingFraction' ? bucket.remaining.value : undefined);
      const remaining = fraction(raw);
      if (!id || bucket.disabled === true || remaining === undefined) continue;
      entries.push([`${modelFamily}:summary:${groupIndex}:${bucketIndex}`, { label, displayName: label,
        quotaInfo: quotaInfo(remaining, bucket.resetTime ?? bucket.reset_time) }]);
    }
  }
  return { recognized, models: entries.length ? Object.fromEntries(entries) : undefined };
}

function legacyModels(payload) {
  const status = payload?.userStatus;
  if (!isRecord(status)) return { recognized: false };
  const rawEmail = typeof status.email === 'string' ? status.email.trim() : '';
  const accountLabel = rawEmail.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : undefined;
  const configs = status.cascadeModelConfigData?.clientModelConfigs;
  const entries = [];
  const ids = new Set();
  if (Array.isArray(configs)) for (const model of configs.slice(0, 1000)) {
    if (!isRecord(model) || model.isInternal === true) continue;
    const id = text(model.modelId) || text(model.id) || text(model.label);
    const label = text(model.label) || id;
    const modelFamily = family(`${id} ${label}`);
    const remaining = fraction(model.quotaInfo?.remainingFraction);
    if (!modelFamily || !id || /^(chat_|tab_)/.test(id) || remaining === undefined) continue;
    let key = id;
    for (let suffix = 1; ids.has(key); suffix++) key = `${id}:${suffix}`;
    ids.add(key);
    entries.push([key, { label, displayName: label, quotaInfo: quotaInfo(remaining, model.quotaInfo.resetTime) }]);
  }
  return { recognized: true, ...(accountLabel ? { accountLabel } : {}),
    models: entries.length ? Object.fromEntries(entries) : undefined };
}

function requestLocal(endpoint, method, options, signal) {
  return new Promise(resolve => {
    let request;
    let timer;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(result);
    };
    const stop = status => { finish({ status }); request?.destroy(); };
    const abort = () => stop('unavailable');
    if (signal.aborted) { finish({ status: 'unavailable' }); return; }
    const body = JSON.stringify(method === 'RetrieveUserQuotaSummary' ? { forceRefresh: true } : {
      metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: 'unknown', locale: 'en' }
    });
    const secure = endpoint.protocol === 'https:';
    const requestOptions = { protocol: endpoint.protocol, hostname: '127.0.0.1', family: 4, port: endpoint.port,
      method: 'POST', path: SERVICE + method, agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'Accept-Encoding': 'identity', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': endpoint.csrfToken },
      ...(secure ? { rejectUnauthorized: false, servername: '' } : {}) };
    try {
      request = (secure ? options.httpsRequest || https.request : options.httpRequest || http.request)(requestOptions, response => {
        response.on('error', () => stop('unavailable'));
        if (response.statusCode === 401 || response.statusCode === 403) { stop('unauthorized'); return; }
        if (response.statusCode !== 200) { stop('unavailable'); return; }
        const length = response.headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_BYTES)) { stop('unrecognized'); return; }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_BYTES) { stop('unrecognized'); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            finish(isRecord(payload) ? { status: 'ok', payload } : { status: 'unrecognized' });
          } catch { finish({ status: 'unrecognized' }); }
        });
      });
      request.on('error', () => stop('unavailable'));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, options.requestTimeoutMs);
      request.end(body);
    } catch { stop('unavailable'); }
  });
}

function validEndpoint(endpoint) {
  return isRecord(endpoint) && Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port <= 65535
    && ['http:', 'https:'].includes(endpoint.protocol) && typeof endpoint.csrfToken === 'string'
    && endpoint.csrfToken.length > 0 && endpoint.csrfToken.length <= 1024 && !/[\x00-\x1f\x7f]/.test(endpoint.csrfToken);
}

async function discover(options, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 2000);
  try {
    return await new Promise(resolve => {
      controller.signal.addEventListener('abort', () => resolve([]), { once: true });
      if (signal.aborted) { abort(); return; }
      const discovery = options.discoverEndpoints || require('./antigravity-process.cjs').discoverAntigravityEndpoints;
      Promise.resolve().then(() => discovery({ signal: controller.signal })).then(
        endpoints => resolve(Array.isArray(endpoints) ? endpoints.filter(validEndpoint).slice(0, 3) : []), () => resolve([]));
    });
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

async function queryAntigravityLocal(options = {}) {
  const controller = new AbortController();
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) ? Math.max(1, Math.min(2000, options.requestTimeoutMs)) : 2000;
  const overallTimeoutMs = Number.isFinite(options.overallTimeoutMs) ? Math.max(1, Math.min(6000, options.overallTimeoutMs)) : 6000;
  const boundedOptions = { ...options, requestTimeoutMs };
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => {
    controller.abort(); resolve({ status: 'unavailable' });
  }, overallTimeoutMs); });
  const run = async () => {
    const endpoints = await discover(boundedOptions, controller.signal);
    let failure = { status: 'unavailable' };
    const rank = { unavailable: 0, unrecognized: 1, 'no-quota': 2, unauthorized: 3 };
    for (const endpoint of endpoints) {
      if (controller.signal.aborted) break;
      const summary = await requestLocal(endpoint, 'RetrieveUserQuotaSummary', boundedOptions, controller.signal);
      const status = await requestLocal(endpoint, 'GetUserStatus', boundedOptions, controller.signal);
      const current = status.status === 'ok' ? legacyModels(status.payload) : { recognized: false };
      const parsed = summary.status === 'ok' ? summaryModels(summary.payload) : { recognized: false };
      const models = parsed.models || current.models;
      const identity = current.accountLabel ? { accountLabel: current.accountLabel } : {};
      const periodQuotas = summary.status === 'ok' ? parsePeriodQuotas(summary.payload) : [];
      if (models) return { status: 'ok', ...identity, models, ...(periodQuotas.length ? { periodQuotas } : {}) };
      const category = [summary.status, status.status].includes('unauthorized') ? 'unauthorized'
        : parsed.recognized || current.recognized ? 'no-quota'
          : [summary.status, status.status].some(value => ['ok', 'unrecognized'].includes(value)) ? 'unrecognized' : 'unavailable';
      if (rank[category] > rank[failure.status]) failure = { status: category, ...identity };
    }
    return failure;
  };
  try { return await Promise.race([run(), deadline]); }
  catch { return { status: 'unavailable' }; }
  finally { clearTimeout(timer); controller.abort(); }
}

module.exports = { queryAntigravityLocal };
