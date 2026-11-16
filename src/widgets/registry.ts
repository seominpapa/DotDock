import { createElement } from 'react';
import type { WidgetDefinition } from '../types/dotdock';
import { AiQuotaWidget } from './ai-quota/AiQuotaWidget';
import { OAuthConnectWidget } from './oauth-connect/OAuthConnectWidget';
import { ScheduleMemoWidget } from './schedule-memo/ScheduleMemoWidget';
import { AppSettingsWidget } from './app-settings/AppSettingsWidget';

export type { WidgetContext, WidgetDefinition } from '../types/dotdock';

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    id: 'ai-quota',
    title: '현황',
    render: (ctx) => createElement(AiQuotaWidget, ctx)
  },
  {
    id: 'oauth-connect',
    title: '계정 연결',
    render: (ctx) => createElement(OAuthConnectWidget, ctx)
  },
  {
    id: 'schedule-memo',
    title: '일정·메모',
    render: (ctx) => createElement(ScheduleMemoWidget, ctx)
  },
  {
    id: 'app-settings',
    title: '앱 설정',
    render: (ctx) => createElement(AppSettingsWidget, ctx)
  }
];

export function getWidgetById(id: string): WidgetDefinition {
  const widgetId = id === 'system-memo' ? 'schedule-memo' : id;
  return WIDGET_REGISTRY.find((w) => w.id === widgetId) ?? WIDGET_REGISTRY[0];
}
