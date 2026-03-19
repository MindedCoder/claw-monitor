import fs from 'node:fs';
import path from 'node:path';

/**
 * 飞书「处理中」通知 hook
 *
 * message_received → 发送「⏳ 正在处理中请稍后，点击查看进度」
 * message_sent     → 撤回上面那条通知
 * 兜底：3 分钟自动撤回 / 下次收到消息时撤回
 */
export function createStatusPageHook({ cfg, dataDir, logger }) {
  const PENDING_PATH = path.join(dataDir, 'status-page-pending.json');
  const recallTimers = new Map();

  let tokenCache = { token: null, expiresAt: 0 };

  function loadPending() {
    try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); } catch { return {}; }
  }

  function savePending(data) {
    try { fs.writeFileSync(PENDING_PATH, JSON.stringify(data)); } catch {}
  }

  // ── 飞书 API ──

  async function getToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

    // 从 openclaw 的 channel config 中读取飞书凭证（运行时由 gateway 注入）
    const appId = cfg.feishuAppId || process.env.OPENCLAW_FEISHU_APP_ID;
    const appSecret = cfg.feishuAppSecret || process.env.OPENCLAW_FEISHU_APP_SECRET;
    if (!appId || !appSecret) throw new Error('Missing feishu appId/appSecret in plugin config or env');

    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu token error: ${data.msg}`);
    tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + (data.expire - 60) * 1000 };
    return tokenCache.token;
  }

  async function sendNotification(token, openId) {
    const url = cfg.statusPageUrl;
    if (!url) return null;

    const content = {
      elements: [{
        tag: 'div',
        text: { tag: 'lark_md', content: `⏳ 正在处理中请稍后，[点击查看进度](${url})` }
      }]
    };
    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ receive_id: openId, msg_type: 'interactive', content: JSON.stringify(content) })
    });
    return res.json();
  }

  async function recallMessage(token, messageId) {
    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  }

  async function doRecall(sessionKey) {
    const pending = loadPending();
    const msgId = pending[sessionKey];
    if (!msgId) return;

    try {
      const token = await getToken();
      await recallMessage(token, msgId);
      logger.info?.(`[infra-services] recalled notification msgId=${msgId}`);
    } catch (err) {
      logger.warn?.(`[infra-services] recall failed: ${err.message}`);
    }

    delete pending[sessionKey];
    savePending(pending);

    const timer = recallTimers.get(sessionKey);
    if (timer) { clearTimeout(timer); recallTimers.delete(sessionKey); }
  }

  // ── 事件处理 ──

  return {
    async onReceived(event, ctx) {
      if (!cfg.statusPageUrl) return;

      const openId = ctx.metadata?.senderId || ctx.conversationId?.replace(/^user:/, '');
      if (!openId) return;

      const sessionKey = event.sessionKey || ctx.conversationId;

      // 撤回上一条通知（用户连续发消息的情况）
      await doRecall(sessionKey);

      // 发送新通知
      try {
        const token = await getToken();
        const result = await sendNotification(token, openId);

        if (result?.code === 0 && result.data?.message_id) {
          const msgId = result.data.message_id;
          const pending = loadPending();
          pending[sessionKey] = msgId;
          savePending(pending);

          // 兜底：3 分钟后自动撤回
          const timer = setTimeout(() => doRecall(sessionKey), 3 * 60 * 1000);
          recallTimers.set(sessionKey, timer);

          logger.info?.(`[infra-services] sent notification openId=${openId} msgId=${msgId}`);
        }
      } catch (err) {
        logger.warn?.(`[infra-services] send notification failed: ${err.message}`);
      }
    },

    async onSent(event, ctx) {
      const sessionKey = event.sessionKey || ctx.conversationId;
      await doRecall(sessionKey);
    }
  };
}
