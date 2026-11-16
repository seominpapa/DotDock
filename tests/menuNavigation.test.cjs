const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');

function load(relative, stubs = {}) {
  const filename = path.resolve(__dirname, relative);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  compiled.require = (request) => {
    if (stubs[request]) return stubs[request];
    if (request === 'react') return { ...React, useState: (initial) => [initial, () => {}] };
    if (request.endsWith('.svg')) return request;
    if (request.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), request);
      const extension = fs.existsSync(`${target}.tsx`) ? '.tsx' : '.ts';
      return load(`${target}${extension}`, stubs);
    }
    return require(request);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX }
  }).outputText, filename);
  return compiled.exports;
}

function elements(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(elements)];
}

test('dashboard has distinct menus and restores the old memo destination', () => {
  const component = () => null;
  const registry = load('../src/widgets/registry.ts', {
    './ai-quota/AiQuotaWidget': { AiQuotaWidget: component },
    './oauth-connect/OAuthConnectWidget': { OAuthConnectWidget: component },
    './system-memo/SystemMemoWidget': { SystemMemoWidget: component },
    './schedule-memo/ScheduleMemoWidget': { ScheduleMemoWidget: component },
    './app-settings/AppSettingsWidget': { AppSettingsWidget: component }
  });
  assert.deepEqual(registry.WIDGET_REGISTRY.map(({ title }) => title),
    ['현황', '계정 연결', '일정·메모', '앱 설정']);
  assert.equal(registry.getWidgetById('system-memo').id, 'schedule-memo');
  assert.equal(registry.getWidgetById('unknown').id, 'ai-quota');
});

test('provider visibility can restore hidden providers without clearing quota selections', () => {
  const { AiQuotaWidget } = load('../src/widgets/ai-quota/AiQuotaWidget.tsx');
  const bucket = { used: 25, limit: 100, unit: '%', resetLabel: '대기' };
  const state = { enabledProviders: ['codex'], dockMetricIds: ['codex:weekly', 'claude:weekly'],
    showSystemWidget: false, autoSyncMinutes: 10,
    auth: { codex: {}, claude: {}, gemini: {} },
    quota: { lastUpdatedAt: '', source: 'manual', codex: { fiveHour: bucket, weekly: bucket },
      claude: { fiveHour: bucket, weekly: bucket, fable: bucket },
      gemini: { fiveHour: bucket, weekly: bucket } } };
  const patches = [];
  const controls = elements(AiQuotaWidget({ state, updateState: (patch) => patches.push(patch) }));
  const codex = controls.find((node) => node.props?.['aria-label'] === 'ChatGPT · Codex 현황 표시');
  const claude = controls.find((node) => node.props?.['aria-label'] === 'Claude 현황 표시');
  assert.ok(codex && claude);
  assert.equal(codex.props.disabled, true, 'at least one provider remains visible');
  claude.props.onChange();
  assert.deepEqual(patches, [{ enabledProviders: ['codex', 'claude'] }]);
  assert.deepEqual(state.dockMetricIds, ['codex:weekly', 'claude:weekly']);
  assert.deepEqual(state.enabledProviders, ['codex']);
});

test('app settings retain window actions and persist the single sync interval control', () => {
  const { AppSettingsWidget } = load('../src/widgets/app-settings/AppSettingsWidget.tsx');
  const calls = [];
  const tree = elements(AppSettingsWidget({
    state: { alwaysOnTop: true, launchAtLogin: true, autoSyncMinutes: 10,
      showSystemWidget: true, checkUpdatesOnStartup: true },
    updateState: (patch) => calls.push(patch),
    onToggleAlwaysOnTop: (flag) => calls.push(['alwaysOnTop', flag]),
    onResetPosition: () => calls.push('reset'),
    onReopenOnboarding: () => calls.push('onboarding'),
    onMinimize: () => calls.push('minimize')
  }));
  const alwaysRow = tree.find((node) => node.props?.className === 'settings-option-row'
    && elements(node).some((child) => child.type === 'span' && child.props.children === '항상 위에 표시 (Float)'));
  elements(alwaysRow).find((node) => node.type === 'button').props.onClick();
  tree.find((node) => node.type === 'button' && node.props.children[0] === 15).props.onClick();
  for (const label of ['위치 초기화 (우측 하단)', '초기 설정 열기', '상단 메뉴바로 최소화']) {
    tree.find((node) => node.type === 'button' && node.props.children === label).props.onClick();
  }
  assert.deepEqual(calls, [['alwaysOnTop', false], { autoSyncMinutes: 15 }, 'reset', 'onboarding', 'minimize']);
});

test('character settings keep birthday and all styles without account or app controls', () => {
  const { SettingsModal } = load('../src/components/SettingsModal.tsx');
  const tree = elements(SettingsModal({ state: { birthYear: 1996, birthDate: null,
    selectedZodiacId: 'dragon', characterStyle: 'vector', scale: 1 }, updateState: () => {} }));
  assert.ok(tree.some((node) => node.props?.id === 'settings-birth-date'));
  assert.ok(tree.some((node) => node.props?.id === 'settings-birth-year'));
  for (const label of ['벡터', '도트', '3D']) {
    assert.ok(tree.some((node) => node.type === 'button' && node.props.children === label));
  }
  assert.equal(tree.filter((node) => node.type === 'nav').length, 0);
  assert.equal(tree.filter((node) => node.props?.children === 'AI 쿼터 · 인증').length, 0);
});
