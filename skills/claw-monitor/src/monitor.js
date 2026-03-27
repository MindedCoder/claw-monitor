import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.INFRA_DATA_DIR || __dirname;
const CONFIG_PATH = process.env.INFRA_CONFIG_PATH || path.join(__dirname, 'config.json');
const LOG_PATH = path.join(DATA_DIR, 'monitor.log');
const WEB_PORT = process.env.WEB_PORT || 9001;
const HOME = process.env.HOME;
const OPENCLAW_CONFIG = path.join(HOME, '.openclaw', 'openclaw.json');
const OPENCLAW_GATEWAY_LOG = path.join(HOME, '.openclaw', 'logs', 'gateway.log');
const OPENCLAW_ERR_LOG = path.join(HOME, '.openclaw', 'logs', 'gateway.err.log');

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function log(msg) { const l = `${new Date().toISOString()} ${msg}`; console.log(l); fs.appendFileSync(LOG_PATH, l + '\n'); }

// ══════════════════════════════════════════
//  State
// ══════════════════════════════════════════
const state = {
  openclaw: { status: 'unknown', pid: null, uptime: null, memory: null, cpu: null, version: null, model: null, provider: null },
  ai: { status: '空闲', lastActivity: null, activeUser: null },
  health: { status: 'unknown', consecutiveFails: 0, lastCheck: null, lastOk: null, lastReason: null, downSince: null },
  feishuChat: { totalMessages: 0, recentMessages: [], uniqueUsers: new Set(), lastActivity: null },
  model: { totalTokensIn: 0, totalTokensOut: 0, totalCost: 0, estimated: true },
  system: { logs: [] },
  chatProbe: { history: [], lastCheck: null, todayTokens: 0, totalTokens: 0, todayDate: new Date().toISOString().slice(0, 10) },
  pingProbe: { history: [], lastCheck: null },
  codexUsage: { lastCheck: null, error: null, limitReached: false, primary: null, secondary: null, email: null, plan: null },
  startedAt: new Date().toISOString(),
  healthHistory: [],
};

function pushHealthHistory(e) { state.healthHistory.push(e); if (state.healthHistory.length > 100) state.healthHistory.shift(); }
function pushSystemLog(level, msg) { state.system.logs.push({ time: new Date().toISOString(), level, msg }); if (state.system.logs.length > 300) state.system.logs.shift(); }
function pushChatProbe(e) { state.chatProbe.history.push(e); if (state.chatProbe.history.length > 200) state.chatProbe.history.shift(); state.chatProbe.lastCheck = e.time; }
function pushPingProbe(e) { state.pingProbe.history.push(e); if (state.pingProbe.history.length > 200) state.pingProbe.history.shift(); state.pingProbe.lastCheck = e.time; }

// ══════════════════════════════════════════
//  Log Translation — 把英文日志翻译成人话
// ══════════════════════════════════════════
const LOG_TRANSLATIONS = [
  [/feishu_doc: Registered .+/, '飞书文档插件已加载'],
  [/feishu_chat: Registered .+/, '飞书聊天插件已加载'],
  [/feishu_wiki: Registered .+/, '飞书知识库插件已加载'],
  [/feishu_drive: Registered .+/, '飞书云盘插件已加载'],
  [/feishu_bitable: Registered .+/, '飞书多维表格插件已加载'],
  [/\[plugins\] plugins\.allow is empty.+/, '插件安全：未设置白名单，第三方插件将自动加载'],
  [/duplicate plugin id detected.+/, '检测到重复插件，后加载的会覆盖之前的'],
  [/canvas.*host mounted at (.+)/, '画布服务已启动'],
  [/\[heartbeat\] started/, '心跳检测已启动'],
  [/\[health-monitor\] started.+/, '健康监控已启动'],
  [/agent model: (.+)/, (_, m) => `AI 模型已加载: ${m}`],
  [/listening on .+PID (\d+)\)/, (_, pid) => `网关已启动 (进程 ${pid})`],
  [/log file: (.+)/, (_, f) => `日志文件: ${f}`],
  [/\[info\].*client ready/, '客户端连接就绪'],
  [/\[info\].*event-dispatch is ready/, '事件分发器就绪'],
  [/Browser control listening on (.+)/, '浏览器控制服务已启动'],
  [/starting feishu.+mode: (\w+)/, (_, m) => `飞书通道启动中 (${m} 模式)`],
  [/bot open_id resolved: (.+)/, '飞书机器人身份已确认'],
  [/starting WebSocket connection/, '正在建立飞书 WebSocket 连接'],
  [/WebSocket client started/, 'WebSocket 连接已建立'],
  [/ws client ready/, 'WebSocket 连接就绪'],
  [/received message from (\S+) in .+\((\w+)\)/, (_, uid, type) => `收到${type === 'p2p' ? '私聊' : '群聊'}消息 (${uid.slice(0, 8)}...)`],
  [/DM from (\S+): (.+)/, (_, uid, msg) => `用户私信: "${msg.slice(0, 30)}"`],
  [/dispatching to agent \(session=(.+)\)/, '正在分配 AI 处理任务'],
  [/dispatch complete.+replies=(\d+)/, (_, n) => `AI 处理完成，回复了 ${n} 条消息`],
  [/pairing request sender=(.+)/, '新用户配对请求'],
  [/device pairing auto-approved/, '设备自动配对成功'],
  [/config change detected.+/, '检测到配置变更，准备重载'],
  [/signal SIGTERM received/, '收到关闭信号'],
  [/received SIGTERM; shutting down/, '正在优雅关闭服务'],
  [/abort signal received, stopping/, '飞书通道正在关闭'],
  [/gmail watcher stopped/, 'Gmail 监听已停止'],
  [/auto-enabled plugins/, '自动启用的插件'],
  [/feishu configured, enabled automatically/, '飞书插件已自动启用'],
  [/dedup warmup loaded (\d+) entries/, (_, n) => `去重缓存已加载 ${n} 条记录`],
  [/\[reload\] config change requires gateway restart.+(\d+) operation/, (_, n) => `配置变更需要重启网关，等待 ${n} 个操作完成`],
  [/Config overwrite: .+/, '配置文件已更新并备份'],
  [/tools\.profile.+unknown entries \((.+)\)/, (_, tools) => `工具配置警告: ${tools} 在当前环境不可用`],
  [/exec failed:.+command not found: (\w+)/, (_, cmd) => `命令 ${cmd} 未找到`],
  [/exec failed:.+node: not found/, 'Node.js 未找到，部分功能可能不可用'],
  [/security audit: device access upgrade.+/, '设备权限升级请求'],
  [/missing scope: (.+)/, (_, s) => `权限不足: 缺少 ${s}`],
  [/\[ws\].*reconnect/, 'WebSocket 重新连接'],
  [/ENOTFOUND open\.feishu\.cn/, '网络异常: 无法连接飞书服务器'],
  [/AxiosError.+ENOTFOUND/, '网络请求失败: DNS 解析异常'],
  [/Health check passed/, '健康检查通过'],
  [/Health check failed: (.+)/, (_, r) => `健康检查失败: ${r}`],
  [/Service recovered after (\d+)s/, (_, s) => `服务已恢复，宕机 ${s} 秒`],
  [/OpenClaw is DOWN/, 'OpenClaw 服务已宕机！'],
  [/Monitor started on port (\d+)/, (_, p) => `监控面板已在端口 ${p} 启动`],
  [/Monitor initialized.+/, '监控服务初始化完成'],
];

function translateLog(raw) {
  for (const [pattern, replacement] of LOG_TRANSLATIONS) {
    const match = raw.match(pattern);
    if (match) {
      return typeof replacement === 'function' ? replacement(...match) : replacement;
    }
  }
  // fallback: clean up common patterns
  return raw
    .replace(/^\[[\w/-]+\]\s*/, '')
    .replace(/^\[[\w/-]+\]\s*/, '')
    .slice(0, 120);
}

// ══════════════════════════════════════════
//  1. Process Status
// ══════════════════════════════════════════
function checkProcess(config) {
  try {
    const out = execSync(`ps aux | grep -i "${config.openclawProcessName}" | grep -v grep`, { encoding: 'utf8', timeout: 5000 });
    const lines = out.trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const parts = lines[0].split(/\s+/);
      state.openclaw.pid = parts[1];
      state.openclaw.cpu = parts[2] + '%';
      state.openclaw.memory = parts[3] + '%';
      state.openclaw.status = 'running';
      try { state.openclaw.uptime = execSync(`ps -p ${parts[1]} -o etime=`, { encoding: 'utf8', timeout: 3000 }).trim(); } catch { state.openclaw.uptime = '-'; }
      return;
    }
  } catch {}
  try {
    const out = execSync(`ps aux | grep "node.*openclaw\\|node.*workspace" | grep -v grep`, { encoding: 'utf8', timeout: 5000 });
    const lines = out.trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const parts = lines[0].split(/\s+/);
      state.openclaw.pid = parts[1]; state.openclaw.cpu = parts[2] + '%'; state.openclaw.memory = parts[3] + '%'; state.openclaw.status = 'running';
      try { state.openclaw.uptime = execSync(`ps -p ${parts[1]} -o etime=`, { encoding: 'utf8', timeout: 3000 }).trim(); } catch { state.openclaw.uptime = '-'; }
      return;
    }
  } catch {}
  state.openclaw = { ...state.openclaw, status: 'stopped', pid: null, uptime: null, memory: null, cpu: null };
}

// ══════════════════════════════════════════
//  2. Health Check
// ══════════════════════════════════════════
async function checkHealth(url) {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000);
    const res = await fetch(url, { signal: c.signal }); clearTimeout(t);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: body.ok === true, reason: body.ok ? null : 'ok=false' };
  } catch (err) { return { ok: false, reason: err.message }; }
}

// ══════════════════════════════════════════
//  3. Feishu Chat Stats
// ══════════════════════════════════════════
function parseFeishuLogs(config) {
  // 优先从 feishu-notify hook 日志读取（有更多元数据）
  const hookLog = path.join(config.workspace, 'data', 'status-page-notify-debug.log');
  if (fs.existsSync(hookLog)) {
    try {
      const content = fs.readFileSync(hookLog, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const users = new Set(); const messages = [];
      for (const line of lines) {
        const m = line.match(/^(\S+) event (.+)$/);
        if (m) { try { const d = JSON.parse(m[2]); const ctx = d.context || {}; const name = ctx.metadata?.senderName || 'unknown'; users.add(name); messages.push({ time: m[1], name, senderId: ctx.metadata?.senderId || '' }); } catch {} }
      }
      if (messages.length > 0) {
        state.feishuChat.totalMessages = messages.length;
        state.feishuChat.recentMessages = messages.slice(-20);
        state.feishuChat.uniqueUsers = users;
        state.feishuChat.lastActivity = messages[messages.length - 1].time;
        return;
      }
    } catch {}
  }

  // fallback: 从 gateway.log 解析飞书消息
  try {
    const stat = fs.statSync(OPENCLAW_GATEWAY_LOG);
    const readSize = Math.min(stat.size, 131072); // 读最后 128KB
    const fd = fs.openSync(OPENCLAW_GATEWAY_LOG, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    const lines = tail.split('\n');
    const users = new Set(); const messages = [];
    for (const line of lines) {
      // "received message from ou_xxxx in ... (p2p)" or "DM from ou_xxxx: ..."
      const recv = line.match(/^(\S+)\s+.*received message from (\S+) in .+\((\w+)\)/);
      if (recv) {
        const uid = recv[2].slice(0, 12);
        users.add(uid);
        messages.push({ time: recv[1], name: uid, senderId: recv[2] });
        continue;
      }
      const dm = line.match(/^(\S+)\s+.*DM from (\S+):/);
      if (dm) {
        const uid = dm[2].slice(0, 12);
        users.add(uid);
        messages.push({ time: dm[1], name: uid, senderId: dm[2] });
      }
    }
    state.feishuChat.totalMessages = messages.length;
    state.feishuChat.recentMessages = messages.slice(-20);
    state.feishuChat.uniqueUsers = users;
    state.feishuChat.lastActivity = messages.length > 0 ? messages[messages.length - 1].time : null;
  } catch {}
}

// ══════════════════════════════════════════
//  4. OpenClaw Config & AI Activity
// ══════════════════════════════════════════
function parseOpenClawConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    state.openclaw.version = data.meta?.lastTouchedVersion || null;
    state.openclaw.model = data.agents?.defaults?.model?.primary || null;
    state.openclaw.provider = state.openclaw.model?.split('/')[0] || null;
  } catch {}
}

function parseModelUsage() {
  const exchanges = state.feishuChat.totalMessages;
  state.model.totalTokensIn = exchanges * 800;
  state.model.totalTokensOut = exchanges * 1200;
  state.model.totalCost = ((state.model.totalTokensIn * 3 + state.model.totalTokensOut * 15) / 1000000);
  state.model.estimated = true;
}

// ══════════════════════════════════════════
//  5. AI Activity Status (from gateway.log)
// ══════════════════════════════════════════
function detectAIActivity() {
  // Read the last few KB of gateway.log to find latest activity
  try {
    const stat = fs.statSync(OPENCLAW_GATEWAY_LOG);
    const readSize = Math.min(stat.size, 8192);
    const fd = fs.openSync(OPENCLAW_GATEWAY_LOG, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    const lines = tail.split('\n').filter(l => l.trim()).reverse();

    for (const line of lines) {
      const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+]+)/);
      const time = timeMatch ? timeMatch[1] : null;

      if (line.includes('dispatch complete')) {
        const age = time ? (Date.now() - new Date(time).getTime()) / 1000 : 999;
        if (age < 60) { state.ai = { status: '刚回复完', lastActivity: time, activeUser: null }; return; }
        state.ai = { status: '空闲', lastActivity: time, activeUser: null }; return;
      }
      if (line.includes('dispatching to agent')) {
        const age = time ? (Date.now() - new Date(time).getTime()) / 1000 : 999;
        if (age < 120) {
          // check if there's a user name nearby
          const userMatch = tail.match(/DM from (\S+):/);
          state.ai = { status: '思考中...', lastActivity: time, activeUser: userMatch?.[1]?.slice(0, 12) || null };
          return;
        }
      }
      if (line.includes('received message') && line.includes('p2p')) {
        const age = time ? (Date.now() - new Date(time).getTime()) / 1000 : 999;
        if (age < 30) { state.ai = { status: '收到消息，准备处理', lastActivity: time, activeUser: null }; return; }
      }
    }
    // no recent activity
    const lastTime = lines.find(l => l.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+]+)/));
    state.ai = { status: '空闲', lastActivity: lastTime?.match(/^(\S+)/)?.[1] || null, activeUser: null };
  } catch {
    state.ai = { status: '未知', lastActivity: null, activeUser: null };
  }
}

// ══════════════════════════════════════════
//  6. System Logs (gateway + err + json)
// ══════════════════════════════════════════
let lastGatewayLogSize = 0, lastErrLogSize = 0, lastJsonLogSize = 0;

function readNewLines(filePath, lastSize) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= lastSize) return { lines: [], newSize: lastSize };
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(stat.size - lastSize, 32768));
    fs.readSync(fd, buf, 0, buf.length, lastSize);
    fs.closeSync(fd);
    return { lines: buf.toString('utf8').split('\n').filter(l => l.trim()), newSize: stat.size };
  } catch { return { lines: [], newSize: lastSize }; }
}

function parseGatewayLogs() {
  // gateway.log
  const gw = readNewLines(OPENCLAW_GATEWAY_LOG, lastGatewayLogSize);
  lastGatewayLogSize = gw.newSize;
  for (const line of gw.lines) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+]+)\s+(.+)$/);
    if (m) {
      const level = line.includes('error') || line.includes('Error') ? 'error' : line.includes('warn') || line.includes('WARN') ? 'warn' : 'info';
      const translated = translateLog(m[2]);
      if (translated.length > 3) pushSystemLog(level, translated);
    }
  }

  // gateway.err.log
  const err = readNewLines(OPENCLAW_ERR_LOG, lastErrLogSize);
  lastErrLogSize = err.newSize;
  for (const line of err.lines) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+]+)\s+(.+)$/);
    if (m) { const translated = translateLog(m[2]); if (translated.length > 3) pushSystemLog('warn', translated); }
  }

  // JSON log
  const today = new Date().toISOString().slice(0, 10);
  const jsonLogPath = `/tmp/openclaw/openclaw-${today}.log`;
  const jl = readNewLines(jsonLogPath, lastJsonLogSize);
  lastJsonLogSize = jl.newSize;
  for (const line of jl.lines) {
    try {
      const entry = JSON.parse(line);
      const level = entry._meta?.logLevelName === 'WARN' ? 'warn' : entry._meta?.logLevelName === 'ERROR' ? 'error' : 'info';
      const msg = entry['1'] || entry['0'] || '';
      if (msg.includes('▄▄▄') || msg.includes('OPENCLAW') || msg.length < 5) continue;
      const translated = translateLog(msg.replace(/\\n/g, ' '));
      if (translated.length > 3) pushSystemLog(level, translated);
    } catch {}
  }
}

// ══════════════════════════════════════════
//  Chat Probe — 定时用 OpenClaw 模型测试聊天
// ══════════════════════════════════════════
async function chatProbe(config) {
  const probe = config.chatProbe;
  if (!probe?.enabled) return;

  const gatewayUrl = probe.url || `http://127.0.0.1:${config.gatewayPort || 18789}/v1/chat/completions`;
  const token = probe.token || '';
  const model = probe.model || 'openclaw:probe';
  const testMessage = probe.testMessage || 'hi';
  const timeoutMs = probe.timeoutMs || 30000;

  const entry = { time: new Date().toISOString(), ok: false, responseMs: null, reply: null, error: null };
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: testMessage }],
        max_tokens: 10,
        stream: false,
        thinking: { type: 'disabled' },
        user: 'claw-monitor-probe',
        conversation_id: `claw-monitor-probe-${Math.floor(Date.now() / 3600000)}`
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    entry.responseMs = Date.now() - start;

    if (!res.ok) {
      entry.error = `HTTP ${res.status} ${res.statusText}`;
      const body = await res.text().catch(() => '');
      if (body) entry.error += `: ${body.slice(0, 200)}`;
    } else {
      const data = await res.json();
      entry.ok = true;
      entry.reply = data.choices?.[0]?.message?.content?.slice(0, 50) || '(empty)';
      log(`[CHAT-PROBE] response keys: ${Object.keys(data).join(',')} usage=${JSON.stringify(data.usage || null)}`);
      // 读取 API 返回的真实 usage
      if (data.usage) {
        const promptTokens = data.usage.prompt_tokens || data.usage.input_tokens || 0;
        const completionTokens = data.usage.completion_tokens || data.usage.output_tokens || 0;
        entry.usage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens
        };
      }
    }
  } catch (err) {
    entry.responseMs = Date.now() - start;
    entry.error = err.name === 'AbortError' ? `timeout (${timeoutMs}ms)` : err.message;
  }

  // 统计 token 消耗（日结 + 总计，仅按输入+输出）
  const thisTokens = (entry.usage?.promptTokens || 0) + (entry.usage?.completionTokens || 0);
  const today = new Date().toISOString().slice(0, 10);
  if (state.chatProbe.todayDate !== today) {
    state.chatProbe.todayTokens = 0;
    state.chatProbe.totalTokens = 0;
    state.chatProbe.todayDate = today;
  }
  state.chatProbe.todayTokens += thisTokens;
  state.chatProbe.totalTokens += thisTokens;

  pushChatProbe(entry);
  const status = entry.ok ? 'ok' : 'error';
  const tokenStr = thisTokens > 0 ? ` in=${entry.usage?.promptTokens || 0} out=${entry.usage?.completionTokens || 0}` : '';
  const dailyTotal = state.chatProbe.todayTokens > 1000 ? (state.chatProbe.todayTokens / 1000).toFixed(1) + 'k' : state.chatProbe.todayTokens;
  const allTotal = state.chatProbe.totalTokens > 1000 ? (state.chatProbe.totalTokens / 1000).toFixed(1) + 'k' : state.chatProbe.totalTokens;
  pushSystemLog(status, `Chat 探针: ${entry.ok ? '正常' : '异常'} (${entry.responseMs}ms)${tokenStr} [today=${dailyTotal} total=${allTotal}]${entry.error ? ' — ' + entry.error : ''}`);
  log(`[CHAT-PROBE] ok=${entry.ok} ${entry.responseMs}ms${tokenStr} today=${dailyTotal} total=${allTotal} ${entry.error || ''}`);
}

// ══════════════════════════════════════════
//  Ping Probe — 定时 ping Google
// ══════════════════════════════════════════
async function pingProbe(config) {
  const probe = config.pingProbe;
  if (!probe?.enabled) return;

  const url = probe.url || 'https://www.google.com';
  const timeoutMs = probe.timeoutMs || 10000;

  const entry = { time: new Date().toISOString(), ok: false, responseMs: null, statusCode: null, error: null, url };
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);

    entry.responseMs = Date.now() - start;
    entry.statusCode = res.status;
    entry.ok = res.ok;
    if (!res.ok) entry.error = `HTTP ${res.status}`;
  } catch (err) {
    entry.responseMs = Date.now() - start;
    entry.error = err.name === 'AbortError' ? `timeout (${timeoutMs}ms)` : err.message;
  }

  pushPingProbe(entry);
  log(`[PING-PROBE] ${url} ok=${entry.ok} ${entry.responseMs}ms ${entry.error || ''}`);
}

// ══════════════════════════════════════════
//  Codex Usage Probe — 查询 Codex 配额使用情况
// ══════════════════════════════════════════
const AUTH_PROFILES_PATH = path.join(HOME, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');

function readCodexAccessToken() {
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_PROFILES_PATH, 'utf8'));
    return data?.profiles?.['openai-codex:default']?.access || null;
  } catch { return null; }
}

async function codexUsageProbe() {
  const token = readCodexAccessToken();
  if (!token) {
    state.codexUsage.error = 'no token';
    log('[CODEX-USAGE] openai-codex:default access token not found');
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'OpenClaw-Monitor/1.0', 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      state.codexUsage.error = `HTTP ${res.status}`;
      log(`[CODEX-USAGE] failed: HTTP ${res.status}`);
      return;
    }

    const data = await res.json();
    const rl = data.rate_limit || {};
    state.codexUsage = {
      lastCheck: new Date().toISOString(),
      error: null,
      limitReached: rl.limit_reached || false,
      primary: rl.primary_window ? {
        usedPercent: rl.primary_window.used_percent,
        resetAt: new Date(rl.primary_window.reset_at * 1000).toISOString(),
      } : null,
      secondary: rl.secondary_window ? {
        usedPercent: rl.secondary_window.used_percent,
        resetAt: new Date(rl.secondary_window.reset_at * 1000).toISOString(),
      } : null,
      email: data.email || null,
      plan: data.plan_type || null,
    };
    const p = state.codexUsage.primary;
    const s = state.codexUsage.secondary;
    log(`[CODEX-USAGE] ok: 5h=${p?.usedPercent ?? '-'}% weekly=${s?.usedPercent ?? '-'}% limitReached=${state.codexUsage.limitReached}`);
  } catch (err) {
    state.codexUsage.error = err.name === 'AbortError' ? 'timeout' : err.message;
    log(`[CODEX-USAGE] error: ${state.codexUsage.error}`);
  }
}

// ══════════════════════════════════════════
//  Feishu Alert
// ══════════════════════════════════════════
let feishuTokenCache = { token: null, expiresAt: 0 };
async function getFeishuToken(appId, appSecret) {
  if (feishuTokenCache.token && Date.now() < feishuTokenCache.expiresAt) return feishuTokenCache.token;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }) });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu token error: ${data.msg}`);
  feishuTokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + (data.expire - 60) * 1000 };
  return feishuTokenCache.token;
}
async function sendFeishuCard(config, title, content, template) {
  const { appId, appSecret, alertOpenId } = config.feishu;
  if (!alertOpenId) return;
  try {
    const token = await getFeishuToken(appId, appSecret);
    const card = { header: { title: { tag: 'plain_text', content: title }, template }, elements: [{ tag: 'div', text: { tag: 'lark_md', content } }] };
    await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ receive_id: alertOpenId, msg_type: 'interactive', content: JSON.stringify(card) }) });
  } catch (err) { pushSystemLog('error', `飞书告警发送失败: ${err.message}`); }
}

// ══════════════════════════════════════════
//  Main Tick
// ══════════════════════════════════════════
async function tick(config) {
  checkProcess(config);
  const result = await checkHealth(config.healthUrl);
  const now = new Date();
  state.health.lastCheck = now.toISOString();
  pushHealthHistory({ time: now.toISOString(), ok: result.ok, reason: result.reason });

  if (result.ok) {
    if (state.health.status === 'down') {
      const sec = (Date.now() - new Date(state.health.downSince).getTime()) / 1000;
      pushSystemLog('ok', `服务已恢复，宕机 ${Math.round(sec)} 秒`);
      sendFeishuCard(config, 'OpenClaw 已恢复', `宕机持续 **${Math.round(sec)}秒**`, 'green');
    }
    state.health.status = 'ok'; state.health.consecutiveFails = 0; state.health.lastOk = now.toISOString(); state.health.lastReason = null; state.health.downSince = null;
  } else {
    state.health.consecutiveFails++; state.health.lastReason = result.reason;
    if (state.health.status !== 'down' && state.health.consecutiveFails >= config.failThreshold) {
      state.health.status = 'down'; state.health.downSince = now.toISOString();
      pushSystemLog('error', 'OpenClaw 服务已宕机！');
      sendFeishuCard(config, 'OpenClaw 服务异常', `连续失败 **${state.health.consecutiveFails}** 次\n原因: ${result.reason}`, 'red');
    } else if (state.health.status !== 'down') { state.health.status = 'degraded'; }
  }

  parseFeishuLogs(config);
  parseOpenClawConfig();
  parseModelUsage();
  detectAIActivity();
  parseGatewayLogs();

  log(`[TICK] process=${state.openclaw.status} health=${state.health.status} ai=${state.ai.status}`);
}

// ══════════════════════════════════════════
//  Dashboard Render
// ══════════════════════════════════════════
function esc(s) { return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
function toBJ(iso) { if (!iso) return '-'; return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); }
function toBJTime(iso) { if (!iso) return '-'; return new Date(iso).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); }
function toRelative(iso) {
  if (!iso) return '-';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return '刚刚';
  if (sec < 60) return sec + '秒前';
  const min = Math.round(sec / 60);
  if (min < 60) return min + '分钟前';
  const hr = Math.round(min / 60);
  return hr + '小时前';
}

function renderDashboard(config) {
  const overallStatus =
    state.health.status === 'down' && state.openclaw.status === 'stopped' ? 'error'
    : state.health.status === 'down' || state.openclaw.status === 'stopped' ? 'warning'
    : state.health.status === 'degraded' ? 'warning'
    : state.openclaw.status === 'running' ? 'ok' : 'unknown';
  const badgeMap = { ok: ['运行正常','#22c55e'], error: ['服务异常','#ef4444'], warning: ['状态异常','#f59e0b'], unknown: ['未知','#94a3b8'] };
  const [badgeLabel, badgeColor] = badgeMap[overallStatus] || badgeMap.unknown;

  const bars = state.healthHistory.map(h => `<div class="hbar" style="background:${h.ok?'#22c55e':'#ef4444'};height:${h.ok?28:10}px" title="${esc(toBJ(h.time))}"></div>`).join('');

  const tokIn = state.model.totalTokensIn > 1000 ? (state.model.totalTokensIn / 1000).toFixed(1) + 'k' : state.model.totalTokensIn;
  const tokOut = state.model.totalTokensOut > 1000 ? (state.model.totalTokensOut / 1000).toFixed(1) + 'k' : state.model.totalTokensOut;
  const cost = state.model.totalCost > 0 ? '$' + state.model.totalCost.toFixed(4) : '-';
  const estBadge = state.model.estimated ? '<span class="est">(预估)</span>' : '';

  // Feishu 是否有数据
  const hasFeishu = !!config?.feishu?.appId || state.feishuChat.totalMessages > 0 || state.feishuChat.uniqueUsers.size > 0;

  // Sessions
  const sessionMap = new Map();
  for (const m of state.feishuChat.recentMessages) {
    const k = m.senderId || m.name; const ex = sessionMap.get(k);
    if (!ex || m.time > ex.time) sessionMap.set(k, { name: m.name, time: m.time, count: (ex?.count || 0) + 1 });
    else ex.count++;
  }
  const sessions = [...sessionMap.values()].sort((a, b) => b.time.localeCompare(a.time));
  const sessionRows = sessions.map(s => `<tr><td class="accent">${esc(s.name)}</td><td class="dim">${toBJ(s.time)}</td><td class="dim">${s.count} 条</td></tr>`).join('');

  // Logs
  const logRows = state.system.logs.slice(-50).reverse().map(l => {
    const cls = l.level === 'error' ? 'log-error' : l.level === 'warn' ? 'log-warn' : l.level === 'ok' ? 'log-ok' : '';
    return `<tr><td class="dim nowrap">${toBJTime(l.time)}</td><td class="${cls}">${esc(l.msg)}</td></tr>`;
  }).join('');

  const users = [...state.feishuChat.uniqueUsers];
  const healthLabel = { ok: '正常', down: '宕机', degraded: '异常', unknown: '未知' };

  // Probe stats
  const latestChatProbe = state.chatProbe.history.length > 0 ? state.chatProbe.history[state.chatProbe.history.length - 1] : null;
  const latestPingProbe = state.pingProbe.history.length > 0 ? state.pingProbe.history[state.pingProbe.history.length - 1] : null;
  const probeChatStatus = latestChatProbe ? (latestChatProbe.ok ? '正常' : '异常') : '未知';
  const probePingStatus = latestPingProbe ? (latestPingProbe.ok ? '正常' : '异常') : '未知';
  const probeChatTokens = state.chatProbe.totalTokens > 1000 ? (state.chatProbe.totalTokens / 1000).toFixed(1) + 'k' : state.chatProbe.totalTokens;
  const probeChatIn = latestChatProbe?.usage?.promptTokens ?? '-';
  const probeChatOut = latestChatProbe?.usage?.completionTokens ?? '-';

  // AI status
  const aiStatusColor = state.ai.status === '空闲' ? '#94a3b8' : state.ai.status.includes('思考') ? '#f59e0b' : state.ai.status.includes('回复') ? '#22c55e' : '#38bdf8';
  const aiPulse = state.ai.status !== '空闲' && state.ai.status !== '未知';

  // Codex usage
  const cx = state.codexUsage;
  const cxHas = cx.lastCheck && !cx.error;
  const cxPrimary = cx.primary?.usedPercent ?? '-';
  const cxSecondary = cx.secondary?.usedPercent ?? '-';
  const cxPrimaryReset = cx.primary?.resetAt ? toBJ(cx.primary.resetAt) : '-';
  const cxSecondaryReset = cx.secondary?.resetAt ? toBJ(cx.secondary.resetAt) : '-';
  const cxBarColor = (pct) => pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
  const cxBar = (pct) => typeof pct === 'number' ? `<div style="margin-top:6px;height:6px;border-radius:3px;background:rgba(148,163,184,.15);overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:3px;background:${cxBarColor(pct)}"></div></div>` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>OpenClaw 监控</title>
<style>
:root{color-scheme:dark;--card-bg:rgba(15,23,42,.82);--card-border:rgba(148,163,184,.18);--stat-bg:rgba(8,17,32,.6);--stat-border:rgba(148,163,184,.1)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#eaf2ff;min-height:100vh;-webkit-text-size-adjust:100%;
  background:radial-gradient(circle at top right,rgba(79,70,229,.18),transparent 28%),radial-gradient(circle at left top,rgba(14,165,233,.15),transparent 24%),linear-gradient(180deg,#081120,#0f172a)}
.app{max-width:1100px;margin:0 auto;padding:20px 12px 32px}

.topbar{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;padding-bottom:20px;flex-wrap:wrap}
.eyebrow{color:#7dd3fc;font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:6px}
h1{font-size:clamp(22px,5vw,40px);font-weight:700;line-height:1.2}
.sub{color:#cbd5e1;font-size:13px;margin-top:4px}
.badge{display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.1em;border:1px solid;white-space:nowrap}
.badge::before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 10px currentColor;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* AI Status Banner */
.ai-banner{background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;backdrop-filter:blur(12px)}
.ai-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.ai-dot.pulse{animation:pulse 1.5s infinite}
.ai-label{font-size:15px;font-weight:600}
.ai-detail{color:#94a3b8;font-size:12px;margin-left:auto}

.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:18px;box-shadow:0 8px 30px rgba(2,6,23,.3);backdrop-filter:blur(12px);padding:16px;overflow:hidden}
.card.full{grid-column:1/-1}
.card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap}
.card-title{color:#7dd3fc;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
.card-badge{font-size:10px;padding:3px 8px;border-radius:999px;font-weight:600;letter-spacing:.06em;white-space:nowrap}

.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.stats-3{grid-template-columns:repeat(3,1fr)}
.stats-4{grid-template-columns:repeat(4,1fr)}
.stat-box{background:var(--stat-bg);border:1px solid var(--stat-border);border-radius:12px;padding:10px 12px}
.stat-label{color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.12em}
.stat-val{font-size:18px;font-weight:700;margin-top:3px;color:#f1f5f9;word-break:break-all}
.stat-val.green{color:#22c55e}.stat-val.red{color:#ef4444}.stat-val.yellow{color:#f59e0b}.stat-val.cyan{color:#38bdf8}

.hbars{display:flex;align-items:flex-end;gap:2px;height:32px;overflow:hidden}
.hbar{width:6px;border-radius:2px;min-height:3px;flex-shrink:0}

table{width:100%;border-collapse:collapse}
td{padding:4px 8px 4px 0;font-size:12px;border-bottom:1px solid rgba(148,163,184,.06);vertical-align:top}
.dim{color:#64748b}.accent{color:#38bdf8;font-weight:500}.nowrap{white-space:nowrap}
.est{color:#94a3b8;font-size:10px;margin-left:4px}
.log-error{color:#ef4444}.log-warn{color:#f59e0b}.log-ok{color:#22c55e}
.tag{display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:500;margin:2px}
.tag-user{background:rgba(56,189,248,.15);color:#7dd3fc}
.footer{text-align:center;color:#475569;font-size:10px;letter-spacing:.08em;margin-top:16px;line-height:1.6}

/* Mobile */
@media(max-width:640px){
  .app{padding:12px 8px 24px}
  .grid{grid-template-columns:1fr;gap:12px}
  .stats,.stats-3,.stats-4{grid-template-columns:repeat(2,1fr)}
  .card{padding:14px;border-radius:14px}
  .stat-val{font-size:16px}
  h1{font-size:24px}
  .ai-banner{padding:12px 14px}
  .ai-detail{margin-left:0;width:100%}
  td{font-size:11px;padding:3px 6px 3px 0}
}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div>
      <p class="eyebrow">监控面板</p>
      <h1>OpenClaw 监控中心</h1>
      <p class="sub">独立监控 · 实时状态 · 5秒刷新</p>
    </div>
    <div class="badge" style="color:${badgeColor}">${badgeLabel}</div>
  </header>

  <!-- AI 状态横幅 -->
  <div class="ai-banner">
    <div class="ai-dot ${aiPulse?'pulse':''}" style="background:${aiStatusColor};box-shadow:0 0 8px ${aiStatusColor}"></div>
    <span class="ai-label">AI 状态: ${esc(state.ai.status)}</span>
    <span class="ai-detail">${state.ai.activeUser ? '正在为用户服务' : ''}${state.ai.lastActivity ? ' · 最后活动 ' + toRelative(state.ai.lastActivity) : ''}</span>
  </div>

  <div class="grid">
    <!-- 探针状态 -->
    <div class="card full">
      <div class="card-head">
        <span class="card-title">探针状态</span>
        <span class="card-badge" style="background:rgba(56,189,248,.12);color:#38bdf8">靠前展示</span>
      </div>
      <div class="stats stats-4">
        <div class="stat-box"><div class="stat-label">Chat 探针</div><div class="stat-val ${probeChatStatus==='正常'?'green':probeChatStatus==='异常'?'red':'yellow'}">${probeChatStatus}</div></div>
        <div class="stat-box"><div class="stat-label">Chat 延迟</div><div class="stat-val">${latestChatProbe?.responseMs ? latestChatProbe.responseMs + 'ms' : '-'}</div></div>
        <div class="stat-box"><div class="stat-label">Chat 合计</div><div class="stat-val cyan">${probeChatTokens}</div></div>
        <div class="stat-box"><div class="stat-label">Chat 最近</div><div class="stat-val">${latestChatProbe?.time ? toRelative(latestChatProbe.time) : '-'}</div></div>
        <div class="stat-box"><div class="stat-label">Ping 探针</div><div class="stat-val ${probePingStatus==='正常'?'green':probePingStatus==='异常'?'red':'yellow'}">${probePingStatus}</div></div>
        <div class="stat-box"><div class="stat-label">Ping 延迟</div><div class="stat-val">${latestPingProbe?.responseMs ? latestPingProbe.responseMs + 'ms' : '-'}</div></div>
        <div class="stat-box"><div class="stat-label">Chat In/Out</div><div class="stat-val cyan">${probeChatIn}/${probeChatOut}</div></div>
        <div class="stat-box"><div class="stat-label">Ping 最近</div><div class="stat-val">${latestPingProbe?.time ? toRelative(latestPingProbe.time) : '-'}</div></div>
      </div>
    </div>

    <!-- Codex 配额 -->
    <div class="card full">
      <div class="card-head">
        <span class="card-title">Codex 配额</span>
        <span class="card-badge" style="background:${cx.limitReached?'rgba(239,68,68,.15);color:#ef4444':'rgba(34,197,94,.15);color:#22c55e'}">${cx.limitReached?'已限额':cxHas?'正常':'未知'}</span>
      </div>
      <div class="stats stats-4">
        <div class="stat-box"><div class="stat-label">5h 已用</div><div class="stat-val ${typeof cxPrimary==='number'?(cxPrimary>=90?'red':cxPrimary>=70?'yellow':'green'):''}">${cxPrimary}%</div>${cxBar(cxPrimary)}</div>
        <div class="stat-box"><div class="stat-label">5h 重置</div><div class="stat-val">${cxPrimaryReset}</div></div>
        <div class="stat-box"><div class="stat-label">周已用</div><div class="stat-val ${typeof cxSecondary==='number'?(cxSecondary>=90?'red':cxSecondary>=70?'yellow':'green'):''}">${cxSecondary}%</div>${cxBar(cxSecondary)}</div>
        <div class="stat-box"><div class="stat-label">周重置</div><div class="stat-val">${cxSecondaryReset}</div></div>
      </div>
      <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <span class="dim" style="font-size:11px">${cx.email?esc(cx.email):'-'} · ${cx.plan||'-'} · 更新于 ${cx.lastCheck?toRelative(cx.lastCheck):'-'}${cx.error?' · <span style="color:#ef4444">'+esc(cx.error)+'</span>':''}</span>
        <button onclick="fetch('${BASE_PATH}/api/codex-usage/refresh').then(()=>{})" style="background:rgba(56,189,248,.15);color:#7dd3fc;border:1px solid rgba(56,189,248,.25);border-radius:8px;padding:4px 12px;font-size:11px;cursor:pointer;font-weight:600">刷新配额</button>
      </div>
    </div>

    <!-- 服务状态 -->
    <div class="card">
      <div class="card-head">
        <span class="card-title">服务状态</span>
        <span class="card-badge" style="background:${state.openclaw.status==='running'?'rgba(34,197,94,.15);color:#22c55e':'rgba(239,68,68,.15);color:#ef4444'}">${state.openclaw.status==='running'?'运行中':'已停止'}</span>
      </div>
      <div class="stats stats-3">
        <div class="stat-box"><div class="stat-label">版本</div><div class="stat-val">${state.openclaw.version||'-'}</div></div>
        <div class="stat-box"><div class="stat-label">进程 ID</div><div class="stat-val">${state.openclaw.pid||'-'}</div></div>
        <div class="stat-box"><div class="stat-label">运行时长</div><div class="stat-val">${state.openclaw.uptime||'-'}</div></div>
        <div class="stat-box"><div class="stat-label">CPU</div><div class="stat-val">${state.openclaw.cpu||'-'}</div></div>
        <div class="stat-box"><div class="stat-label">内存</div><div class="stat-val">${state.openclaw.memory||'-'}</div></div>
        <div class="stat-box"><div class="stat-label">认证</div><div class="stat-val">${state.openclaw.provider?'OAuth':'-'}</div></div>
      </div>
    </div>

    <!-- 模型信息 -->
    <div class="card">
      <div class="card-head">
        <span class="card-title">模型信息</span>
        <span class="card-badge" style="background:rgba(56,189,248,.12);color:#38bdf8">${state.openclaw.model||'-'}</span>
      </div>
      <div class="stats stats-3">
        <div class="stat-box"><div class="stat-label">模型</div><div class="stat-val cyan">${state.openclaw.model?.split('/')[1]||'-'}</div></div>
        <div class="stat-box"><div class="stat-label">提供商</div><div class="stat-val">${state.openclaw.provider||'-'}</div></div>
        <div class="stat-box"><div class="stat-label">对话数</div><div class="stat-val">${state.feishuChat.totalMessages}</div></div>
        <div class="stat-box"><div class="stat-label">输入</div><div class="stat-val cyan">${tokIn}${estBadge}</div></div>
        <div class="stat-box"><div class="stat-label">输出</div><div class="stat-val cyan">${tokOut}</div></div>
        <div class="stat-box"><div class="stat-label">费用</div><div class="stat-val">${cost}</div></div>
      </div>
    </div>

    <!-- 健康检查 -->
    <div class="card full">
      <div class="card-head">
        <span class="card-title">健康检查</span>
        <span class="card-badge" style="background:${state.health.status==='ok'?'rgba(34,197,94,.15);color:#22c55e':state.health.status==='down'?'rgba(239,68,68,.15);color:#ef4444':'rgba(245,158,11,.15);color:#f59e0b'}">${healthLabel[state.health.status]||'未知'}</span>
      </div>
      <div class="stats stats-4" style="margin-bottom:12px">
        <div class="stat-box"><div class="stat-label">可用率</div><div class="stat-val green">${state.healthHistory.length>0?((state.healthHistory.filter(h=>h.ok).length/state.healthHistory.length)*100).toFixed(1)+'%':'-'}</div></div>
        <div class="stat-box"><div class="stat-label">上次检查</div><div class="stat-val">${toBJTime(state.health.lastCheck)}</div></div>
        <div class="stat-box"><div class="stat-label">上次正常</div><div class="stat-val">${toBJTime(state.health.lastOk)}</div></div>
        <div class="stat-box"><div class="stat-label">宕机时长</div><div class="stat-val ${state.health.downSince?'red':''}">${state.health.downSince?Math.round((Date.now()-new Date(state.health.downSince).getTime())/1000)+'秒':'-'}</div></div>
      </div>
      <div class="hbars">${bars||'<span class="dim">等待数据...</span>'}</div>
    </div>

    ${hasFeishu ? `<!-- 飞书会话 -->
    <div class="card">
      <div class="card-head">
        <span class="card-title">飞书会话</span>
        <span class="card-badge" style="background:rgba(56,189,248,.12);color:#38bdf8">${sessions.length} 个会话</span>
      </div>
      <div style="margin-bottom:8px">
        <div class="stat-label" style="margin-bottom:5px">活跃用户</div>
        ${users.length>0?users.map(u=>`<span class="tag tag-user">${esc(u)}</span>`).join(''):'<span class="dim" style="font-size:12px">暂无</span>'}
      </div>
      <div class="stat-label" style="margin-bottom:4px">最近会话</div>
      <div style="max-height:180px;overflow-y:auto;-webkit-overflow-scrolling:touch">
        <table>${sessionRows||'<tr><td class="dim">暂无会话</td></tr>'}</table>
      </div>
    </div>` : ''}

    <!-- 系统日志 -->
    <div class="card">
      <div class="card-head">
        <span class="card-title">系统日志</span>
        <span class="card-badge" style="background:rgba(148,163,184,.1);color:#94a3b8">${state.system.logs.length} 条</span>
      </div>
      <div style="max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch">
        <table>${logRows||'<tr><td class="dim">暂无日志</td></tr>'}</table>
      </div>
    </div>
  </div>

  <div class="footer">
    监控目标: ${esc(config.healthUrl)} · 间隔 ${config.checkIntervalMs/1000}秒<br>启动于 ${toBJ(state.startedAt)} · 每5秒实时刷新
  </div>
</div>
<script>
(function(){
  async function refresh(){
    try{
      const r = await fetch('${BASE_PATH}/api/html');
      if(!r.ok) return;
      const html = await r.text();
      document.querySelector('.app').innerHTML = html;
    }catch(e){}
    requestAnimationFrame(()=>setTimeout(refresh, 1500));
  }
  setTimeout(refresh, 1500);
})();
</script>
</body>
</html>`;
}

// ══════════════════════════════════════════
//  Web Server
// ══════════════════════════════════════════
let BASE_PATH = '';

function generateFrpcToml(config) {
  const name = config.instanceName;
  if (!name) return;
  const frpcPath = path.join(__dirname, 'frpc.toml');
  const frpc = config.frpc || {};
  const toml = `serverAddr = "${frpc.serverAddr || '8.135.54.217'}"
serverPort = ${frpc.serverPort || 7000}

[[proxies]]
name = "${name}"
type = "http"
localIP = "127.0.0.1"
localPort = ${WEB_PORT}
customDomains = ["${frpc.customDomain || 'claw.bfelab.com'}"]
locations = ["/${name}"]
`;
  fs.writeFileSync(frpcPath, toml);
  log(`[FRPC] Generated frpc.toml: name=${name}, location=/${name}`);
}

// ══════════════════════════════════════════
//  frpc 子进程管理（自动重启，取代 crontab）
// ══════════════════════════════════════════
let frpcProcess = null;

function startFrpc(config) {
  const tomlPath = path.join(DATA_DIR, 'frpc.toml');
  if (!fs.existsSync(tomlPath)) {
    log('[FRPC] frpc.toml not found, skipping');
    return;
  }

  const frpcBin = [
    path.join(HOME, 'bin', 'frpc'),
    '/usr/local/bin/frpc',
    '/usr/bin/frpc'
  ].find(p => fs.existsSync(p));

  if (!frpcBin) {
    log('[FRPC] frpc binary not found, skipping');
    pushSystemLog('warning', 'frpc 未安装，跳过隧道启动');
    return;
  }

  function launch() {
    if (frpcProcess) return;
    const logFile = path.join(DATA_DIR, 'frpc.log');
    const out = fs.openSync(logFile, 'a');
    frpcProcess = spawn(frpcBin, ['-c', tomlPath], {
      stdio: ['ignore', out, out],
    });
    log(`[FRPC] started pid=${frpcProcess.pid}`);
    pushSystemLog('ok', `frpc 已启动 (pid ${frpcProcess.pid})`);

    frpcProcess.on('exit', (code) => {
      log(`[FRPC] exited code=${code}, restarting in 5s...`);
      pushSystemLog('warning', `frpc 退出 (code=${code})，5秒后重启`);
      frpcProcess = null;
      setTimeout(launch, 5000);
    });
  }

  launch();
}

function renderWelcomePage(config) {
  const instanceName = config.instanceName || 'default';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BFE Claw</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#0f172a; color:#e2e8f0; min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .container { text-align:center; max-width:600px; padding:40px; }
  .logo { font-size:64px; margin-bottom:24px; }
  h1 { font-size:36px; font-weight:700; background:linear-gradient(135deg,#60a5fa,#a78bfa); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:12px; }
  .subtitle { font-size:18px; color:#94a3b8; margin-bottom:40px; }
  .instance { display:inline-block; background:#1e293b; border:1px solid #334155; border-radius:8px; padding:8px 20px; font-size:14px; color:#cbd5e1; margin-bottom:32px; }
  .instance span { color:#60a5fa; font-weight:600; }
  .footer { margin-top:60px; font-size:13px; color:#475569; }
</style>
</head>
<body>
<div class="container">
  <div class="logo">🦀</div>
  <h1>Welcome to BFE Claw</h1>
  <p class="subtitle">AI-Powered Monitoring & Infrastructure</p>
  <div class="instance">Instance: <span>${instanceName}</span></div>
  <p class="footer">Powered by OpenClaw</p>
</div>
</body>
</html>`;
}

function startWebServer(config) {
  BASE_PATH = config.instanceName ? '/' + config.instanceName : '';
  const basePath = BASE_PATH;

  http.createServer((req, res) => {
    // Strip basePath prefix for routing
    log(`[WEB] raw req.url=${req.url} basePath=${basePath}`);
    let urlPath = req.url;
    if (basePath && urlPath.startsWith(basePath)) {
      urlPath = urlPath.slice(basePath.length) || '/';
    }

    if (urlPath === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ ...state, feishuChat: { ...state.feishuChat, uniqueUsers: [...state.feishuChat.uniqueUsers] } }));
      return;
    }
    if (urlPath === '/api/chat-probe') {
      const latest = state.chatProbe.history.length > 0 ? state.chatProbe.history[state.chatProbe.history.length - 1] : null;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ data: latest }));
      return;
    }
    if (urlPath === '/api/ping-probe') {
      const latest = state.pingProbe.history.length > 0 ? state.pingProbe.history[state.pingProbe.history.length - 1] : null;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ data: latest }));
      return;
    }
    if (urlPath === '/api/codex-usage') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ data: state.codexUsage }));
      return;
    }
    if (urlPath === '/api/codex-usage/refresh') {
      codexUsageProbe().then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ data: state.codexUsage }));
      });
      return;
    }
    if (urlPath === '/api/html') {
      // Return only the inner content of .app for fast DOM swap
      const full = renderDashboard(config);
      const start = full.indexOf('<div class="app">') + '<div class="app">'.length;
      const end = full.lastIndexOf('</div>\n</body>');
      const inner = full.slice(start, end);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(inner);
      return;
    }
    // ── 静态文件服务 ──
    // 从 static/ 目录提供文件，如 /youzan/data.html -> static/youzan/data.html
    const STATIC_DIR = path.join(DATA_DIR, 'static');
    const parsed = new URL(urlPath, 'http://localhost');
    const safePath = path.normalize(parsed.pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(STATIC_DIR, safePath);

    // 防止路径穿越
    if (filePath.startsWith(STATIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const MIME = {
        '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
        '.css': 'text/css', '.js': 'application/javascript',
        '.json': 'application/json', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.pdf': 'application/pdf', '.csv': 'text/csv',
      };
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // /bfemonitor → 监控面板
    if (urlPath === '/bfemonitor' || urlPath === '/bfemonitor/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboard(config));
      return;
    }

    // 根路径 → 欢迎页
    if (urlPath === '/' || urlPath === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderWelcomePage(config));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1>');
  }).listen(WEB_PORT, () => {
    log(`[WEB] Dashboard at http://localhost:${WEB_PORT}`);
    pushSystemLog('ok', `监控面板已在端口 ${WEB_PORT} 启动`);
  });
}

async function main() {
  const config = loadConfig();

  // instanceName 直接从 config.json 读取，不再依赖 openclaw.json

  log(`[START] Monitoring ${config.healthUrl} every ${config.checkIntervalMs / 1000}s (instance=${config.instanceName || 'default'})`);
  generateFrpcToml(config);
  pushSystemLog('ok', '监控服务初始化完成');
  startFrpc(config);
  startWebServer(config);
  await tick(config);
  setInterval(() => tick(config), config.checkIntervalMs);

  // Chat Probe 定时器
  if (config.chatProbe?.enabled) {
    const interval = config.chatProbe.intervalMs || 300000;
    log(`[CHAT-PROBE] enabled, interval ${interval / 1000}s`);
    pushSystemLog('ok', `Chat 探针已启动，间隔 ${interval / 1000}秒`);
    chatProbe(config);
    setInterval(() => chatProbe(config), interval);
  }

  // Ping Probe 定时器
  if (config.pingProbe?.enabled) {
    const interval = config.pingProbe.intervalMs || 30000;
    log(`[PING-PROBE] enabled, interval ${interval / 1000}s`);
    pushSystemLog('ok', `Ping 探针已启动，间隔 ${interval / 1000}秒`);
    pingProbe(config);
    setInterval(() => pingProbe(config), interval);
  }

  // Codex Usage 定时器（5分钟）
  log('[CODEX-USAGE] enabled, interval 300s');
  pushSystemLog('ok', 'Codex 配额探针已启动，间隔 300秒');
  codexUsageProbe();
  setInterval(() => codexUsageProbe(), 300000);
}

main();
