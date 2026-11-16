import { useState } from 'react';
import type { DockMetricId, ProviderId, QuotaBucket, WidgetContext } from '../../types/dotdock';
import { getBucketUsedPercent, getSelectedDockMetricIds, toggleDockMetric } from '../../services/quotaMetrics';

interface GaugeRowProps {
  label: string;
  bucket: QuotaBucket;
  accentColor: string;
  isPinnedToDock: boolean;
  onPinToDock: () => void;
}

type StatusFilter = 'all' | 'llm' | 'system';

function getGaugeTone(percent: number, defaultAccent: string): string {
  if (percent >= 85) return '#fb7185';
  if (percent >= 65) return '#fbbf24';
  return defaultAccent;
}

function GaugeRow({ label, bucket, accentColor, isPinnedToDock, onPinToDock }: GaugeRowProps) {
  const percent = getBucketUsedPercent(bucket);
  const remaining = Math.max(0, 100 - percent);
  const fillColor = getGaugeTone(percent, accentColor);
  const valueText =
    bucket.unit === '%'
      ? `사용 ${percent}% · 잔여 ${remaining}%`
      : `${bucket.used} / ${bucket.limit} ${bucket.unit} (${percent}%)`;

  return (
    <div className="quota-row">
      <div className="quota-row-top">
        <label
          className="quota-pin-check"
          title="체크하면 캐릭터 하단 상태 표시창에 이 항목의 잔여율과 막대 그래프를 표시합니다"
        >
          <input type="checkbox" checked={isPinnedToDock} onChange={onPinToDock} />
          <span className="quota-label">{label}</span>
          {isPinnedToDock && <span className="quota-pin-badge">하단 표시</span>}
        </label>
        <span className={`quota-value ${percent >= 85 ? 'is-danger' : percent >= 65 ? 'is-warn' : ''}`}>
          {valueText}
        </span>
      </div>
      <div className="pixel-bar-track" aria-label={`${label} ${valueText}`}>
        <div
          className="pixel-bar-fill"
          style={{
            width: `${percent}%`,
            backgroundColor: fillColor
          }}
        />
      </div>
      <div className="quota-reset-row">
        <span className="quota-reset-text">{bucket.resetLabel}</span>
      </div>
    </div>
  );
}

export function AiQuotaWidget({
  state,
  updateState,
  syncStatusMessage,
  syncProviderQuota,
  authStatusMessage,
  systemStats,
  refreshSystemStats,
  onOpenSettingsTab
}: WidgetContext) {
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const { quota } = state;

  const enabledProviders = state.enabledProviders || ['codex', 'claude', 'gemini'];

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await Promise.all([syncProviderQuota(), refreshSystemStats()]);
    } finally {
      setSyncing(false);
    }
  };

  const renderConnectionBadge = (provider: ProviderId) => {
    const info = state.auth?.[provider];
    if (info?.connected) {
      return (
        <button
          type="button"
          className="header-conn-pill is-connected"
          title={info.statusMessage || '연결됨 — 클릭 시 계정 연결로 이동'}
          onClick={() => onOpenSettingsTab?.('ai')}
        >
          {provider === 'gemini' ? '● OAuth 연동' : '● 연결됨'}
        </button>
      );
    }
    return (
      <button
        type="button"
        className="header-conn-pill"
        title="계정 연결 열기"
        onClick={() => onOpenSettingsTab?.('ai')}
      >
        미연결
      </button>
    );
  };

  const renderDisconnectedAction = (provider: ProviderId) => {
    const info = state.auth?.[provider];
    if (info?.connected) return null;
    return (
      <div className="sync-banner" style={{ marginTop: 4 }}>
        <span>{info?.statusMessage || '실시간 사용량을 보려면 계정을 연결해 주세요.'}</span>
        <button type="button" className="mini-btn is-accent"
          onClick={() => onOpenSettingsTab?.('ai')}>
          계정 연결
        </button>
      </div>
    );
  };

  const formattedTime = (() => {
    try {
      return new Date(quota.lastUpdatedAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  })();

  const sourceLabel =
    quota.source === 'oauth-sync'
      ? '실시간 OAuth 연동'
      : quota.source === 'local-file'
        ? '파일 연동'
        : '수동/대기';

  const showLlm = filter === 'all' || filter === 'llm';
  const showSystem = (filter === 'all' && state.showSystemWidget) || filter === 'system';

  const selectedDockMetricIds = getSelectedDockMetricIds(state);

  const codexBuckets: Array<{
    metricId: DockMetricId;
    key: 'fiveHour' | 'weekly';
    label: string;
    bucket: QuotaBucket;
    color: string;
  }> = [
    {
      metricId: 'codex:fiveHour' as const,
      key: 'fiveHour' as const,
      label: quota.codex.fiveHour.label || '5시간 (5h)',
      bucket: quota.codex.fiveHour,
      color: '#10b981'
    },
    {
      metricId: 'codex:weekly' as const,
      key: 'weekly' as const,
      label: quota.codex.weekly.label || '주간 한도 (7d)',
      bucket: quota.codex.weekly,
      color: '#34d399'
    }
  ].filter((item) => !item.bucket.hidden);

  const claudeBuckets: Array<{
    metricId: DockMetricId;
    key: 'fiveHour' | 'weekly' | 'fable';
    label: string;
    bucket: QuotaBucket;
    color: string;
  }> = [
    {
      metricId: 'claude:fiveHour' as const,
      key: 'fiveHour' as const,
      label: quota.claude.fiveHour.label || '5시간 (5h)',
      bucket: quota.claude.fiveHour,
      color: '#f59e0b'
    },
    {
      metricId: 'claude:weekly' as const,
      key: 'weekly' as const,
      label: quota.claude.weekly.label || '일주일 (7d)',
      bucket: quota.claude.weekly,
      color: '#fbbf24'
    },
    {
      metricId: 'claude:fable' as const,
      key: 'fable' as const,
      label: quota.claude.fable.label || '모델별 한도',
      bucket: quota.claude.fable,
      color: '#a855f7'
    }
  ].filter((item) => !item.bucket.hidden);

  const geminiBuckets: Array<{
    metricId: DockMetricId;
    key: 'fiveHour' | 'weekly';
    label: string;
    bucket: QuotaBucket;
    color: string;
  }> = [
    {
      metricId: 'gemini:fiveHour' as const,
      key: 'fiveHour' as const,
      label: quota.gemini.fiveHour.label || 'Gemini 모델',
      bucket: quota.gemini.fiveHour,
      color: '#38bdf8'
    },
    {
      metricId: 'gemini:weekly' as const,
      key: 'weekly' as const,
      label: quota.gemini.weekly.label || 'Claude · GPT 모델',
      bucket: quota.gemini.weekly,
      color: '#60a5fa'
    }
  ].filter((item) => !item.bucket.hidden);

  return (
    <div className="widget-stack">
      <div className="widget-toolbar">
        <div className="sync-meta">
          <span className="source-pill">{sourceLabel}</span>
          {formattedTime && <span className="time-label">{formattedTime}</span>}
          <span className="time-label">자동 {state.autoSyncMinutes || 10}분</span>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="mini-btn is-accent"
            disabled={syncing}
            title="연결된 OAuth/Antigravity 및 시스템 상태 동기화"
            onClick={() => void handleSyncAll()}
          >
            {syncing ? '동기화...' : '↻ 동기화'}
          </button>
          <button
            type="button"
            className="mini-btn"
            title="계정 연결 열기"
            onClick={() => onOpenSettingsTab?.('ai')}
          >
            계정 연결
          </button>
        </div>
      </div>

      {/* Quick view filter pills */}
      <div className="filter-pill-row" role="tablist" aria-label="현황 필터">
        {(
          [
            ['all', '전체'],
            ['llm', 'AI 사용량'],
            ['system', 'PC 상태']
          ] as Array<[StatusFilter, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`filter-pill ${filter === id ? 'is-active' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {showLlm && (
        <section className="provider-card" aria-label="AI 현황 표시 선택">
          <div className="dock-metric-pick-title">현황에 표시할 AI</div>
          <div className="dock-metric-pick-items">
            {([
              ['codex', 'ChatGPT · Codex'],
              ['claude', 'Claude'],
              ['gemini', 'Antigravity · Gemini']
            ] as const).map(([provider, label]) => {
              const enabled = enabledProviders.includes(provider);
              return (
                <label key={provider} className="llm-check-label">
                  <input type="checkbox" aria-label={`${label} 현황 표시`}
                    checked={enabled} disabled={enabled && enabledProviders.length === 1}
                    onChange={() => void updateState({ enabledProviders: enabled
                      ? enabledProviders.filter((id) => id !== provider)
                      : [...enabledProviders, provider] })} />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
          <div className="quota-reset-text">사용량 항목의 체크박스를 선택하면 캐릭터 아래에도 표시합니다.</div>
        </section>
      )}

      {(syncStatusMessage || authStatusMessage) && (
        <div className="sync-banner">
          <span>{syncStatusMessage || authStatusMessage}</span>
        </div>
      )}

      {/* LLM Cards */}
      {showLlm && enabledProviders.includes('codex') && (
        <section className="provider-card">
          <div className="provider-header">
            <span className="provider-dot" style={{ backgroundColor: '#10b981' }} />
            <strong className="provider-name">ChatGPT · Codex</strong>
            {state.auth.codex?.accountLabel && (
              <span className="provider-sub">{state.auth.codex.accountLabel}</span>
            )}
            {renderConnectionBadge('codex')}
          </div>
          {codexBuckets.map((item) => (
            <GaugeRow
              key={item.key}
              label={item.label}
              bucket={item.bucket}
              accentColor={item.color}
              isPinnedToDock={selectedDockMetricIds.includes(item.metricId)}
              onPinToDock={() => void updateState({ dockMetricIds: toggleDockMetric(state, item.metricId) })}
            />
          ))}
          {renderDisconnectedAction('codex')}
        </section>
      )}

      {showLlm && enabledProviders.includes('claude') && (
        <section className="provider-card">
          <div className="provider-header">
            <span className="provider-dot" style={{ backgroundColor: '#f59e0b' }} />
            <strong className="provider-name">Claude</strong>
            {state.auth.claude?.accountLabel && (
              <span className="provider-sub">{state.auth.claude.accountLabel}</span>
            )}
            {renderConnectionBadge('claude')}
          </div>
          {claudeBuckets.map((item) => (
            <GaugeRow
              key={item.key}
              label={item.label}
              bucket={item.bucket}
              accentColor={item.color}
              isPinnedToDock={selectedDockMetricIds.includes(item.metricId)}
              onPinToDock={() => void updateState({ dockMetricIds: toggleDockMetric(state, item.metricId) })}
            />
          ))}
          {renderDisconnectedAction('claude')}
        </section>
      )}

      {showLlm && enabledProviders.includes('gemini') && (
        <section className="provider-card">
          <div className="provider-header">
            <span className="provider-dot" style={{ backgroundColor: '#38bdf8' }} />
            <strong className="provider-name">Antigravity · Gemini</strong>
            {state.auth.gemini?.accountLabel && (
              <span className="provider-sub">{state.auth.gemini.accountLabel}</span>
            )}
            {renderConnectionBadge('gemini')}
          </div>
          {geminiBuckets.map((item) => (
            <GaugeRow
              key={item.key}
              label={item.label}
              bucket={item.bucket}
              accentColor={item.color}
              isPinnedToDock={selectedDockMetricIds.includes(item.metricId)}
              onPinToDock={() => void updateState({ dockMetricIds: toggleDockMetric(state, item.metricId) })}
            />
          ))}
          {renderDisconnectedAction('gemini')}
        </section>
      )}

      {/* Live CPU / GPU / RAM System Load Card */}
      {showSystem && (
        <section className="provider-card">
          <div className="provider-header">
            <span className="provider-dot" style={{ backgroundColor: '#22d3ee' }} />
            <strong className="provider-name">PC 상태 (CPU · GPU · RAM)</strong>
            <button
              type="button"
              className="mini-btn"
              style={{ marginLeft: 'auto' }}
              onClick={() => void refreshSystemStats()}
            >
              ↻
            </button>
          </div>

          {systemStats ? (
            <>
              <div className="quota-row">
                <div className="quota-row-top">
                  <span className="quota-label">CPU ({systemStats.cpuCount}코어)</span>
                  <span
                    className={`quota-value ${
                      systemStats.cpuLoadPercent >= 85
                        ? 'is-danger'
                        : systemStats.cpuLoadPercent >= 65
                          ? 'is-warn'
                          : ''
                    }`}
                  >
                    {systemStats.cpuLoadPercent}% · 1m {systemStats.loadAvg1m}
                  </span>
                </div>
                <div className="pixel-bar-track">
                  <div
                    className="pixel-bar-fill"
                    style={{
                      width: `${systemStats.cpuLoadPercent}%`,
                      backgroundColor: getGaugeTone(systemStats.cpuLoadPercent, '#22d3ee')
                    }}
                  />
                </div>
              </div>

              <div className="quota-row">
                <div className="quota-row-top">
                  <span className="quota-label">GPU ({systemStats.gpuModel})</span>
                  <span
                    className={`quota-value ${
                      systemStats.gpuLoadPercent >= 85
                        ? 'is-danger'
                        : systemStats.gpuLoadPercent >= 65
                          ? 'is-warn'
                          : ''
                    }`}
                  >
                    {systemStats.gpuLoadPercent}%
                  </span>
                </div>
                <div className="pixel-bar-track">
                  <div
                    className="pixel-bar-fill"
                    style={{
                      width: `${systemStats.gpuLoadPercent}%`,
                      backgroundColor: getGaugeTone(systemStats.gpuLoadPercent, '#34d399')
                    }}
                  />
                </div>
              </div>

              <div className="quota-row">
                <div className="quota-row-top">
                  <span className="quota-label">RAM 메모리</span>
                  <span
                    className={`quota-value ${
                      systemStats.memPercent >= 85
                        ? 'is-danger'
                        : systemStats.memPercent >= 65
                          ? 'is-warn'
                          : ''
                    }`}
                  >
                    {systemStats.memUsedGb} / {systemStats.memTotalGb} GB ({systemStats.memPercent}%)
                  </span>
                </div>
                <div className="pixel-bar-track">
                  <div
                    className="pixel-bar-fill"
                    style={{
                      width: `${systemStats.memPercent}%`,
                      backgroundColor: getGaugeTone(systemStats.memPercent, '#818cf8')
                    }}
                  />
                </div>
              </div>

              <div className="sys-meta-footer">
                <span>{systemStats.platform}</span>
                <span>가동 {systemStats.uptimeHours}시간</span>
              </div>
            </>
          ) : (
            <div className="quota-reset-text">CPU · GPU · RAM 정보를 불러오는 중...</div>
          )}
        </section>
      )}
    </div>
  );
}
