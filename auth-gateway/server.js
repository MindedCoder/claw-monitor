/**
 * Auth Gateway — 轻量认证网关
 *
 * 部署在 frp server 上，配合 nginx auth_request 使用。
 * 支持多种身份提供商（飞书、微信、Telegram、密码），通过配置切换。
 *
 * 端口默认 4180，与 oauth2-proxy 保持一致方便迁移。
 *
 * 路由:
 *   GET /auth/check      nginx auth_request 调用，检查 cookie → 200 | 401
 *   GET /auth/login       跳转到 IdP 授权页（或展示密码登录页）
 *   GET /auth/callback    IdP 回调，换 token、写 cookie、跳回原页面
 *   GET /auth/logout      清 cookie
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL, URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────
const CONFIG_PATH = process.env.AUTH_CONFIG_PATH || path.join(__dirname, 'config.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

const config = loadConfig();
const PORT = config.port || 4180;
const COOKIE_NAME = config.cookieName || '_auth_gw';
const COOKIE_MAX_AGE = config.cookieMaxAgeSec || 86400 * 7; // 7 days
const SECRET = config.secret || crypto.randomBytes(32).toString('hex');

// ── Session Store (in-memory, 重启丢失，够用) ───────
const sessions = new Map();

function createSession(user) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { user, createdAt: Date.now() });
  return id;
}

function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > COOKIE_MAX_AGE * 1000) {
    sessions.delete(id);
    return null;
  }
  return s;
}

// 定时清理过期 session
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > COOKIE_MAX_AGE * 1000) sessions.delete(id);
  }
}, 60_000);

// ── Provider loader ─────────────────────────────────
async function loadProvider(name) {
  const providerPath = path.join(__dirname, 'providers', `${name}.js`);
  if (!fs.existsSync(providerPath)) {
    throw new Error(`Provider "${name}" not found at ${providerPath}`);
  }
  const mod = await import(providerPath);
  return mod.default || mod;
}

let provider;

// ── Cookie helpers ──────────────────────────────────
function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  }
  return cookies;
}

function setSessionCookie(res, sessionId) {
  const cookie = `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

// ── URL helpers ─────────────────────────────────────
function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

function getRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}/auth/callback`;
}

// ── Route handlers ──────────────────────────────────

/** nginx auth_request → 200 (已登录) 或 401 (未登录) */
function handleCheck(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const session = getSession(cookies[COOKIE_NAME]);
  if (session) {
    res.writeHead(200, {
      'X-Auth-User': session.user.name || session.user.id || 'anonymous',
    });
    res.end('ok');
  } else {
    res.writeHead(401);
    res.end('unauthorized');
  }
}

/** 跳转到 IdP 授权页 */
async function handleLogin(req, res) {
  const url = parseUrl(req);
  // rd = 登录成功后跳回的原始页面
  const rd = url.searchParams.get('rd') || '/';
  const state = crypto.randomBytes(16).toString('hex');

  // 把 state -> rd 映射存起来（防 CSRF + 记住跳转目标）
  sessions.set(`state:${state}`, { rd, createdAt: Date.now() });

  const redirectUri = getRedirectUri(req);

  if (provider.renderLoginPage) {
    // password / telegram 等不走 OAuth 跳转的 provider
    const html = provider.renderLoginPage({ state, rd, redirectUri, config: config.provider });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const authUrl = provider.getAuthUrl({
    redirectUri,
    state,
    config: config.provider,
  });

  res.writeHead(302, { Location: authUrl });
  res.end();
}

/** IdP 回调 / 表单提交 */
async function handleCallback(req, res) {
  const url = parseUrl(req);

  let code, state, body;

  if (req.method === 'POST') {
    // password provider 表单提交
    body = await readBody(req);
    const params = new URLSearchParams(body);
    code = params.get('password') || params.get('code');
    state = params.get('state');
  } else {
    code = url.searchParams.get('code');
    state = url.searchParams.get('state');

    // Telegram Login Widget: 没有 code，所有用户数据作为 query 参数传入
    // 把完整 query string 作为 code 传给 provider
    if (!code && url.searchParams.has('hash')) {
      code = url.searchParams.toString();
    }
  }

  // 校验 state
  const stateData = sessions.get(`state:${state}`);
  if (!stateData) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h3>无效请求（state 不匹配或已过期）</h3><p><a href="/auth/login">重新登录</a></p>');
    return;
  }
  sessions.delete(`state:${state}`);
  const rd = stateData.rd || '/';

  try {
    const user = await provider.getUser({
      code,
      redirectUri: getRedirectUri(req),
      config: config.provider,
      body,
    });

    // 可选：权限检查
    if (provider.isAllowed && !provider.isAllowed(user, config.provider)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>无权访问</h3><p>你的账号没有访问权限，请联系管理员。</p>');
      return;
    }

    const sessionId = createSession(user);
    setSessionCookie(res, sessionId);

    res.writeHead(302, { Location: rd });
    res.end();
  } catch (err) {
    console.error('[auth-gateway] callback error:', err);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h3>登录失败</h3><pre>${escapeHtml(err.message)}</pre><p><a href="/auth/login?rd=${encodeURIComponent(rd)}">重试</a></p>`);
  }
}

/** 登出 */
function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (sid) sessions.delete(sid);
  clearSessionCookie(res);
  res.writeHead(302, { Location: '/' });
  res.end();
}

// ── Helpers ─────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ───────────────────────────────────────────
async function main() {
  const providerName = config.authProvider || 'password';
  console.log(`[auth-gateway] loading provider: ${providerName}`);
  provider = await loadProvider(providerName);

  if (provider.init) {
    await provider.init(config.provider);
  }

  http.createServer(async (req, res) => {
    const url = parseUrl(req);
    const pathname = url.pathname;

    try {
      if (pathname === '/auth/check')    return handleCheck(req, res);
      if (pathname === '/auth/login')    return await handleLogin(req, res);
      if (pathname === '/auth/callback') return await handleCallback(req, res);
      if (pathname === '/auth/logout')   return handleLogout(req, res);

      // health check
      if (pathname === '/healthz') {
        res.writeHead(200);
        res.end('ok');
        return;
      }

      res.writeHead(404);
      res.end('not found');
    } catch (err) {
      console.error('[auth-gateway] unhandled error:', err);
      res.writeHead(500);
      res.end('internal error');
    }
  }).listen(PORT, () => {
    console.log(`[auth-gateway] listening on :${PORT}, provider=${providerName}`);
  });
}

main().catch(err => {
  console.error('[auth-gateway] fatal:', err);
  process.exit(1);
});
