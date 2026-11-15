import { createElement } from 'react';
import type { WidgetDefinition } from '../types/dotdock';
import { AiQuotaWidget } from './ai-quota/AiQuotaWidget';
import { OAuthConnectWidget } from './oauth-connect/OAuthConnectWidget';
import { SystemMemoWidget } from './system-memo/SystemMemoWidget';

export type { WidgetContext, WidgetDefinition } from '../types/dotdock';

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    id: 'ai-quota',
    title: '⚡ 종합 현황',
    render: (ctx) => createElement(AiQuotaWidget, ctx)
  },
  {
    id: 'oauth-connect',
    title: '🔐 OAuth 연동',
    render: (ctx) => createElement(OAuthConnectWidget, ctx)
  },
  {
    id: 'system-memo',
    title: '🧩 시스템 · 메모',
    render: (ctx) => createElement(SystemMemoWidget, ctx)
  }
];

export function getWidgetById(id: string): WidgetDefinition {
  return WIDGET_REGISTRY.find((w) => w.id === id) ?? WIDGET_REGISTRY[0];
}
