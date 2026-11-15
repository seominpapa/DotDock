import { useState } from 'react';
import type { ProviderId, WidgetContext } from '../../types/dotdock';

interface ProviderCardSpec {
  id: ProviderId;
  title: string;
  subtitle: string;
  dotColor: string;
  tokenHint: string;
}

const PROVIDERS: ProviderCardSpec[] = [
  {
    id: 'codex',
    title: 'ChatGPT · Codex',
    subtitle: 'OpenAI 웹 OAuth · Codex CLI 인증',
    dotColor: '#10b981',
    tokenHint: 'OpenAI OAuth Access Token'
  },
  {
    id: 'claude',
    title: 'Claude',
    subtitle: 'Claude 웹 OAuth · 5시간·주간 사용량',
    dotColor: '#f59e0b',
    tokenHint: 'Claude OAuth Access Token'
  },
  {
    id: 'gemini',
    title: 'Antigravity · Gemini',
    subtitle: 'Antigravity 로그인 후 로컬 인증 감지 · 모델 할당량',
    dotColor: '#38bdf8',
    tokenHint: 'Google OAuth Access Token (ya29...)'
  }
];

function formatMethodLabel(method: string): string {
  switch (method) {
    case 'oauth-session':
    case 'local-cli':
      return 'OAuth 연동';
    case 'token':
      return '토큰';
    default:
      return '미연결';
  }
}

export function OAuthConnectWidget({
  state,
  startOAuthLogin,
  detectLocalAuth,
  syncProviderQuota,
  saveProviderToken,
  disconnectProvider,
  authStatusMessage
}: WidgetContext) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tokenOpenFor, setTokenOpenFor] = useState<ProviderId | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await fn();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="widget-stack">
      <div className="widget-toolbar">
        <div className="sync-meta">
          <span className="source-pill">OAuth 인증 관리</span>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="mini-btn is-accent"
            disabled={busyKey !== null}
            onClick={() => void runAction('sync-all', () => syncProviderQuota())}
          >
            {busyKey === 'sync-all' ? '동기화 중...' : '↻ 전체 동기화'}
          </button>
        </div>
      </div>

      {authStatusMessage && <div className="sync-banner">{authStatusMessage}</div>}

      {PROVIDERS.map((spec) => {
        const info = state.auth[spec.id];
        const isTokenOpen = tokenOpenFor === spec.id;
        return (
          <section key={spec.id} className="provider-card">
            <div className="provider-header">
              <span className="provider-dot" style={{ backgroundColor: spec.dotColor }} />
              <strong className="provider-name">{spec.title}</strong>
              <span className={`auth-badge ${info.connected ? 'is-connected' : 'is-disconnected'}`}>
                {info.connected ? `● ${formatMethodLabel(info.method)}` : '○ 미연결'}
              </span>
            </div>

            <div className="auth-detail-line">
              <span className="auth-sub">{spec.subtitle}</span>
              {info.accountLabel && <span className="auth-account">{info.accountLabel}</span>}
            </div>

            {info.statusMessage && <div className="quota-reset-text">{info.statusMessage}</div>}

            <div className="auth-actions-row">
              <button
                type="button"
                className="mini-btn is-accent"
                disabled={busyKey !== null}
                onClick={() => void runAction(`login-${spec.id}`, () =>
                  spec.id === 'gemini' ? detectLocalAuth(spec.id) : startOAuthLogin(spec.id))}
              >
                {busyKey === `login-${spec.id}`
                  ? spec.id === 'gemini' ? '로컬 인증 확인 중…' : '브라우저 인증 중...'
                  : spec.id === 'gemini' ? '로컬 인증 감지' : info.connected
                    ? '🌐 계정 변경'
                    : '🌐 웹 로그인'}
              </button>

              <button
                type="button"
                className={`mini-btn ${isTokenOpen ? 'is-active' : ''}`}
                disabled={busyKey !== null}
                onClick={() => {
                  setTokenOpenFor(isTokenOpen ? null : spec.id);
                  setTokenDraft('');
                }}
              >
                🔑 토큰
              </button>

              {info.connected && (
                <>
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={busyKey !== null}
                    onClick={() =>
                      void runAction(`sync-${spec.id}`, () => syncProviderQuota(spec.id))
                    }
                  >
                    ↻ 동기화
                  </button>
                  <button
                    type="button"
                    className="mini-btn is-danger-btn"
                    disabled={busyKey !== null}
                    onClick={() =>
                      void runAction(`disconnect-${spec.id}`, () => disconnectProvider(spec.id))
                    }
                  >
                    해제
                  </button>
                </>
              )}
            </div>

            {isTokenOpen && (
              <div className="token-input-row">
                <input
                  type="password"
                  className="year-input"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder={spec.tokenHint}
                />
                <button
                  type="button"
                  className="mini-btn is-accent"
                  disabled={!tokenDraft.trim() || busyKey !== null}
                  onClick={() =>
                    void runAction(`token-${spec.id}`, async () => {
                      await saveProviderToken(spec.id, tokenDraft);
                      setTokenDraft('');
                      setTokenOpenFor(null);
                    })
                  }
                >
                  저장
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
