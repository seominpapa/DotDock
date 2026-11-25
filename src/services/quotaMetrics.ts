import type { AntigravityPeriodQuota, DockMetricId, DockMetricKey, DotDockState, ProviderId, QuotaBucket } from '../types/dotdock';

const MAX_QUOTA_ROWS = 64;
const SAFE_BUCKET_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const LEGACY_METRIC_ID = /^(?:codex:(?:fiveHour|weekly)|claude:(?:fiveHour|weekly|fable)|gemini:(?:fiveHour|weekly))$/;
const isDisplayText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);

export function normalizeAntigravityPeriodQuotas(value: unknown): AntigravityPeriodQuota[] {
  if (!Array.isArray(value)) return [];
  const rows = value.slice(0, MAX_QUOTA_ROWS).filter((row): row is AntigravityPeriodQuota =>
    Boolean(row) && typeof row === 'object' && !Array.isArray(row)
    && typeof row.id === 'string' && SAFE_BUCKET_ID.test(row.id)
    && (row.family === 'gemini' || row.family === 'partner')
    && (row.period === 'fiveHour' || row.period === 'weekly')
    && isDisplayText(row.modelLabel) && isDisplayText(row.label) && isDisplayText(row.resetLabel)
    && typeof row.used === 'number' && Number.isFinite(row.used) && row.used >= 0 && row.used <= 100
    && row.limit === 100 && row.unit === '%');
  return rows.filter((row, index) => rows.findIndex(other => other.id === row.id) === index)
    .map(row => ({ id: row.id, family: row.family, modelLabel: row.modelLabel, period: row.period,
      used: row.used, limit: 100, unit: '%', resetLabel: row.resetLabel, label: row.label }));
}

export function normalizeDockMetricIds(value: unknown): DockMetricId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_QUOTA_ROWS).filter((id): id is DockMetricId =>
    typeof id === 'string' && (LEGACY_METRIC_ID.test(id)
      || (id.startsWith('gemini:quota:') && SAFE_BUCKET_ID.test(id.slice('gemini:quota:'.length))))))];
}

export interface DockMetricOption {
  id: DockMetricId;
  provider: ProviderId;
  providerTitle: string;
  shortProvider: string;
  bucketKey: DockMetricKey;
  label: string;
  shortLabel: string;
  usedPercent: number;
  remainingPercent: number;
  color: string;
  bucket: QuotaBucket;
}

type DockMetricCandidate = Omit<DockMetricOption, 'label' | 'usedPercent' | 'remainingPercent'> & { defaultLabel: string };

function getAntigravityCandidates(state: DotDockState): DockMetricCandidate[] {
  const periodQuotas = normalizeAntigravityPeriodQuotas(state.quota.gemini.periodQuotas);
  if (periodQuotas.length) return periodQuotas.map(bucket => ({
    id: `gemini:quota:${bucket.id}`,
    provider: 'gemini', providerTitle: 'Antigravity · Gemini',
    shortProvider: bucket.family === 'gemini' ? 'Gemini' : 'Antigravity',
    bucketKey: 'quota', defaultLabel: bucket.label,
    shortLabel: `${bucket.family === 'gemini' ? 'Gemini' : 'AG C/G'} ${bucket.period === 'fiveHour' ? '5h' : '7d'}`,
    color: bucket.family === 'gemini' ? '#38bdf8' : '#60a5fa', bucket
  }));
  return ([['fiveHour', 'Gemini 모델', 'Gemini', '#38bdf8'],
    ['weekly', 'Claude · GPT 모델', 'Claude·GPT', '#60a5fa']] as const).map(([key, label, shortLabel, color]) => {
    const bucket = state.quota.gemini[key];
    const oldLabel = bucket.label || label;
    return { id: `gemini:${key}`, provider: 'gemini', providerTitle: 'Antigravity · Gemini',
      shortProvider: key === 'fiveHour' ? 'Gemini' : 'Antigravity', bucketKey: key,
      defaultLabel: label, shortLabel, color,
      bucket: { ...bucket, label: oldLabel.includes('기간 미제공') ? oldLabel : `${oldLabel} · 기간 미제공` } };
  });
}

export function getBucketUsedPercent(bucket: QuotaBucket): number {
  if (!bucket.limit || bucket.limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((bucket.used / bucket.limit) * 100)));
}

export function getBucketRemainingPercent(bucket: QuotaBucket): number {
  return Math.max(0, 100 - getBucketUsedPercent(bucket));
}

function formatClaudeModelShortLabel(bucket: QuotaBucket): string {
  const raw = bucket.label || '';
  if (/sonnet/i.test(raw)) return 'Claude Sonnet';
  if (/opus/i.test(raw)) return 'Claude Opus';
  if (/omelette/i.test(raw)) return 'Claude Omelette';
  return 'Claude Fable';
}

export function getAvailableDockMetrics(
  state: DotDockState,
  includeAllProviders = false
): DockMetricOption[] {
  const { quota } = state;
  const enabledProviders = (state.enabledProviders?.length
    ? state.enabledProviders
    : ['codex', 'claude', 'gemini']) as ProviderId[];

  const allCandidates: DockMetricCandidate[] = [
    {
      id: 'codex:fiveHour',
      provider: 'codex',
      providerTitle: 'ChatGPT · Codex',
      shortProvider: 'Codex',
      bucketKey: 'fiveHour',
      defaultLabel: '5시간 (5h)',
      shortLabel: 'Codex 5h',
      color: '#10b981',
      bucket: quota.codex.fiveHour
    },
    {
      id: 'codex:weekly',
      provider: 'codex',
      providerTitle: 'ChatGPT · Codex',
      shortProvider: 'Codex',
      bucketKey: 'weekly',
      defaultLabel: '주간 한도 (7d)',
      shortLabel: 'Codex 7d',
      color: '#10b981',
      bucket: quota.codex.weekly
    },
    {
      id: 'claude:fiveHour',
      provider: 'claude',
      providerTitle: 'Claude',
      shortProvider: 'Claude',
      bucketKey: 'fiveHour',
      defaultLabel: '5시간 (5h)',
      shortLabel: 'Claude 5h',
      color: '#f59e0b',
      bucket: quota.claude.fiveHour
    },
    {
      id: 'claude:weekly',
      provider: 'claude',
      providerTitle: 'Claude',
      shortProvider: 'Claude',
      bucketKey: 'weekly',
      defaultLabel: '일주일 (7d)',
      shortLabel: 'Claude 7d',
      color: '#f59e0b',
      bucket: quota.claude.weekly
    },
    {
      id: 'claude:fable',
      provider: 'claude',
      providerTitle: 'Claude',
      shortProvider: 'Claude',
      bucketKey: 'fable',
      defaultLabel: '모델별 한도',
      shortLabel: formatClaudeModelShortLabel(quota.claude.fable),
      color: '#a855f7',
      bucket: quota.claude.fable
    },
    ...getAntigravityCandidates(state)
  ];

  const nonHidden = allCandidates.filter((item) => !item.bucket.hidden);
  const filtered = includeAllProviders
    ? nonHidden
    : nonHidden.filter((item) => enabledProviders.includes(item.provider));
  const pool = filtered.length > 0 ? filtered : nonHidden;

  return pool.map((item) => {
    const usedPercent = getBucketUsedPercent(item.bucket);
    return {
      id: item.id,
      provider: item.provider,
      providerTitle: item.providerTitle,
      shortProvider: item.shortProvider,
      bucketKey: item.bucketKey,
      label: item.bucket.label || item.defaultLabel,
      shortLabel: item.shortLabel,
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      color: item.color,
      bucket: item.bucket
    };
  });
}

export function resolveActiveDockMetric(state: DotDockState): DockMetricOption | null {
  const available = getAvailableDockMetrics(state);
  if (available.length === 0) return null;
  if (state.dockMetricId) {
    const matched = available.find((m) => m.id === getSelectedDockMetricIds(state)[0]);
    if (matched) return matched;
  }
  return available[0];
}

export function getSelectedDockMetricIds(state: DotDockState): DockMetricId[] {
  const selected = normalizeDockMetricIds(Array.isArray(state.dockMetricIds) ? state.dockMetricIds
    : state.dockMetricId ? [state.dockMetricId] : getAvailableDockMetrics(state).slice(0, 1).map(metric => metric.id));
  const periodQuotas = normalizeAntigravityPeriodQuotas(state.quota.gemini.periodQuotas);
  return [...new Set(selected.map(id => {
    const family = id === 'gemini:fiveHour' ? 'gemini' : id === 'gemini:weekly' ? 'partner' : null;
    const matching = family ? periodQuotas.filter(row => row.family === family).sort((a, b) =>
      b.used - a.used || Number(a.period === 'weekly') - Number(b.period === 'weekly') || a.id.localeCompare(b.id)) : [];
    return matching.length ? `gemini:quota:${matching[0].id}` as DockMetricId : id;
  }))];
}

export function getSelectedDockMetrics(state: DotDockState): DockMetricOption[] {
  const selected = getSelectedDockMetricIds(state);
  const enabled = state.enabledProviders?.length ? state.enabledProviders : ['codex', 'claude', 'gemini'];
  return getAvailableDockMetrics(state).filter((metric) => selected.includes(metric.id) && enabled.includes(metric.provider));
}

export function toggleDockMetric(state: DotDockState, id: DockMetricId): DockMetricId[] {
  const selected = getSelectedDockMetricIds(state);
  return normalizeDockMetricIds(selected.includes(id) ? selected.filter((metricId) => metricId !== id) : [...selected, id]);
}
