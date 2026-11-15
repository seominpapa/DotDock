import type { WidgetContext } from '../../types/dotdock';

export function SystemMemoWidget({
  state,
  updateState,
  systemStats,
  refreshSystemStats
}: WidgetContext) {
  return (
    <div className="widget-stack">
      <section className="provider-card">
        <div className="provider-header">
          <span className="provider-dot" style={{ backgroundColor: '#22d3ee' }} />
          <strong className="provider-name">시스템 상태 (CPU · GPU · RAM)</strong>
          <button
            type="button"
            className="mini-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => void refreshSystemStats()}
          >
            새로고침
          </button>
        </div>

        {systemStats ? (
          <>
            <div className="quota-row">
              <div className="quota-row-top">
                <span className="quota-label">CPU 부하 ({systemStats.cpuCount}코어)</span>
                <span className="quota-value">
                  {systemStats.cpuLoadPercent}% · 1m {systemStats.loadAvg1m}
                </span>
              </div>
              <div className="pixel-bar-track">
                <div
                  className="pixel-bar-fill"
                  style={{
                    width: `${systemStats.cpuLoadPercent}%`,
                    backgroundColor: systemStats.cpuLoadPercent >= 80 ? '#fb7185' : '#22d3ee'
                  }}
                />
              </div>
            </div>

            <div className="quota-row">
              <div className="quota-row-top">
                <span className="quota-label">GPU 부하 ({systemStats.gpuModel})</span>
                <span className="quota-value">{systemStats.gpuLoadPercent}%</span>
              </div>
              <div className="pixel-bar-track">
                <div
                  className="pixel-bar-fill"
                  style={{
                    width: `${systemStats.gpuLoadPercent}%`,
                    backgroundColor: systemStats.gpuLoadPercent >= 80 ? '#fb7185' : '#34d399'
                  }}
                />
              </div>
            </div>

            <div className="quota-row">
              <div className="quota-row-top">
                <span className="quota-label">메모리 (RAM)</span>
                <span className="quota-value">
                  {systemStats.memUsedGb} / {systemStats.memTotalGb} GB ({systemStats.memPercent}%)
                </span>
              </div>
              <div className="pixel-bar-track">
                <div
                  className="pixel-bar-fill"
                  style={{
                    width: `${systemStats.memPercent}%`,
                    backgroundColor: systemStats.memPercent >= 85 ? '#fb7185' : '#818cf8'
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
          <div className="quota-reset-text">시스템 정보를 불러오는 중...</div>
        )}
      </section>

      <section className="provider-card">
        <div className="provider-header">
          <span className="provider-dot" style={{ backgroundColor: '#f472b6' }} />
          <strong className="provider-name">빠른 데스크탑 메모</strong>
          <span className="provider-sub">자동 저장</span>
        </div>
        <textarea
          className="memo-textarea"
          value={state.memo}
          onChange={(e) => void updateState({ memo: e.target.value })}
          rows={4}
          placeholder="여기에 짧은 할 일이나 메모를 적어두세요..."
        />
      </section>

      <section className="provider-card ext-guide-card">
        <div className="provider-header">
          <span className="provider-dot" style={{ backgroundColor: '#a78bfa' }} />
          <strong className="provider-name">확장 위젯 슬롯 안내</strong>
        </div>
        <p className="ext-guide-text">
          <code>src/widgets/registry.ts</code>의 <code>WIDGET_REGISTRY</code>에 새{' '}
          <code>WidgetDefinition</code>을 추가하면 상단 탭에 날씨·GitHub PR·포모도로·커스텀 API
          위젯을 레고처럼 바로 붙일 수 있습니다.
        </p>
      </section>
    </div>
  );
}
