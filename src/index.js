import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStatusPageHook } from './hook-status-page.js';
import { monitorToolHandler } from './tool-infra.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function register(api) {
  const cfg = api.pluginConfig || {};
  const home = process.env.HOME || '/root';
  const dataDir = path.join(home, '.openclaw', 'infra-services');

  // 确保数据目录存在
  fs.mkdirSync(dataDir, { recursive: true });

  // ── 1. 注册飞书「处理中」通知 hook ──
  const hook = createStatusPageHook({ cfg, dataDir, logger: api.logger });

  api.on('message_received', async (event, ctx) => {
    if (ctx.channelId !== 'feishu') return;
    await hook.onReceived(event, ctx);
  });

  api.on('message_sent', async (event, ctx) => {
    if (ctx.channelId !== 'feishu') return;
    await hook.onSent(event, ctx);
  });

  // ── 2. 注册 infra_services 工具 ──
  api.registerTool({
    name: 'infra_services',
    description: '管理基础设施服务（监控面板 + frpc 隧道）：启动、停止、查看状态',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop', 'status'],
          description: '操作类型'
        },
        service: {
          type: 'string',
          enum: ['all', 'monitor', 'frpc'],
          description: '目标服务，默认 all',
          default: 'all'
        }
      },
      required: ['action']
    },
    handler: (params) => monitorToolHandler(params, { cfg, dataDir, home, pluginDir: __dirname })
  });

  api.logger.info?.('[infra-services] plugin registered: hook + tool');
}
