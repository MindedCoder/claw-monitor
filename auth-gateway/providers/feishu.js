/**
 * 飞书 OAuth2 Provider
 *
 * 流程: 浏览器跳飞书授权页 → 用户同意 → 回调带 code → 换 user_access_token → 拿用户信息
 *
 * 需要配置:
 *   provider.appId      飞书开放平台应用 App ID
 *   provider.appSecret  飞书开放平台应用 App Secret
 *   provider.allowedDepartments  (可选) 允许的部门 ID 列表，空则不限
 */

// ── App Access Token 缓存 ───────────────────────────
let appTokenCache = { token: null, expiresAt: 0 };

async function getAppAccessToken(appId, appSecret) {
  if (appTokenCache.token && Date.now() < appTokenCache.expiresAt) {
    return appTokenCache.token;
  }
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`飞书 app_access_token 获取失败: ${data.msg}`);
  appTokenCache = {
    token: data.app_access_token,
    expiresAt: Date.now() + (data.expire - 60) * 1000,
  };
  return appTokenCache.token;
}

// ── Provider 接口 ───────────────────────────────────

/**
 * 返回飞书 OAuth 授权页 URL
 */
function getAuthUrl({ redirectUri, state, config }) {
  const params = new URLSearchParams({
    app_id: config.appId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`;
}

/**
 * 用 code 换取用户信息
 */
async function getUser({ code, config }) {
  const appToken = await getAppAccessToken(config.appId, config.appSecret);

  // code 换 user_access_token
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${appToken}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.code !== 0) {
    throw new Error(`飞书换 token 失败: ${tokenData.msg}`);
  }

  const userToken = tokenData.data.access_token;

  // 用 user_access_token 获取用户信息
  const userRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { 'Authorization': `Bearer ${userToken}` },
  });
  const userData = await userRes.json();
  if (userData.code !== 0) {
    throw new Error(`飞书获取用户信息失败: ${userData.msg}`);
  }

  return {
    id: userData.data.open_id,
    unionId: userData.data.union_id,
    name: userData.data.name,
    email: userData.data.email,
    avatar: userData.data.avatar_url,
    departmentIds: userData.data.department_ids || [],
  };
}

/**
 * (可选) 检查用户是否有权限
 */
function isAllowed(user, config) {
  // 没有配置限制 → 所有飞书用户都可以
  if (!config.allowedDepartments || config.allowedDepartments.length === 0) {
    return true;
  }
  // 检查用户部门是否在允许列表中
  return user.departmentIds.some(d => config.allowedDepartments.includes(d));
}

export default { getAuthUrl, getUser, isAllowed };
