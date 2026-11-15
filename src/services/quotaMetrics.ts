import type { DockMetricId, DockMetricKey, DotDockState, ProviderId, QuotaBucket } from '../types/dotdock';

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

  const allCandidates: Array<{
    id: DockMetricId;
    provider: ProviderId;
    providerTitle: string;
    shortProvider: string;
    bucketKey: DockMetricKey;
    defaultLabel: string;
    shortLabel: string;
    color: string;
    bucket: QuotaBucket;
  }> = [
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
    {
      id: 'gemini:fiveHour',
      provider: 'gemini',
      providerTitle: 'Antigravity · Gemini',
      shortProvider: 'Gemini',
      bucketKey: 'fiveHour',
      defaultLabel: 'Gemini 모델',
      shortLabel: 'Gemini',
      color: '#38bdf8',
      bucket: quota.gemini.fiveHour
    },
    {
      id: 'gemini:weekly',
      provider: 'gemini',
      providerTitle: 'Antigravity · Gemini',
      shortProvider: 'Antigravity',
      bucketKey: 'weekly',
      defaultLabel: 'Claude · GPT 모델',
      shortLabel: 'Claude·GPT',
      color: '#60a5fa',
      bucket: quota.gemini.weekly
    }
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
    const matched = available.find((m) => m.id === state.dockMetricId);
    if (matched) return matched;
  }
  return available[0];
}

export function getSelectedDockMetricIds(state: DotDockState): DockMetricId[] {
  if (Array.isArray(state.dockMetricIds)) return [...new Set(state.dockMetricIds)];
  return state.dockMetricId ? [state.dockMetricId] : getAvailableDockMetrics(state).slice(0, 1).map((metric) => metric.id);
}

export function getSelectedDockMetrics(state: DotDockState): DockMetricOption[] {
  const selected = getSelectedDockMetricIds(state);
  const enabled = state.enabledProviders?.length ? state.enabledProviders : ['codex', 'claude', 'gemini'];
  return getAvailableDockMetrics(state).filter((metric) => selected.includes(metric.id) && enabled.includes(metric.provider));
}

export function toggleDockMetric(state: DotDockState, id: DockMetricId): DockMetricId[] {
  const selected = getSelectedDockMetricIds(state);
  return selected.includes(id) ? selected.filter((metricId) => metricId !== id) : [...selected, id];
}
