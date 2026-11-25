const MAX_QUOTAS = 64;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const LEGACY_METRIC = /^(?:codex:(?:fiveHour|weekly)|claude:(?:fiveHour|weekly|fable)|gemini:(?:fiveHour|weekly))$/;
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const safeText = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);

function normalizeMetricIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.slice(0, MAX_QUOTAS).filter(id => typeof id === 'string' && (LEGACY_METRIC.test(id)
    || (id.startsWith('gemini:quota:') && SAFE_ID.test(id.slice(13))))))].slice(0, MAX_QUOTAS);
}

function normalizePeriodQuotas(values) {
  if (!Array.isArray(values)) return [];
  const valid = values.slice(0, MAX_QUOTAS).filter(q => record(q) && typeof q.id === 'string' && SAFE_ID.test(q.id) && ['gemini', 'partner'].includes(q.family)
    && ['fiveHour', 'weekly'].includes(q.period) && safeText(q.modelLabel) && safeText(q.label)
    && safeText(q.resetLabel) && Number.isFinite(q.used) && q.used >= 0 && q.used <= 100
    && q.limit === 100 && q.unit === '%');
  return valid.filter((q, index) => valid.findIndex(other => other.id === q.id) === index).slice(0, MAX_QUOTAS)
    .map(q => ({ id: q.id, family: q.family, modelLabel: q.modelLabel, period: q.period, used: q.used,
      limit: 100, unit: '%', resetLabel: q.resetLabel, label: q.label }));
}

function parsePeriodQuotas(payload) {
  const groups = payload?.response?.groups ?? payload?.summary?.groups ?? payload?.groups;
  if (!Array.isArray(groups)) return [];
  const rows = groups.slice(0, 100).flatMap(group => {
    if (!record(group) || !Array.isArray(group.buckets)) return [];
    const name = safeText(group.displayName) ? group.displayName : safeText(group.name) ? group.name : '';
    const family = /gemini/i.test(name) ? 'gemini' : /claude|gpt|openai|sonnet|opus/i.test(name) ? 'partner' : null;
    if (!family) return [];
    return group.buckets.slice(0, 100).flatMap(bucket => {
      if (!record(bucket) || bucket.disabled === true) return [];
      const id = bucket.bucketId ?? bucket.id;
      // A countdown alone does not establish which rolling window it belongs to.
      const window = bucket.window ?? bucket.period;
      const period = ['5h', 'fiveHour'].includes(window) ? 'fiveHour' : ['weekly', '7d'].includes(window) ? 'weekly' : null;
      const remainingFraction = bucket.remainingFraction ?? bucket.remaining_fraction
        ?? bucket.remaining?.remainingFraction ?? bucket.remaining?.remaining_fraction
        ?? (bucket.remaining?.case === 'remainingFraction' ? bucket.remaining.value : undefined);
      if (typeof id !== 'string' || !SAFE_ID.test(id) || !period || !Number.isFinite(remainingFraction)
        || remainingFraction < 0 || remainingFraction > 1) return [];
      const reset = bucket.resetTime ?? bucket.reset_time;
      const resetTime = safeText(reset) && Number.isFinite(Date.parse(reset)) ? reset : undefined;
      return [{ id, family, modelLabel: family === 'gemini' ? 'Gemini 모델' : 'Claude · GPT 모델', period,
        remainingFraction, ...(resetTime ? { resetTime } : {}) }];
    });
  });
  // Conflicting duplicate source IDs cannot safely identify a checkbox.
  return rows.filter(q => rows.filter(other => other.id === q.id).length === 1).slice(0, MAX_QUOTAS)
    .sort((a, b) => a.family.localeCompare(b.family) || a.period.localeCompare(b.period) || a.id.localeCompare(b.id));
}

function resolvePeriodSelections(quota, values) {
  const rows = normalizePeriodQuotas(quota?.periodQuotas);
  return [...new Set(normalizeMetricIds(values).map(id => {
    const family = id === 'gemini:fiveHour' ? 'gemini' : id === 'gemini:weekly' ? 'partner' : null;
    const candidates = family ? rows.filter(q => q.family === family)
      .sort((a, b) => b.used - a.used || a.period.localeCompare(b.period) || a.id.localeCompare(b.id)) : [];
    return candidates.length ? `gemini:quota:${candidates[0].id}` : id;
  }))];
}

module.exports = { parsePeriodQuotas, normalizePeriodQuotas, normalizeMetricIds, resolvePeriodSelections };
