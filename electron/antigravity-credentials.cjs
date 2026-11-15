const MAX_INPUT = 64 * 1024;
const MAX_FIELDS = 128;
const SENTINEL = 'oauthTokenInfoSentinelKey';
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function base64(value) {
  if (typeof value !== 'string' || !value.length || value.length > MAX_INPUT || !BASE64.test(value)) throw new Error('format');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('format');
  return bytes;
}

function varint(bytes, start) {
  let value = 0n;
  for (let count = 0; count < 10; count++) {
    const index = start + count;
    if (index >= bytes.length) throw new Error('format');
    const byte = bytes[index];
    if (count === 9 && byte > 1) throw new Error('format');
    value |= BigInt(byte & 127) << BigInt(count * 7);
    if (!(byte & 128)) {
      if (count && byte === 0) throw new Error('format');
      return { value, offset: index + 1 };
    }
  }
  throw new Error('format');
}

function message(bytes, depth, available) {
  if (depth > 4 || bytes.length > MAX_INPUT) throw new Error('format');
  let offset = 0;
  let fields = [];
  let budget = available;
  while (offset < bytes.length) {
    if (--budget < 0) throw new Error('format');
    const tag = varint(bytes, offset);
    const number = tag.value >> 3n;
    const wire = Number(tag.value & 7n);
    if (number < 1n || number > 536870911n) throw new Error('format');
    offset = tag.offset;
    let value;
    if (wire === 0) {
      const integer = varint(bytes, offset);
      value = integer.value;
      offset = integer.offset;
    } else {
      let length;
      if (wire === 2) {
        const sized = varint(bytes, offset);
        if (sized.value > BigInt(MAX_INPUT)) throw new Error('format');
        offset = sized.offset;
        length = Number(sized.value);
      } else if (wire === 1 || wire === 5) {
        length = wire === 1 ? 8 : 4;
      } else { throw new Error('format'); }
      if (offset + length > bytes.length) throw new Error('format');
      value = bytes.subarray(offset, offset + length);
      offset += length;
    }
    fields = [...fields, { number: Number(number), wire, value }];
  }
  return { fields, budget };
}

function single(fields, number, wire) {
  const matches = fields.filter((field) => field.number === number);
  if (matches.length > 1 || (matches.length && matches[0].wire !== wire)) throw new Error('format');
  return matches[0]?.value;
}

function text(value) {
  if (value === undefined) return undefined;
  const string = value.toString('utf8');
  if (!Buffer.from(string, 'utf8').equals(value)) throw new Error('format');
  return string;
}

function oauthInfo(bytes, depth, available) {
  const parsed = message(bytes, depth, available);
  const accessToken = text(single(parsed.fields, 1, 2));
  const refreshToken = text(single(parsed.fields, 3, 2));
  const tokenType = text(single(parsed.fields, 2, 2));
  if (tokenType !== undefined && tokenType !== 'Bearer') throw new Error('format');
  if (accessToken !== undefined && !/^ya29\.[A-Za-z0-9._~+/=-]{1,8192}$/.test(accessToken)) throw new Error('format');
  if (refreshToken !== undefined && !/^1\/\/[A-Za-z0-9._~+/=-]{1,8192}$/.test(refreshToken)) throw new Error('format');
  const expiry = single(parsed.fields, 4, 2);
  const timestamp = expiry === undefined ? null : message(expiry, depth + 1, parsed.budget);
  if (timestamp) {
    const seconds = single(timestamp.fields, 1, 0);
    const nanos = single(timestamp.fields, 2, 0);
    if ((seconds !== undefined && seconds > 253402300799n) || (nanos !== undefined && nanos > 999999999n)) throw new Error('format');
  }
  return {
    tokens: accessToken || refreshToken ? {
      ...(accessToken ? { accessToken } : {}), ...(refreshToken ? { refreshToken } : {})
    } : null,
    budget: timestamp?.budget ?? parsed.budget
  };
}

function unified(outer) {
  let budget = outer.budget;
  let tokens = null;
  let matched = false;
  for (const field of outer.fields.filter((field) => field.number === 1)) {
    if (field.wire !== 2) throw new Error('format');
    const entry = message(field.value, 1, budget);
    budget = entry.budget;
    if (text(single(entry.fields, 1, 2)) !== SENTINEL) continue;
    if (matched) throw new Error('format');
    matched = true;
    const rowBytes = single(entry.fields, 2, 2);
    if (!rowBytes) throw new Error('format');
    const row = message(rowBytes, 2, budget);
    const encoded = text(single(row.fields, 1, 2));
    const result = oauthInfo(base64(encoded), 3, row.budget);
    budget = result.budget;
    tokens = result.tokens;
  }
  return tokens;
}

// Decode only the two known Antigravity protobuf envelopes. Never search
// arbitrary nested payloads, extract client secrets, or expose parsing errors.
function decodeAntigravityTokens(value) {
  try {
    const outer = message(base64(value), 0, MAX_FIELDS);
    const legacy = single(outer.fields, 6, 2);
    return legacy === undefined ? unified(outer) : oauthInfo(legacy, 1, outer.budget).tokens;
  } catch { return null; }
}

module.exports = { decodeAntigravityTokens };
