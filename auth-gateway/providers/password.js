/**
 * Password Provider — 简单密码登录（兜底方案）
 *
 * 不依赖任何第三方平台，一个密码就能用。
 * 适合个人使用或临时部署。
 *
 * 需要配置:
 *   provider.password   登录密码
 *   provider.username   (可选) 显示用户名，默认 "admin"
 */

/**
 * 渲染密码登录页
 */
function renderLoginPage({ state, rd, redirectUri, config }) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f0f2f5; }
    .card { background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,.08); width: 360px; }
    h2 { margin: 0 0 24px; color: #1a1a1a; text-align: center; }
    input[type=password] { width: 100%; padding: 12px 16px; border: 1px solid #d9d9d9; border-radius: 8px; font-size: 16px; outline: none; transition: border .2s; }
    input[type=password]:focus { border-color: #4096ff; }
    button { width: 100%; padding: 12px; margin-top: 16px; background: #1677ff; color: #fff; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; transition: background .2s; }
    button:hover { background: #4096ff; }
    .error { color: #ff4d4f; text-align: center; margin-top: 12px; font-size: 14px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔒 请输入密码</h2>
    <form method="POST" action="/auth/callback">
      <input type="hidden" name="state" value="${state}">
      <input type="password" name="password" placeholder="访问密码" autofocus required>
      <button type="submit">登录</button>
    </form>
    <p class="error" id="err"></p>
  </div>
</body>
</html>`;
}

/**
 * 校验密码
 */
async function getUser({ code, config }) {
  const password = code; // password provider 里 code 就是用户输入的密码
  if (!password || password !== config.password) {
    throw new Error('密码错误');
  }
  return {
    id: 'local',
    name: config.username || 'admin',
  };
}

export default { renderLoginPage, getUser };
