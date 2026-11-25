const { normalizePeriodQuotas, resolvePeriodSelections } = require('./antigravity-quota.cjs');

function getCollapsedSize(state) {
  const ids = Array.isArray(state?.dockMetricIds) ? state.dockMetricIds : [state?.dockMetricId || 'codex:weekly'];
  const providers = state?.enabledProviders?.length ? state.enabledProviders : ['codex', 'claude', 'gemini'];
  const periods = normalizePeriodQuotas(state?.quota?.gemini?.periodQuotas);
  const count = resolvePeriodSelections(state?.quota?.gemini, ids).filter((id) => {
    if (typeof id !== 'string') return false;
    const [provider, key] = id.split(':');
    const bucket = id.startsWith('gemini:quota:') ? periods.find(q => q.id === id.slice(13)) : state?.quota?.[provider]?.[key];
    return providers.includes(provider) && bucket && !bucket.hidden;
  }).length;
  const scale = [1, 1.25, 1.5].includes(state?.scale) ? state.scale : 1;
  return { width: 168, height: 182 + Math.max(0, count - 1) * 27 + Math.round(64 * (scale - 1)) };
}

module.exports = { getCollapsedSize };
