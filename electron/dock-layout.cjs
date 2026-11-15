function getCollapsedSize(state) {
  const ids = Array.isArray(state?.dockMetricIds) ? state.dockMetricIds : [state?.dockMetricId || 'codex:weekly'];
  const providers = state?.enabledProviders?.length ? state.enabledProviders : ['codex', 'claude', 'gemini'];
  const count = [...new Set(ids)].filter((id) => {
    if (typeof id !== 'string') return false;
    const [provider, key] = id.split(':');
    const bucket = state?.quota?.[provider]?.[key];
    return providers.includes(provider) && bucket && !bucket.hidden;
  }).length;
  const scale = [1, 1.25, 1.5].includes(state?.scale) ? state.scale : 1;
  return { width: 168, height: 182 + Math.max(0, count - 1) * 27 + Math.round(64 * (scale - 1)) };
}

module.exports = { getCollapsedSize };
