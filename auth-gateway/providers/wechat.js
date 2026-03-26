/**
 * 微信 OAuth2 Provider（微信开放平台 - 网站应用）
 *
 * 流程: 跳微信扫码授权页 → 用户扫码确认 → 回调带 code → 换 access_token → 拿用户信息
 *
 * 需要配置:
 *   provider.appId      微信开放平台应用 AppID
 *   provider.appSecret  微信开放平台应用 AppSecret
 *   provider.allowedOpenIds  (可选) 允许的 openid 列表，空则不限
 *
 * 注意: 微信开放平台「网站应用」需要企业资质审核通过才能使用。
 *       如果是企业微信场景，OAuth URL 和接口略有不同，需额外适配。
 */

/**
 * 返回微信 OAuth 授权页 URL（扫码登录）
 */
function getAuthUrl({ redirectUri, state, config }) {
  const params = new URLSearchParams({
    appid: config.appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'snsapi_login',
    state,
  });
  return `https://open.weixin.qq.com/connect/qrconnect?${params}#wechat_redirect`;
}

/**
 * 用 code 换取用户信息
 */
async function getUser({ code, config }) {
  // code 换 access_token + openid
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.searchParams.set('appid', config.appId);
  tokenUrl.searchParams.set('secret', config.appSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');

  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();
  if (tokenData.errcode) {
    throw new Error(`微信换 token 失败: [${tokenData.errcode}] ${tokenData.errmsg}`);
  }

  const { access_token, openid } = tokenData;

  // 拉取用户信息
  const userUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  userUrl.searchParams.set('access_token', access_token);
  userUrl.searchParams.set('openid', openid);
  userUrl.searchParams.set('lang', 'zh_CN');

  const userRes = await fetch(userUrl);
  const userData = await userRes.json();
  if (userData.errcode) {
    throw new Error(`微信获取用户信息失败: [${userData.errcode}] ${userData.errmsg}`);
  }

  return {
    id: userData.openid,
    unionId: userData.unionid || null,
    name: userData.nickname,
    avatar: userData.headimgurl,
  };
}

/**
 * (可选) 检查用户是否有权限
 */
function isAllowed(user, config) {
  if (!config.allowedOpenIds || config.allowedOpenIds.length === 0) {
    return true;
  }
  return config.allowedOpenIds.includes(user.id);
}

export default { getAuthUrl, getUser, isAllowed };
