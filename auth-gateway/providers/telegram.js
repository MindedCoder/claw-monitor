/**
 * Telegram Login Widget Provider
 *
 * Telegram 不走标准 OAuth 跳转，而是在登录页嵌入 Telegram Login Widget。
 * 用户点击后 Telegram 回调页面，带上签名数据（HMAC-SHA-256）。
 *
 * 需要配置:
 *   provider.botToken     Telegram Bot Token（从 @BotFather 获取）
 *   provider.botUsername  Telegram Bot Username（不带 @）
 *   provider.allowedUserIds  (可选) 允许的 Telegram user ID 列表
 *
 * Telegram Widget 回调机制:
 *   Widget 会把 id, first_name, last_name, username, photo_url, auth_date, hash
 *   作为 query 参数附加到 data-auth-url 上，即 /auth/callback?state=xxx&id=123&hash=abc...
 *   server.js 把除 state/code 外的完整 query string 作为 code 传入 getUser。
 */

import crypto from 'node:crypto';

/**
 * 渲染包含 Telegram Login Widget 的登录页
 */
function renderLoginPage({ state, rd, redirectUri, config }) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录 - Telegram</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f0f2f5; }
    .card { background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,.08); text-align: center; }
    h2 { margin: 0 0 24px; color: #1a1a1a; }
    p { color: #666; margin: 16px 0 0; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>使用 Telegram 登录</h2>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${config.botUsername}"
      data-size="large"
      data-radius="8"
      data-auth-url="${redirectUri}?state=${state}"
      data-request-access="write">
    </script>
    <p>点击上方按钮通过 Telegram 验证身份</p>
  </div>
</body>
</html>`;
}

/**
 * 校验 Telegram 回调数据签名，返回用户信息
 *
 * server.js 约定：Telegram 场景下把完整 query string 作为 code 传入
 */
async function getUser({ code, config }) {
  const params = new URLSearchParams(code);

  const hash = params.get('hash');
  if (!hash) throw new Error('缺少 Telegram hash 参数');

  // 构建 data-check-string（排除 hash 和 state）
  const checkParams = [];
  for (const [k, v] of params) {
    if (k !== 'hash' && k !== 'state') checkParams.push(`${k}=${v}`);
  }
  checkParams.sort();
  const dataCheckString = checkParams.join('\n');

  // HMAC-SHA-256 校验
  const secretKey = crypto.createHash('sha256').update(config.botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (hmac !== hash) {
    throw new Error('Telegram 签名校验失败');
  }

  // 检查 auth_date 是否过期（允许 5 分钟）
  const authDate = parseInt(params.get('auth_date'), 10);
  if (Date.now() / 1000 - authDate > 300) {
    throw new Error('Telegram 授权已过期，请重新登录');
  }

  return {
    id: params.get('id'),
    name: [params.get('first_name'), params.get('last_name')].filter(Boolean).join(' '),
    username: params.get('username'),
    avatar: params.get('photo_url'),
  };
}

/**
 * (可选) 检查用户是否有权限
 */
function isAllowed(user, config) {
  if (!config.allowedUserIds || config.allowedUserIds.length === 0) {
    return true;
  }
  return config.allowedUserIds.includes(String(user.id));
}

export default { renderLoginPage, getUser, isAllowed };
