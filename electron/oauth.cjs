const { app, shell, safeStorage } = require('electron');
const { createCredentialStore, CredentialStoreError } = require('./credential-store.cjs');
const { queryAntigravityLocal } = require('./antigravity-local.cjs');
const { decodeAntigravityTokens } = require('./antigravity-credentials.cjs');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const OAUTH_SPECS = {
  codex: {
    id: 'codex',
    label: 'ChatGPT · Codex',
    authUrl:
      'https://auth.openai.com/oauth/authorize?id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=codex_cli_rs',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    redirectHost: '127.0.0.1',
    redirectPort: 1455,
    redirectPath: '/auth/callback',
    redirectUri: 'http://localhost:1455/auth/callback',
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    tokenContentType: 'form'
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    authUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    redirectHost: '127.0.0.1',
    redirectPort: 54545,
    redirectPath: '/callback',
    redirectUri: 'http://localhost:54545/callback',
    scope: 'org:create_api_key user:profile user:inference',
    tokenContentType: 'json',
    includeStateInToken: true
  },
  gemini: {
    id: 'gemini',
    label: 'Antigravity · Gemini',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: process.env.DOTDOCK_GOOGLE_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
    clientSecret: process.env.DOTDOCK_GOOGLE_CLIENT_SECRET || null,
    redirectHost: '127.0.0.1',
    redirectPort: 51121,
    redirectPath: '/oauth-callback',
    redirectUri: 'http://localhost:51121/oauth-callback',
    scope:
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs',
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent'
    },
    tokenContentType: 'form'
  }
};

const PROVIDER_META = {
  codex: { id: 'codex', label: 'ChatGPT · Codex' },
  claude: { id: 'claude', label: 'Claude' },
  gemini: { id: 'gemini', label: 'Antigravity · Gemini' }
};

const activeOAuthServers = new Map();
let geminiSyncGeneration = 0;

function clampPercent(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function base64UrlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getSecretsFilePath() {
  return path.join(app.getPath('userData'), 'dotdock-secrets.json');
}

function readSecrets() {
  return createCredentialStore(getSecretsFilePath(), safeStorage).read();
}

function writeSecrets(secrets) {
  createCredentialStore(getSecretsFilePath(), safeStorage).write(secrets);
}

function saveOAuthCredential(provider, cred) {
  const secrets = readSecrets();
  if (!secrets.oauthTokens || typeof secrets.oauthTokens !== 'object') {
    secrets.oauthTokens = {};
  }
  secrets.oauthTokens[provider] = {
    ...(secrets.oauthTokens[provider] || {}),
    ...cred,
    updatedAt: new Date().toISOString()
  };
  writeSecrets(secrets);
}

function getStoredCredential(provider) {
  const secrets = readSecrets();
  const oauthCred = secrets.oauthTokens?.[provider];
  const manualToken = secrets.tokens?.[provider] || (typeof secrets[provider] === 'string' ? secrets[provider] : null);
  return { oauthCred, manualToken };
}

function requestJsonHttps(urlString, options = {}) {
  const { method = 'GET', headers = {}, body = null, timeoutMs = 6000 } = options;
  return new Promise((resolve) => {
    try {
      const url = new URL(urlString);
      const reqHeaders = { ...headers };
      let payload = body;
      if (payload !== null && payload !== undefined) {
        if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
          payload = JSON.stringify(payload);
          if (!reqHeaders['Content-Type']) {
            reqHeaders['Content-Type'] = 'application/json';
          }
        }
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method,
          headers: reqHeaders,
          timeout: timeoutMs
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let data = null;
            try {
              data = text ? JSON.parse(text) : null;
            } catch {
              data = null;
            }
            const status = res.statusCode || 0;
            resolve({
              ok: status >= 200 && status < 300,
              status,
              data,
              text
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, data: null, text: 'timeout' });
      });
      req.on('error', (err) => {
        resolve({ ok: false, status: 0, data: null, text: err.message });
      });

      if (payload !== null && payload !== undefined) {
        req.write(payload);
      }
      req.end();
    } catch (err) {
      resolve({ ok: false, status: 0, data: null, text: err.message });
    }
  });
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function formatResetCountdown(targetMs) {
  const diffMs = Math.max(0, targetMs - Date.now());
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}일 ${hours}시간 후 초기화`;
  if (hours > 0) return `${hours}시간 ${mins}분 후 초기화`;
  return `${mins}분 후 초기화`;
}

function formatResetFromSeconds(seconds) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return formatResetCountdown(Date.now() + sec * 1000);
}

function parseTimestampMs(isoOrEpoch) {
  if (isoOrEpoch === null || isoOrEpoch === undefined) return NaN;
  if (typeof isoOrEpoch === 'number') {
    return isoOrEpoch < 1e12 ? isoOrEpoch * 1000 : isoOrEpoch;
  }
  if (typeof isoOrEpoch === 'string') {
    const trimmed = isoOrEpoch.trim();
    if (!trimmed) return NaN;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    return Date.parse(trimmed);
  }
  return NaN;
}

function formatResetFromTimestamp(isoOrEpoch) {
  const targetMs = parseTimestampMs(isoOrEpoch);
  if (!Number.isFinite(targetMs) || targetMs <= Date.now()) return null;
  return formatResetCountdown(targetMs);
}

// =============================================================================
// Token Exchange & Refresh Helpers
// =============================================================================

async function exchangeAuthCode(spec, code, codeVerifier, state) {
  if (spec.tokenContentType === 'json') {
    const jsonPayload = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: spec.redirectUri,
      client_id: spec.clientId,
      code_verifier: codeVerifier
    };
    if (spec.includeStateInToken && state) {
      jsonPayload.state = state;
    }
    const res = await requestJsonHttps(spec.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DotDock/1.0'
      },
      body: jsonPayload
    });
    if (res.ok && res.data?.access_token) {
      return res;
    }
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: spec.redirectUri,
    client_id: spec.clientId,
    code_verifier: codeVerifier
  });
  if (spec.clientSecret) {
    form.set('client_secret', spec.clientSecret);
  }
  if (spec.includeStateInToken && state) {
    form.set('state', state);
  }

  return requestJsonHttps(spec.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'DotDock/1.0'
    },
    body: form.toString()
  });
}

async function refreshOAuthToken(spec, refreshToken, overrideClientId, overrideClientSecret) {
  if (!refreshToken) return null;
  const clientId = overrideClientId || spec.clientId;
  const clientSecret = overrideClientSecret !== undefined ? overrideClientSecret : spec.clientSecret;

  if (spec.tokenContentType === 'json') {
    const res = await requestJsonHttps(spec.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DotDock/1.0'
      },
      body: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken
      }
    });
    if (res.ok && res.data?.access_token) {
      return {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token || refreshToken,
        idToken: res.data.id_token || null,
        expiresAt: res.data.expires_in ? Date.now() + Number(res.data.expires_in) * 1000 : null
      };
    }
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken
  });
  if (clientSecret) {
    form.set('client_secret', clientSecret);
  }

  const res = await requestJsonHttps(spec.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'DotDock/1.0'
    },
    body: form.toString()
  });

  if (res.ok && res.data?.access_token) {
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token || refreshToken,
      idToken: res.data.id_token || null,
      expiresAt: res.data.expires_in ? Date.now() + Number(res.data.expires_in) * 1000 : null
    };
  }
  return null;
}

// =============================================================================
// 1. ChatGPT / Codex (https://chatgpt.com/backend-api/wham/usage)
// =============================================================================

function getCodexAuthPath() {
  const candidates = [];
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim()) {
    candidates.push(path.join(process.env.CODEX_HOME.trim(), 'auth.json'));
  }
  candidates.push(path.join(os.homedir(), '.codex', 'auth.json'));
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'codex', 'auth.json'));
  }
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function readCodexLocalAuth() {
  const codexAuthPath = getCodexAuthPath();
  const { oauthCred, manualToken } = getStoredCredential('codex');

  const hasWebOAuth = Boolean(oauthCred?.accessToken || oauthCred?.refreshToken);
  let accessToken = oauthCred?.accessToken || null;
  let refreshToken = oauthCred?.refreshToken || null;
  let expiresAt = oauthCred?.expiresAt || null;
  let accountId = oauthCred?.accountId || null;
  let email = oauthCred?.email || null;
  let planType = oauthCred?.planType || null;
  let fromCliFile = false;
  let isManualToken = false;

  if (fs.existsSync(codexAuthPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(codexAuthPath, 'utf8'));
      const cliAccess = parsed?.tokens?.access_token || parsed?.access_token || null;
      const cliRefresh = parsed?.tokens?.refresh_token || parsed?.refresh_token || null;
      const cliIdToken = parsed?.tokens?.id_token || null;
      const cliAccountId = parsed?.tokens?.account_id || parsed?.account_id || null;

      if (!hasWebOAuth && (cliAccess || cliRefresh)) {
        accessToken = cliAccess;
        refreshToken = cliRefresh || refreshToken;
        accountId = cliAccountId || accountId;
        fromCliFile = true;
      } else if (!refreshToken && cliRefresh) {
        refreshToken = cliRefresh;
      }
      if (!accountId && cliAccountId) {
        accountId = cliAccountId;
      }

      const idClaims = decodeJwtPayload(cliIdToken || oauthCred?.idToken);
      const accessClaims = decodeJwtPayload(accessToken);
      email = email || parsed?.email || parsed?.account_email || idClaims?.email || accessClaims?.email || null;
      planType =
        planType ||
        idClaims?.['https://api.openai.com/auth']?.chatgpt_plan_type ||
        accessClaims?.['https://api.openai.com/auth']?.chatgpt_plan_type ||
        null;
      if (!expiresAt && typeof accessClaims?.exp === 'number') {
        expiresAt = accessClaims.exp * 1000;
      }
    } catch {
      // ignore auth.json parse errors
    }
  } else if (accessToken) {
    const claims = decodeJwtPayload(accessToken);
    email = email || claims?.email || null;
    planType = planType || claims?.['https://api.openai.com/auth']?.chatgpt_plan_type || null;
    if (!expiresAt && typeof claims?.exp === 'number') {
      expiresAt = claims.exp * 1000;
    }
  }

  if (!accessToken && !refreshToken && manualToken) {
    accessToken = manualToken;
    isManualToken = true;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    accountId,
    email,
    planType,
    hasWebOAuth,
    fromCliFile,
    isManualToken,
    hasCliFile: fs.existsSync(codexAuthPath)
  };
}

function classifyCodexWindow(win) {
  if (!win || typeof win !== 'object') return null;
  if (typeof win.limit_window_seconds === 'number') {
    if (win.limit_window_seconds <= 21600) return '5h';
    if (win.limit_window_seconds >= 86400) return '7d';
  }
  if (typeof win.window_minutes === 'number') {
    if (win.window_minutes <= 360) return '5h';
    if (win.window_minutes >= 1440) return '7d';
  }
  const sec = win.reset_after_seconds ?? win.resets_in_seconds;
  if (typeof sec === 'number') {
    if (sec <= 21600) return '5h';
    if (sec > 86400) return '7d';
  }
  return null;
}

async function fetchCodexWhamUsage(accessToken, accountId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'codex-cli/1.0'
  };
  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId;
  }
  return requestJsonHttps('https://chatgpt.com/backend-api/wham/usage', {
    method: 'GET',
    headers
  });
}

async function syncCodexCli(appState, nowIso) {
  const cred = readCodexLocalAuth();
  if (!cred.accessToken && !cred.refreshToken) {
    return false;
  }

  let { accessToken, refreshToken, expiresAt, accountId, email, planType } = cred;

  const needsPreemptiveRefresh =
    (!accessToken && refreshToken) ||
    (typeof expiresAt === 'number' && expiresAt - Date.now() < 60_000 && refreshToken);

  if (needsPreemptiveRefresh) {
    const refreshed = await refreshOAuthToken(OAUTH_SPECS.codex, refreshToken);
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
      saveOAuthCredential('codex', {
        accessToken,
        refreshToken,
        idToken: refreshed.idToken,
        expiresAt,
        accountId,
        email,
        planType
      });
    }
  }

  if (!accessToken) {
    return false;
  }

  let res = await fetchCodexWhamUsage(accessToken, accountId);
  if ((res.status === 401 || res.status === 403) && refreshToken) {
    const refreshed = await refreshOAuthToken(OAUTH_SPECS.codex, refreshToken);
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
      saveOAuthCredential('codex', {
        accessToken,
        refreshToken,
        idToken: refreshed.idToken,
        expiresAt,
        accountId,
        email,
        planType
      });
      res = await fetchCodexWhamUsage(accessToken, accountId);
    }
  }

  if (!res.ok || !res.data || typeof res.data !== 'object') {
    return false;
  }

  const wham = res.data;
  if (wham.plan_type) planType = wham.plan_type;

  const rl = wham.rate_limit || wham.codex_rate_limits || {};
  const rawWindows = [rl.primary_window, rl.secondary_window].filter(
    (w) => w && typeof w === 'object' && typeof w.used_percent === 'number'
  );

  let fiveHourWindow = null;
  let weeklyWindow = null;

  for (const win of rawWindows) {
    const kind = classifyCodexWindow(win);
    if (kind === '5h' && !fiveHourWindow) {
      fiveHourWindow = win;
    } else if (kind === '7d' && !weeklyWindow) {
      weeklyWindow = win;
    } else if (!weeklyWindow) {
      weeklyWindow = win;
    }
  }

  if (fiveHourWindow) {
    const fiveUsed = clampPercent(fiveHourWindow.used_percent);
    const resetLabel =
      formatResetFromSeconds(fiveHourWindow.reset_after_seconds ?? fiveHourWindow.resets_in_seconds) ||
      formatResetFromTimestamp(fiveHourWindow.reset_at ?? fiveHourWindow.resets_at) ||
      (fiveUsed === 0 ? '현재 사용량 없음 (대기 중)' : '5시간 한도');
    appState.quota.codex.fiveHour = {
      used: fiveUsed,
      limit: 100,
      unit: '%',
      resetLabel,
      label: '5시간 (5h)',
      hidden: false
    };
  } else {
    // Pro Lite / single weekly window plan — do NOT invent or count local 5h turns
    appState.quota.codex.fiveHour = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '해당 요금제에 5h 한도 없음',
      label: '5시간 (5h)',
      hidden: true
    };
  }

  if (weeklyWindow) {
    const weeklyUsed = clampPercent(weeklyWindow.used_percent);
    const resetLabel =
      formatResetFromSeconds(weeklyWindow.reset_after_seconds ?? weeklyWindow.resets_in_seconds) ||
      formatResetFromTimestamp(weeklyWindow.reset_at ?? weeklyWindow.resets_at) ||
      (weeklyUsed === 0 ? '현재 사용량 없음 (대기 중)' : '주간 한도');
    appState.quota.codex.weekly = {
      used: weeklyUsed,
      limit: 100,
      unit: '%',
      resetLabel,
      label: '주간 한도 (7d)',
      hidden: false
    };
  } else {
    appState.quota.codex.weekly = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '주간 한도 없음',
      label: '주간 한도 (7d)',
      hidden: true
    };
  }

  appState.quota.lastUpdatedAt = nowIso;
  appState.quota.source = 'oauth-sync';

  const accountLabel = email ? (planType ? `${email} (${planType})` : email) : planType || 'ChatGPT 계정';
  const method = cred.isManualToken ? 'token' : 'oauth-session';
  const sourceDesc = cred.isManualToken
    ? '토큰'
    : cred.hasWebOAuth
      ? '웹 OAuth'
      : 'Codex CLI OAuth';

  appState.auth.codex = {
    connected: true,
    method,
    accountLabel,
    lastSyncedAt: nowIso,
    statusMessage: `Codex ${sourceDesc} 실시간 사용량 동기화 완료 (${planType || 'OAuth'})`
  };
  return true;
}

// =============================================================================
// 2. Claude (https://api.anthropic.com/api/oauth/usage)
// =============================================================================

function readClaudeEmailHint() {
  const claudeJson = path.join(os.homedir(), '.claude.json');
  try {
    if (fs.existsSync(claudeJson)) {
      const parsed = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
      return parsed?.oauthAccount?.emailAddress || parsed?.primaryEmail || null;
    }
  } catch {
    // ignore
  }
  return null;
}

function readClaudeLocalCredentials() {
  const { oauthCred, manualToken } = getStoredCredential('claude');
  if (oauthCred?.accessToken || oauthCred?.refreshToken) {
    return {
      accessToken: oauthCred.accessToken || null,
      refreshToken: oauthCred.refreshToken || null,
      expiresAt: oauthCred.expiresAt || null,
      email: oauthCred.email || readClaudeEmailHint(),
      source: 'oauth-session'
    };
  }

  const candidatePaths = [
    path.join(os.homedir(), '.claude', '.credentials.json'),
    path.join(os.homedir(), '.claude', 'credentials.json'),
    ...(process.env.APPDATA
      ? [
          path.join(process.env.APPDATA, 'Claude', '.credentials.json'),
          path.join(process.env.APPDATA, 'Claude', 'credentials.json')
        ]
      : [])
  ];
  for (const credsPath of candidatePaths) {
    if (!fs.existsSync(credsPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      const oauthObj = parsed?.claudeAiOauth || parsed;
      if (oauthObj?.accessToken || oauthObj?.refreshToken) {
        return {
          accessToken: oauthObj.accessToken || null,
          refreshToken: oauthObj.refreshToken || null,
          expiresAt: oauthObj.expiresAt || null,
          email: readClaudeEmailHint(),
          source: 'local-cli'
        };
      }
    } catch {
      // ignore
    }
  }

  if (process.platform === 'darwin') {
    try {
      const raw = execFileSync(
        '/usr/bin/security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 1800, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        const oauthObj = parsed?.claudeAiOauth || parsed;
        if (oauthObj?.accessToken || oauthObj?.refreshToken) {
          return {
            accessToken: oauthObj.accessToken || null,
            refreshToken: oauthObj.refreshToken || null,
            expiresAt: oauthObj.expiresAt || null,
            email: readClaudeEmailHint(),
            source: 'local-cli'
          };
        }
      }
    } catch {
      // Keychain item missing or denied
    }
  }

  if (manualToken) {
    return {
      accessToken: manualToken,
      refreshToken: null,
      expiresAt: null,
      email: readClaudeEmailHint(),
      source: 'token'
    };
  }

  return null;
}

async function fetchClaudeOAuthUsage(accessToken) {
  return requestJsonHttps('https://api.anthropic.com/api/oauth/usage', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      Accept: 'application/json',
      'User-Agent': 'claude-code/2.0'
    }
  });
}

async function fetchClaudeOAuthProfile(accessToken) {
  const res = await requestJsonHttps('https://api.anthropic.com/api/oauth/profile', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      Accept: 'application/json',
      'User-Agent': 'claude-code/2.0'
    }
  });
  return res.ok ? res.data : null;
}

function normalizePercentNumber(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return clampPercent(num);
}

async function syncClaudeCli(appState, nowIso) {
  const cred = readClaudeLocalCredentials();
  if (!cred) {
    return false;
  }

  let { accessToken, refreshToken, expiresAt, email, source } = cred;

  const needsPreemptiveRefresh =
    (!accessToken && refreshToken) ||
    (typeof expiresAt === 'number' && expiresAt - Date.now() < 60_000 && refreshToken);

  if (needsPreemptiveRefresh) {
    const refreshed = await refreshOAuthToken(OAUTH_SPECS.claude, refreshToken);
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
      saveOAuthCredential('claude', {
        accessToken,
        refreshToken,
        expiresAt,
        email
      });
    }
  }

  if (!accessToken) {
    return false;
  }

  let res = await fetchClaudeOAuthUsage(accessToken);
  if ((res.status === 401 || res.status === 403) && refreshToken) {
    const refreshed = await refreshOAuthToken(OAUTH_SPECS.claude, refreshToken);
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
      saveOAuthCredential('claude', {
        accessToken,
        refreshToken,
        expiresAt,
        email
      });
      res = await fetchClaudeOAuthUsage(accessToken);
    }
  }

  if (!res.ok || !res.data || typeof res.data !== 'object') {
    return false;
  }

  const usage = res.data;
  const profile = await fetchClaudeOAuthProfile(accessToken);
  if (profile) {
    email = profile?.account?.email || profile?.email || email;
  }

  const fiveHour = usage.five_hour;
  if (fiveHour && typeof fiveHour.utilization === 'number') {
    const fiveUsed = normalizePercentNumber(fiveHour.utilization);
    appState.quota.claude.fiveHour = {
      used: fiveUsed,
      limit: 100,
      unit: '%',
      resetLabel:
        formatResetFromTimestamp(fiveHour.resets_at) ||
        (fiveUsed === 0 ? '현재 사용량 없음 (대기 중)' : '5시간 한도'),
      label: '5시간 (5h)',
      hidden: false
    };
  } else {
    appState.quota.claude.fiveHour = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '5시간 한도 없음',
      label: '5시간 (5h)',
      hidden: !fiveHour
    };
  }

  const sevenDay = usage.seven_day;
  if (sevenDay && typeof sevenDay.utilization === 'number') {
    const weeklyUsed = normalizePercentNumber(sevenDay.utilization);
    appState.quota.claude.weekly = {
      used: weeklyUsed,
      limit: 100,
      unit: '%',
      resetLabel:
        formatResetFromTimestamp(sevenDay.resets_at) ||
        (weeklyUsed === 0 ? '현재 사용량 없음 (대기 중)' : '일주일 한도'),
      label: '일주일 (7d)',
      hidden: false
    };
  } else {
    appState.quota.claude.weekly = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '주간 한도 없음',
      label: '일주일 (7d)',
      hidden: !sevenDay
    };
  }

  const modelCandidates = [
    ['Fable 5 사용량', usage.seven_day_fable_5],
    ['Fable 사용량', usage.seven_day_fable],
    ['Sonnet 주간 한도', usage.seven_day_sonnet],
    ['Opus 주간 한도', usage.seven_day_opus],
    ['Omelette 주간 한도', usage.seven_day_omelette]
  ];
  const activeModel = modelCandidates.find(
    ([, bucket]) => bucket && typeof bucket.utilization === 'number'
  );

  let modelLabel = null;
  let modelUsed = null;
  let modelResetsAt = null;
  if (activeModel) {
    modelLabel = activeModel[0];
    modelUsed = normalizePercentNumber(activeModel[1].utilization);
    modelResetsAt = activeModel[1].resets_at;
  } else if (Array.isArray(usage.limits)) {
    const scopedLimit = usage.limits.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item.kind === 'weekly_scoped' || item.scope?.model) &&
        typeof item.percent === 'number'
    );
    if (scopedLimit) {
      const scopedName = scopedLimit.scope?.model?.display_name || '모델별';
      modelLabel = `${scopedName} 주간 한도`;
      modelUsed = normalizePercentNumber(scopedLimit.percent);
      modelResetsAt = scopedLimit.resets_at;
    }
  }

  if (modelUsed !== null) {
    appState.quota.claude.fable = {
      used: modelUsed,
      limit: 100,
      unit: '%',
      resetLabel:
        formatResetFromTimestamp(modelResetsAt) ||
        (modelUsed === 0 ? '현재 사용량 없음 (대기 중)' : '모델별 한도'),
      label: modelLabel || '모델별 한도',
      hidden: false
    };
  } else {
    appState.quota.claude.fable = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '해당 요금제에 모델별 추가 한도 없음',
      label: '모델별 한도',
      hidden: true
    };
  }

  appState.quota.lastUpdatedAt = nowIso;
  appState.quota.source = 'oauth-sync';
  appState.auth.claude = {
    connected: true,
    method: source === 'token' ? 'token' : 'oauth-session',
    accountLabel: email || 'Claude OAuth',
    lastSyncedAt: nowIso,
    statusMessage:
      source === 'local-cli'
        ? 'Claude OAuth (로컬 CLI 토큰) 실시간 사용량 동기화 완료'
        : 'Claude 실시간 사용량 동기화 완료'
  };
  return true;
}

// =============================================================================
// 3. Antigravity / Gemini (https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels)
// =============================================================================

function readGeminiAccountHint() {
  const accountsFile = path.join(os.homedir(), '.gemini', 'google_accounts.json');
  try {
    if (fs.existsSync(accountsFile)) {
      const parsed = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
      if (parsed?.active) return parsed.active;
    }
  } catch {
    // ignore
  }
  return null;
}

function findOAuthFieldsDeep(node, depth = 0, out = {}) {
  if (!node || depth > 5) return out;
  if (typeof node === 'string') {
    if (!out.accessToken && node.startsWith('ya29.')) {
      out.accessToken = node;
    }
    if (!out.refreshToken && node.startsWith('1//')) {
      out.refreshToken = node;
    }
    return out;
  }
  if (typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) {
      findOAuthFieldsDeep(item, depth + 1, out);
    }
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    const lower = k.toLowerCase();
    if (typeof v === 'string') {
      if ((lower === 'access_token' || lower === 'accesstoken' || lower === 'apikey') && v.startsWith('ya29.')) {
        out.accessToken = out.accessToken || v;
      } else if ((lower === 'refresh_token' || lower === 'refreshtoken') && v.startsWith('1//')) {
        out.refreshToken = out.refreshToken || v;
      } else if (lower === 'email' && v.includes('@')) {
        out.email = out.email || v;
      } else if (lower === 'client_id' && v.includes('.apps.googleusercontent.com')) {
        out.clientId = out.clientId || v;
      } else if (lower === 'client_secret' && v.startsWith('GOCSPX-')) {
        out.clientSecret = out.clientSecret || v;
      } else {
        findOAuthFieldsDeep(v, depth + 1, out);
      }
    } else if (v && typeof v === 'object') {
      findOAuthFieldsDeep(v, depth + 1, out);
    }
  }
  return out;
}

function queryAntigravityStateDb(dbPath, sql) {
  let database;
  try {
    if (fs.statSync(dbPath).size > 64 * 1024 * 1024) return '';
    const { DatabaseSync } = require('node:sqlite');
    // SQLite reads committed WAL changes; raw bytes can contain stale or deleted tokens.
    database = new DatabaseSync(dbPath, { readOnly: true, timeout: 250 });
    return database.prepare(sql).all()
      .map(({ value }) => typeof value === 'string' ? value : value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : '')
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  } finally {
    database?.close();
  }
}

function readAntigravityIdeTokens() {
  const candidates = [
    path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
    ...(process.env.APPDATA
      ? [
          path.join(process.env.APPDATA, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
          path.join(process.env.APPDATA, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
        ]
      : []),
    ...(process.env.LOCALAPPDATA
      ? [
          path.join(process.env.LOCALAPPDATA, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
          path.join(process.env.LOCALAPPDATA, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
        ]
      : []),
    path.join(os.homedir(), '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    path.join(os.homedir(), '.config', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
  ];

  for (const dbPath of candidates) {
    if (!fs.existsSync(dbPath)) continue;
    try {
      const sql =
        "SELECT value FROM ItemTable WHERE key LIKE '%auth%' OR key LIKE '%oauth%' OR key LIKE '%antigravity%' OR key LIKE '%token%' OR key LIKE '%jetski%';";
      const out = queryAntigravityStateDb(dbPath, sql);
      if (!out) continue;
      for (const line of out.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const found = {};
        try {
          const parsed = JSON.parse(trimmed);
          findOAuthFieldsDeep(parsed, 0, found);
        } catch {
          const b0 = trimmed.indexOf('{');
          const b1 = trimmed.lastIndexOf('}');
          if (b0 !== -1 && b1 > b0) {
            try {
              const sliced = JSON.parse(trimmed.slice(b0, b1 + 1));
              findOAuthFieldsDeep(sliced, 0, found);
            } catch {
              // ignore partial JSON slice
            }
          }
          const tokenMatch = trimmed.match(/ya29\.[A-Za-z0-9._-]+/);
          if (tokenMatch && !found.accessToken) found.accessToken = tokenMatch[0];
          const refreshMatch = trimmed.match(/1\/\/[A-Za-z0-9._-]+/);
          if (refreshMatch && !found.refreshToken) found.refreshToken = refreshMatch[0];
        }
        if (found.accessToken || found.refreshToken) return found;
        const decoded = decodeAntigravityTokens(trimmed);
        if (decoded) return decoded;
      }
    } catch {
      // ignore sqlite read failures
    }
  }
  return null;
}

function readAntigravityCredentialCandidates() {
  const candidates = [];
  const { oauthCred, manualToken } = getStoredCredential('gemini');

  if (oauthCred?.accessToken || oauthCred?.refreshToken) {
    candidates.push({
      accessToken: oauthCred.accessToken || null,
      refreshToken: oauthCred.refreshToken || null,
      expiresAt: oauthCred.expiresAt || null,
      email: oauthCred.email || readGeminiAccountHint(),
      clientId: oauthCred.clientId || OAUTH_SPECS.gemini.clientId,
      clientSecret: oauthCred.clientSecret || OAUTH_SPECS.gemini.clientSecret,
      source: 'oauth-session',
      saveOnRefresh: true
    });
  }

  const ideTokens = readAntigravityIdeTokens();
  if (ideTokens && (ideTokens.accessToken || ideTokens.refreshToken)) {
    candidates.push({
      accessToken: ideTokens.accessToken || null,
      refreshToken: ideTokens.refreshToken || null,
      expiresAt: null,
      email: ideTokens.email || readGeminiAccountHint(),
      clientId: ideTokens.clientId || OAUTH_SPECS.gemini.clientId,
      clientSecret: ideTokens.clientSecret || OAUTH_SPECS.gemini.clientSecret,
      source: 'local-cli',
      saveOnRefresh: true
    });
  }

  const filePaths = [
    path.join(os.homedir(), '.gemini', 'antigravity', 'oauth_creds.json'),
    path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
    path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'),
    ...(process.env.APPDATA
      ? [path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json')]
      : []),
    ...(process.env.CLOUDSDK_CONFIG
      ? [path.join(process.env.CLOUDSDK_CONFIG, 'application_default_credentials.json')]
      : [])
  ];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const found = findOAuthFieldsDeep(parsed, 0, {});
      if (found.accessToken || found.refreshToken) {
        candidates.push({
          accessToken: found.accessToken || null,
          refreshToken: found.refreshToken || null,
          expiresAt: parsed?.expiry_date || null,
          email: found.email || readGeminiAccountHint(),
          clientId: parsed?.client_id || found.clientId || OAUTH_SPECS.gemini.clientId,
          clientSecret: parsed?.client_secret || found.clientSecret || OAUTH_SPECS.gemini.clientSecret,
          source: 'local-cli',
          saveOnRefresh: false
        });
      }
    } catch {
      // ignore invalid JSON
    }
  }

  if (manualToken) {
    candidates.push({
      accessToken: manualToken,
      refreshToken: null,
      expiresAt: null,
      email: readGeminiAccountHint(),
      source: 'token',
      saveOnRefresh: false
    });
  }

  return candidates;
}

async function fetchGoogleUserIdentity(accessToken) {
  const res = await requestJsonHttps('https://www.googleapis.com/oauth2/v2/userinfo', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  return { email: res.ok ? res.data?.email || null : null, status: res.status };
}

async function fetchAntigravityLoadCodeAssist(accessToken) {
  const res = await requestJsonHttps('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'antigravity/1.0'
    },
    body: {
      metadata: {
        ideType: 'ANTIGRAVITY'
      }
    }
  });
  if (!res.ok || !res.data || typeof res.data !== 'object') {
    return { projectId: null, tierName: null };
  }
  const rawProj = res.data.cloudaicompanionProject;
  const projectId =
    typeof rawProj === 'string'
      ? rawProj
      : rawProj && typeof rawProj.id === 'string'
        ? rawProj.id
        : null;
  const tierName =
    res.data.currentTier?.name ||
    res.data.currentTier?.id ||
    res.data.paidTier?.name ||
    null;
  return { projectId, tierName };
}

async function fetchAntigravityModels(accessToken, projectId) {
  return requestJsonHttps('https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'antigravity/1.0'
    },
    body: projectId ? { project: projectId } : {}
  });
}

function summarizeAntigravityModels(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const entries = [];
  if (Array.isArray(payload.models)) {
    for (const model of payload.models) {
      if (!model || typeof model !== 'object') continue;
      entries.push([model.model || model.name || model.displayName || '', model]);
    }
  } else if (payload.models && typeof payload.models === 'object') {
    for (const [modelId, modelObj] of Object.entries(payload.models)) {
      if (!modelObj || typeof modelObj !== 'object') continue;
      entries.push([modelId, modelObj]);
    }
  }

  if (entries.length === 0) return null;

  let geminiMinRem = 1;
  let geminiResetForLowest = Infinity;
  let geminiEarliestReset = Infinity;
  let hasGeminiQuota = false;

  let partnerMinRem = 1;
  let partnerResetForLowest = Infinity;
  let partnerEarliestReset = Infinity;
  let hasPartnerQuota = false;

  for (const [rawId, model] of entries) {
    if (!rawId || rawId.startsWith('chat_') || rawId.startsWith('tab_') || model.isInternal) {
      continue;
    }
    const qi = model.quotaInfo;
    if (!qi || typeof qi !== 'object') continue;

    const rawFrac = qi.remainingFraction;
    const parsedFrac =
      typeof rawFrac === 'number'
        ? rawFrac
        : typeof rawFrac === 'string' && rawFrac.trim() !== ''
          ? Number(rawFrac)
          : NaN;
    const hasFraction = Number.isFinite(parsedFrac);
    const hasReset = Boolean(qi.resetTime);
    if (!hasFraction && !hasReset) continue;

    // Proto3 omits numeric 0.0 when resetTime is present
    const rem = hasFraction ? Math.max(0, Math.min(1, parsedFrac)) : 0;
    const resetMs = parseTimestampMs(qi.resetTime);
    const validResetMs = Number.isFinite(resetMs) && resetMs > Date.now() ? resetMs : Infinity;

    const lowerId = `${rawId} ${model.displayName || ''}`.toLowerCase();
    const isGeminiModel = lowerId.includes('gemini');
    const isPartnerModel =
      !isGeminiModel &&
      (lowerId.includes('claude') ||
        lowerId.includes('gpt') ||
        lowerId.includes('openai') ||
        lowerId.includes('sonnet') ||
        lowerId.includes('opus'));

    if (!isGeminiModel && !isPartnerModel) continue;

    if (isGeminiModel) {
      hasGeminiQuota = true;
      if (rem < geminiMinRem) {
        geminiMinRem = rem;
        geminiResetForLowest = validResetMs;
      } else if (rem === geminiMinRem && validResetMs < geminiResetForLowest) {
        geminiResetForLowest = validResetMs;
      }
      if (validResetMs < geminiEarliestReset) {
        geminiEarliestReset = validResetMs;
      }
    } else {
      hasPartnerQuota = true;
      if (rem < partnerMinRem) {
        partnerMinRem = rem;
        partnerResetForLowest = validResetMs;
      } else if (rem === partnerMinRem && validResetMs < partnerResetForLowest) {
        partnerResetForLowest = validResetMs;
      }
      if (validResetMs < partnerEarliestReset) {
        partnerEarliestReset = validResetMs;
      }
    }
  }

  const geminiUsed = hasGeminiQuota ? clampPercent((1 - geminiMinRem) * 100) : 0;
  const partnerUsed = hasPartnerQuota ? clampPercent((1 - partnerMinRem) * 100) : 0;

  const formatGroupReset = (hasQuota, usedPct, lowestReset, earliestReset, emptyMsg) => {
    if (!hasQuota) return emptyMsg;
    const targetReset = Number.isFinite(lowestReset) ? lowestReset : earliestReset;
    const countdown = Number.isFinite(targetReset) ? formatResetCountdown(targetReset) : null;
    if (usedPct === 0) {
      return countdown ? `사용 가능 (100% 잔여 · ${countdown})` : '사용 가능 (100% 잔여)';
    }
    return countdown || '사용 가능';
  };

  return {
    hasAnyQuota: hasGeminiQuota || hasPartnerQuota,
    gemini: {
      hidden: !hasGeminiQuota && hasPartnerQuota,
      used: geminiUsed,
      resetLabel: formatGroupReset(
        hasGeminiQuota,
        geminiUsed,
        geminiResetForLowest,
        geminiEarliestReset,
        '할당량 정보 없음'
      )
    },
    partner: {
      hidden: !hasPartnerQuota,
      used: partnerUsed,
      resetLabel: formatGroupReset(
        hasPartnerQuota,
        partnerUsed,
        partnerResetForLowest,
        partnerEarliestReset,
        'Claude · GPT 풀 없음'
      )
    }
  };
}

function verifiedGeminiAccount(value) {
  return typeof value === 'string' && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null;
}

function applyGeminiSummary(appState, summary, nowIso, email, source, method = 'oauth-session') {
  const bucket = (group, label) => ({ ...group, limit: 100, unit: '%', label });
  appState.quota = {
    ...appState.quota,
    gemini: {
      fiveHour: bucket(summary.gemini, 'Gemini 모델'),
      weekly: bucket(summary.partner, 'Claude · GPT 모델')
    },
    lastUpdatedAt: nowIso,
    source: 'oauth-sync'
  };
  appState.auth = { ...appState.auth, gemini: {
    connected: true,
    method,
    accountLabel: email || 'Antigravity Google',
    accountUnverified: !email,
    lastSyncedAt: nowIso,
    connectionSource: source,
    autoConnectDisabled: false,
    statusMessage: source === 'local-api'
      ? 'Antigravity 로컬 서비스에서 실시간 사용량을 확인했습니다.'
      : 'Antigravity 저장된 인증으로 실시간 사용량을 확인했습니다.'
  } };
}

function failGeminiSync(appState, message) {
  const previous = appState.auth.gemini;
  if (!previous.lastSyncedAt) {
    clearProviderFakeFallback(appState, 'gemini', message);
  }
  appState.auth = { ...appState.auth, gemini: {
    ...previous,
    connected: false,
    method: 'none',
    statusMessage: previous.lastSyncedAt ? `${message} 마지막 정상 조회 값을 표시합니다.` : message
  } };
  return false;
}

async function syncGeminiCli(appState, nowIso, expectedAccount, isCurrent) {
  const candidates = readAntigravityCredentialCandidates();

  for (const cand of candidates) {
    if (!isCurrent()) return false;
    let { accessToken, refreshToken, expiresAt, clientId, clientSecret, source, saveOnRefresh } = cand;
    let refreshedCredential = false;
    const refresh = async () => {
      const result = await refreshOAuthToken(OAUTH_SPECS.gemini, refreshToken, clientId, clientSecret);
      if (!result?.accessToken) return false;
      accessToken = result.accessToken;
      refreshToken = result.refreshToken;
      expiresAt = result.expiresAt;
      refreshedCredential = true;
      return true;
    };
    if ((!accessToken && refreshToken) || (typeof expiresAt === 'number' && expiresAt - Date.now() < 60_000 && refreshToken)) {
      await refresh();
    }
    if (!accessToken || !isCurrent()) continue;

    let identity = expectedAccount ? await fetchGoogleUserIdentity(accessToken) : null;
    if (!isCurrent()) return false;
    if (expectedAccount && [401, 403].includes(identity.status) && refreshToken && !refreshedCredential && await refresh()) {
      if (!isCurrent()) return false;
      identity = await fetchGoogleUserIdentity(accessToken);
    }
    let email = verifiedGeminiAccount(identity?.email);
    if (!isCurrent()) return false;
    if (expectedAccount && email !== expectedAccount) continue;

    let loadMeta = await fetchAntigravityLoadCodeAssist(accessToken);
    let res = await fetchAntigravityModels(accessToken, loadMeta.projectId);
    if ((res.status === 401 || res.status === 403) && refreshToken && await refresh()) {
      if (!isCurrent()) return false;
      email = verifiedGeminiAccount((await fetchGoogleUserIdentity(accessToken)).email);
      if (!isCurrent()) return false;
      if (expectedAccount && email !== expectedAccount) continue;
      loadMeta = await fetchAntigravityLoadCodeAssist(accessToken);
      res = await fetchAntigravityModels(accessToken, loadMeta.projectId);
    }
    if (!res.ok || !res.data || !isCurrent()) continue;
    const summary = summarizeAntigravityModels(res.data);
    if (!summary?.hasAnyQuota) continue;
    if (!email) email = verifiedGeminiAccount((await fetchGoogleUserIdentity(accessToken)).email);
    if (!isCurrent() || (expectedAccount && email !== expectedAccount)) return false;

    if (refreshedCredential && saveOnRefresh) {
      saveOAuthCredential('gemini', { accessToken, refreshToken, expiresAt, email, clientId, clientSecret });
    }
    applyGeminiSummary(appState, summary, nowIso, email, 'stored-auth', source === 'token' ? 'token' : 'oauth-session');
    return true;
  }
  return false;
}

async function syncGeminiHybrid(appState, nowIso, hooks) {
  const generation = ++geminiSyncGeneration;
  const isCurrent = () => geminiSyncGeneration === generation && !appState.auth.gemini.autoConnectDisabled
    && (!hooks?.getState || hooks.getState() === appState);
  const previous = appState.auth.gemini;
  const expectedAccount = verifiedGeminiAccount(previous.accountLabel);
  let local;
  try {
    local = await queryAntigravityLocal();
  } catch {
    local = { status: 'unavailable' };
  }
  if (!isCurrent()) return false;
  const email = verifiedGeminiAccount(local.accountLabel);
  if (expectedAccount && email && expectedAccount !== email) {
    return failGeminiSync(appState, 'Antigravity 계정이 다릅니다. 계정을 바꾸려면 연결 해제 후 다시 감지해 주세요.');
  }
  const summary = local.status === 'ok' ? summarizeAntigravityModels({ models: local.models }) : null;
  if (summary?.hasAnyQuota && (!expectedAccount || email === expectedAccount)) {
    applyGeminiSummary(appState, summary, nowIso, email, 'local-api');
    return true;
  }
  // Without a verified account, switching sources could silently mix two users' quotas.
  if (previous.accountUnverified && !expectedAccount && !email) {
    return failGeminiSync(appState, 'Antigravity 계정을 확인하지 못해 저장된 인증으로 전환하지 않았습니다. 앱에서 로그인한 뒤 로컬 인증 감지를 눌러 주세요.');
  }
  if (await syncGeminiCli(appState, nowIso, expectedAccount || email, isCurrent)) return true;
  if (!isCurrent()) return false;
  return failGeminiSync(appState, 'Antigravity 연결을 확인하지 못했습니다. 앱에서 로그인한 뒤 실행하고 [로컬 인증 감지]를 눌러 주세요.');
}

// =============================================================================
// Public API: detectLocalAuth / openOAuthLoginWindow / syncProviderQuota / etc.
// =============================================================================

function clearProviderFakeFallback(appState, provider, statusMessage) {
  if (provider === 'codex') {
    appState.quota.codex.fiveHour = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '웹 로그인 필요',
      label: '5시간 (5h)',
      hidden: true
    };
    appState.quota.codex.weekly = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '웹 로그인 필요',
      label: '주간 한도 (7d)',
      hidden: false
    };
    appState.auth.codex = {
      connected: false,
      method: 'none',
      statusMessage
    };
  } else if (provider === 'claude') {
    appState.quota.claude.fiveHour = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '웹 로그인 필요',
      label: '5시간 (5h)',
      hidden: false
    };
    appState.quota.claude.weekly = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '웹 로그인 필요',
      label: '일주일 (7d)',
      hidden: false
    };
    appState.quota.claude.fable = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '모델별 한도 없음',
      label: '모델별 한도',
      hidden: true
    };
    appState.auth.claude = {
      connected: false,
      method: 'none',
      accountLabel: readClaudeEmailHint() || undefined,
      statusMessage
    };
  } else if (provider === 'gemini') {
    appState.quota.gemini.fiveHour = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '로컬 인증 감지 필요',
      label: 'Gemini 모델',
      hidden: true
    };
    appState.quota.gemini.weekly = {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '로컬 인증 감지 필요',
      label: 'Claude · GPT 모델',
      hidden: true
    };
    appState.auth.gemini = {
      connected: false,
      method: 'none',
      statusMessage
    };
  }
}

async function detectLocalAuth(provider, appState, hooks, manual = Boolean(provider)) {
  const targets = provider ? [provider] : ['codex', 'claude', 'gemini'];
  const detected = [];
  const nowIso = new Date().toISOString();

  for (const id of targets) {
    if (id === 'codex') {
      const ok = await syncCodexCli(appState, nowIso);
      if (ok) {
        detected.push('ChatGPT·Codex');
      } else {
        clearProviderFakeFallback(
          appState,
          'codex',
          'Codex 인증 없음 — [🌐 웹 로그인] 또는 codex 로그인 필요'
        );
      }
    } else if (id === 'claude') {
      const ok = await syncClaudeCli(appState, nowIso);
      if (ok) {
        detected.push('Claude');
      } else {
        clearProviderFakeFallback(
          appState,
          'claude',
          'Claude OAuth 토큰 없음 — [🌐 웹 로그인]으로 연결해 주세요'
        );
      }
    } else if (id === 'gemini') {
      if (appState.auth.gemini.autoConnectDisabled && !manual) continue;
      if (manual) appState.auth = { ...appState.auth, gemini: { ...appState.auth.gemini, autoConnectDisabled: false } };
      if (await syncGeminiHybrid(appState, nowIso, hooks)) detected.push('Antigravity·Gemini');
    }
  }

  if (typeof hooks?.mergeLocalQuotaFile === 'function') {
    hooks.mergeLocalQuotaFile();
  }

  hooks?.saveState();
  hooks?.notifyStateUpdated();

  const message =
    detected.length > 0
      ? `실시간 사용량 연동 완료: ${detected.join(', ')}`
      : provider === 'gemini'
        ? appState.auth.gemini.statusMessage
        : '인증을 확인하지 못했습니다. Codex·Claude는 [🌐 웹 로그인], Antigravity는 앱에서 로그인한 뒤 [로컬 인증 감지]를 눌러 주세요.';
  return { ok: detected.length > 0, message, state: hooks?.getState?.() || appState };
}

function renderCallbackHtml(ok, title, subtitle) {
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const accent = ok ? '#10b981' : '#fb7185';
  const badge = ok ? '✓ 인증 완료' : '✕ 인증 실패';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>DotDock OAuth</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; }
    .card { width: 380px; padding: 28px; border-radius: 16px; background: #1e293b; border: 2px solid ${accent}; box-shadow: 0 20px 50px rgba(0,0,0,0.45); text-align: center; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: ${accent}; color: #0f172a; font-weight: 800; font-size: 12px; margin-bottom: 12px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 13px; color: #cbd5e1; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${badge}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </div>
</body>
</html>`;
}

function closeActiveOAuthServer(provider) {
  const existing = activeOAuthServers.get(provider);
  if (existing) {
    try {
      clearTimeout(existing.timer);
      existing.server.close();
    } catch {
      // ignore close errors
    }
    activeOAuthServers.delete(provider);
  }
}

function openOAuthLoginWindow(provider, appState, hooks) {
  const spec = OAUTH_SPECS[provider];
  if (!spec) {
    return Promise.resolve({ ok: false, message: '지원하지 않는 공급자입니다.', state: appState });
  }
  if (provider === 'gemini' && (!process.env.DOTDOCK_GOOGLE_CLIENT_ID || !spec.clientSecret)) {
    return Promise.resolve({
      ok: false,
      message: 'Antigravity에서 로그인한 뒤 로컬 인증 감지를 사용해 주세요. Google 직접 웹 로그인은 자체 OAuth 클라이언트 환경변수 DOTDOCK_GOOGLE_CLIENT_ID와 DOTDOCK_GOOGLE_CLIENT_SECRET 설정이 필요합니다.',
      state: appState
    });
  }

  closeActiveOAuthServer(provider);

  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  const oauthState = crypto.randomBytes(16).toString('hex');

  const authUrlObj = new URL(spec.authUrl);
  authUrlObj.searchParams.set('client_id', spec.clientId);
  authUrlObj.searchParams.set('redirect_uri', spec.redirectUri);
  authUrlObj.searchParams.set('response_type', 'code');
  authUrlObj.searchParams.set('scope', spec.scope);
  authUrlObj.searchParams.set('code_challenge', codeChallenge);
  authUrlObj.searchParams.set('code_challenge_method', 'S256');
  authUrlObj.searchParams.set('state', oauthState);
  if (spec.extraAuthParams) {
    for (const [k, v] of Object.entries(spec.extraAuthParams)) {
      authUrlObj.searchParams.set(k, v);
    }
  }
  const authUrl = authUrlObj.toString();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (ok, message) => {
      if (settled) return;
      settled = true;
      closeActiveOAuthServer(provider);
      resolve({ ok, message, state: appState });
    };

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${spec.redirectPort}`);
        if (reqUrl.pathname !== spec.redirectPath) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }

        const error = reqUrl.searchParams.get('error');
        const errorDesc = reqUrl.searchParams.get('error_description');
        const code = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');

        if (returnedState !== oauthState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, '상태 검증 실패', 'state 값이 일치하지 않습니다.'));
          finish(false, `${spec.label} OAuth state 불일치`);
          return;
        }

        if (error || !code) {
          const msg = errorDesc || error || '인증 코드가 전달되지 않았습니다.';
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, `${spec.label} 로그인 실패`, msg));
          finish(false, `${spec.label} 웹 로그인 취소/실패: ${msg}`);
          return;
        }

        const tokenRes = await exchangeAuthCode(spec, code, codeVerifier, oauthState);
        if (!tokenRes.ok || !tokenRes.data?.access_token) {
          const detail = tokenRes.data?.error_description || tokenRes.data?.error || `HTTP ${tokenRes.status}`;
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, `${spec.label} 토큰 발급 실패`, detail));
          finish(false, `${spec.label} 토큰 교환 실패: ${detail}`);
          return;
        }

        const idClaims = decodeJwtPayload(tokenRes.data.id_token);
        const accessClaims = decodeJwtPayload(tokenRes.data.access_token);
        const email =
          idClaims?.email ||
          accessClaims?.email ||
          tokenRes.data?.account?.email_address ||
          null;
        const accountId =
          idClaims?.['https://api.openai.com/auth']?.chatgpt_account_id ||
          accessClaims?.['https://api.openai.com/auth']?.chatgpt_account_id ||
          null;
        const planType =
          idClaims?.['https://api.openai.com/auth']?.chatgpt_plan_type ||
          accessClaims?.['https://api.openai.com/auth']?.chatgpt_plan_type ||
          null;

        saveOAuthCredential(provider, {
          accessToken: tokenRes.data.access_token,
          refreshToken: tokenRes.data.refresh_token || null,
          idToken: tokenRes.data.id_token || null,
          expiresAt: tokenRes.data.expires_in
            ? Date.now() + Number(tokenRes.data.expires_in) * 1000
            : null,
          email,
          accountId,
          planType,
          clientId: spec.clientId,
          clientSecret: spec.clientSecret || null
        });

        const syncResult = await detectLocalAuth(provider, appState, hooks);
        res.writeHead(syncResult.ok ? 200 : 502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          renderCallbackHtml(
            syncResult.ok,
            syncResult.ok ? `${spec.label} 연동 완료!` : `${spec.label} 사용량 동기화 실패`,
            syncResult.ok ? '이 브라우저 탭을 닫고 DotDock 현황판을 확인해 주세요.' : syncResult.message
          )
        );
        finish(syncResult.ok, syncResult.ok ? `${spec.label} 웹 OAuth 연동 및 사용량 동기화가 완료되었습니다.` : syncResult.message);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`OAuth callback error: ${err.message}`);
        finish(false, `${spec.label} OAuth 처리 오류: ${err.message}`);
      }
    });

    let triedIpv4Fallback = false;
    server.once('listening', () => {
      void shell.openExternal(authUrl);
    });

    server.on('error', (err) => {
      if (!triedIpv4Fallback && (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')) {
        triedIpv4Fallback = true;
        server.listen(spec.redirectPort, '127.0.0.1');
        return;
      }
      const hint =
        err.code === 'EADDRINUSE'
          ? `포트 ${spec.redirectPort}가 이미 사용 중입니다 (다른 CLI 로그인 창을 닫고 다시 시도해 주세요).`
          : err.message;
      finish(false, `${spec.label} 로컬 콜백 대기 실패: ${hint}`);
    });

    const timer = setTimeout(() => {
      finish(false, `${spec.label} 웹 로그인 대기 시간이 초과되었습니다 (3분).`);
    }, 180_000);

    activeOAuthServers.set(provider, { server, timer });

    server.listen(spec.redirectPort, spec.redirectHost);
  });
}

async function syncProviderQuota(provider, appState, hooks) {
  return detectLocalAuth(provider, appState, hooks, false);
}

async function saveProviderToken(provider, token, appState, hooks) {
  const meta = PROVIDER_META[provider];
  if (!meta) {
    return { ok: false, message: '지원하지 않는 공급자입니다.', state: appState };
  }
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    return { ok: false, message: '토큰 값을 입력해 주세요.', state: appState };
  }

  const secrets = readSecrets();
  if (!secrets.tokens || typeof secrets.tokens !== 'object') {
    secrets.tokens = {};
  }
  secrets.tokens[provider] = trimmed;
  if (!secrets.oauthTokens || typeof secrets.oauthTokens !== 'object') {
    secrets.oauthTokens = {};
  }
  secrets.oauthTokens[provider] = {
    ...(secrets.oauthTokens[provider] || {}),
    accessToken: trimmed,
    updatedAt: new Date().toISOString()
  };
  writeSecrets(secrets);

  const res = await detectLocalAuth(provider, appState, hooks);
  if (res.ok) {
    return {
      ok: true,
      message: `${meta.label} 토큰 저장 및 실시간 사용량 동기화를 완료했습니다.`,
      state: appState
    };
  }

  return {
    ok: false,
    message: `${meta.label} 토큰이 저장되었으나 API 응답을 받지 못했습니다. [🌐 웹 로그인]으로 다시 인증해 주세요.`,
    state: appState
  };
}

async function disconnectProvider(provider, appState, hooks) {
  const meta = PROVIDER_META[provider];
  if (!meta) {
    return { ok: false, message: '지원하지 않는 공급자입니다.', state: appState };
  }

  closeActiveOAuthServer(provider);
  if (provider === 'gemini') geminiSyncGeneration++;

  const secrets = readSecrets();
  let changed = false;
  if (secrets[provider]) {
    delete secrets[provider];
    changed = true;
  }
  if (secrets.tokens?.[provider]) {
    delete secrets.tokens[provider];
    changed = true;
  }
  if (secrets.oauthTokens?.[provider]) {
    delete secrets.oauthTokens[provider];
    changed = true;
  }
  if (changed) {
    writeSecrets(secrets);
  }

  clearProviderFakeFallback(appState, provider, `${meta.label} 연결 해제됨`);
  if (provider === 'gemini') appState.auth.gemini = { ...appState.auth.gemini, autoConnectDisabled: true };
  hooks?.saveState();
  hooks?.notifyStateUpdated();

  return {
    ok: true,
    message: `${meta.label} 연결이 해제되었습니다.`,
    state: appState
  };
}

async function credentialAction(action, provider, appState, hooks) {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof CredentialStoreError)) throw error;
    const targets = provider ? [provider] : Object.keys(PROVIDER_META);
    if (appState.auth) {
      appState.auth = { ...appState.auth };
      for (const id of targets) {
        appState.auth[id] = { ...appState.auth[id], connected: false, statusMessage: error.message };
      }
      hooks?.notifyStateUpdated?.();
    }
    return { ok: false, message: error.message, state: appState };
  }
}

module.exports = {
  PROVIDER_META,
  openOAuthLoginWindow: (provider, state, hooks) => credentialAction(() => openOAuthLoginWindow(provider, state, hooks), provider, state, hooks),
  detectLocalAuth: (provider, state, hooks) => credentialAction(() => detectLocalAuth(provider, state, hooks), provider, state, hooks),
  syncProviderQuota: (provider, state, hooks) => credentialAction(() => syncProviderQuota(provider, state, hooks), provider, state, hooks),
  saveProviderToken: (provider, token, state, hooks) => credentialAction(() => saveProviderToken(provider, token, state, hooks), provider, state, hooks),
  disconnectProvider: (provider, state, hooks) => credentialAction(() => disconnectProvider(provider, state, hooks), provider, state, hooks)
};
