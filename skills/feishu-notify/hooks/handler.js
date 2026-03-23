import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const DATA_DIR = path.resolve(process.env.HOME, '.openclaw', 'logs');
const DEBUG_PATH = path.resolve(DATA_DIR, 'status-page-notify-debug.log');
const PENDING_PATH = path.resolve(DATA_DIR, 'status-page-pending.json');
const recallTimers = new Map();

function debugLog(label, payload) {
  try { fs.mkdirSync(DATA_DIR,{recursive:true}); fs.appendFileSync(DEBUG_PATH, new Date().toISOString()+' '+label+' '+JSON.stringify(payload)+'\n'); } catch {}
}
let tokenCache = { token: null, expiresAt: 0 };

function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; } }
function loadPending() { try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); } catch { return {}; } }
function savePending(d) { try { fs.mkdirSync(path.dirname(PENDING_PATH),{recursive:true}); fs.writeFileSync(PENDING_PATH,JSON.stringify(d)); } catch {} }

async function getToken(appId, appSecret) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error(d.msg);
  tokenCache = { token: d.tenant_access_token, expiresAt: Date.now() + (d.expire-60)*1000 };
  return tokenCache.token;
}

async function sendMsg(token, openId, url) {
  const content = { elements: [{ tag:'div', text:{ tag:'lark_md', content:`⏳ 正在处理中请稍后，[点击查看进度](${url})` }}]};
  const r = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body: JSON.stringify({ receive_id:openId, msg_type:'interactive', content:JSON.stringify(content) })
  });
  return r.json();
}

async function recallMsg(token, msgId) {
  return (await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${msgId}`,{ method:'DELETE', headers:{'Authorization':`Bearer ${token}`}})).json();
}

async function doRecall(sk, cfg) {
  const pending = loadPending(); const msgId = pending[sk]; if (!msgId) return;
  try { const t = await getToken(cfg.feishu.appId, cfg.feishu.appSecret); await recallMsg(t, msgId); } catch {}
  delete pending[sk]; savePending(pending);
  const timer = recallTimers.get(sk); if (timer) { clearTimeout(timer); recallTimers.delete(sk); }
}

const handler = async (event) => {
  if (event.type !== 'message') return;
  const ctx = event.context ?? {};
  if (ctx.channelId !== 'feishu') return;
  const config = loadConfig();
  if (!config?.statusPageUrl || !config?.feishu?.appId) return;
  const sk = event.sessionKey;

  if (event.action === 'sent') { await doRecall(sk, config); return; }
  if (event.action !== 'received') return;

  const openId = ctx.metadata?.senderId || ctx.conversationId?.replace(/^user:/,'');
  if (!openId) return;

  debugLog('event', { type: event.type, action: event.action, context: ctx });
  await doRecall(sk, config);

  try {
    const token = await getToken(config.feishu.appId, config.feishu.appSecret);
    const result = await sendMsg(token, openId, config.statusPageUrl);
    debugLog('sent', { openId, code: result?.code, msgId: result?.data?.message_id });
    if (result.code === 0 && result.data?.message_id) {
      const msgId = result.data.message_id;
      const p = loadPending(); p[sk] = msgId; savePending(p);
      recallTimers.set(sk, setTimeout(() => doRecall(sk, config), 3*60*1000));
    }
  } catch (err) { debugLog('error', { message: err?.message }); }
};

export default handler;
