---
name: static-deploy
description: "将静态 HTML 及资源文件部署到监控面板，按 /bfe/日期/平台/时分秒.html 规则访问"
metadata:
  openclaw:
    emoji: "🌐"
    os: ["darwin", "linux"]
---

# Static Deploy — 部署静态页面到监控面板

用户说「部署页面」「发布 HTML」「deploy static」「把 xxx.html 挂到监控上」等类似意图时触发本 skill。

## 规则

1. 读完本文件后，先确认用户提供了以下三个参数，缺少则询问
2. 所有步骤合并成一个 exec 调用执行
3. 执行完成后回复用户访问地址

---

### 参数说明（由 AI 从对话中提取并填入脚本）

| 变量 | 说明 | 示例 |
|------|------|------|
| `SOURCE_HTML` | 源 HTML 文件绝对路径 | `/Users/me/Downloads/hn.html` |
| `PLATFORM` | 平台名称 | `youzan`、`taobao`、`hn` |
| `RESOURCE_DIR` | 资源文件夹名称（与 HTML 同级的依赖目录，无则留空） | `hn_files` |

### 部署路径规则

```
/bfe/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html      ← HTML（重命名）
/bfe/{YYYYMMDD}/{PLATFORM}/{RESOURCE_DIR}/     ← 资源文件（原名保留）
```

### 执行以下脚本

```bash
set -e

# ── 参数（AI 填入）──
SOURCE_HTML="__SOURCE_HTML__"
PLATFORM="__PLATFORM__"
RESOURCE_DIR="__RESOURCE_DIR__"

# ── 验证源文件 ──
if [ ! -f "$SOURCE_HTML" ]; then
  echo "ERROR: 源文件不存在: $SOURCE_HTML"
  exit 1
fi

SOURCE_PARENT="$(dirname "$SOURCE_HTML")"

# ── 生成路径 ──
DATE_STR=$(date +%Y%m%d)
TIME_STR=$(date +%H%M%S)
STATIC_DIR="$HOME/Documents/openclaw-monitor/static"
DEPLOY_DIR="$STATIC_DIR/bfe/$DATE_STR/$PLATFORM"

mkdir -p "$DEPLOY_DIR"

# ── 部署 HTML（重命名为 时分秒.html）──
cp "$SOURCE_HTML" "$DEPLOY_DIR/${TIME_STR}.html"
echo "DONE: HTML -> $DEPLOY_DIR/${TIME_STR}.html"

# ── 部署资源文件 ──
if [ -n "$RESOURCE_DIR" ] && [ -d "$SOURCE_PARENT/$RESOURCE_DIR" ]; then
  rm -rf "$DEPLOY_DIR/$RESOURCE_DIR"
  cp -r "$SOURCE_PARENT/$RESOURCE_DIR" "$DEPLOY_DIR/$RESOURCE_DIR"
  echo "DONE: resources -> $DEPLOY_DIR/$RESOURCE_DIR/"
elif [ -n "$RESOURCE_DIR" ]; then
  echo "WARN: 资源目录不存在: $SOURCE_PARENT/$RESOURCE_DIR"
fi

# ── 验证 ──
sleep 1
URL_PATH="bfe/$DATE_STR/$PLATFORM/${TIME_STR}.html"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' "http://127.0.0.1:9001/$URL_PATH" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "VERIFY: OK (HTTP 200)"
else
  echo "VERIFY: HTTP $HTTP_CODE — monitor 可能需要重启"
fi

echo ""
echo "访问地址: http://127.0.0.1:9001/$URL_PATH"
echo "ALL DONE"
```

执行完成后回复用户：
- 本地访问：http://127.0.0.1:9001/bfe/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html
- 公网访问：https://claw.bfelab.com/bfe/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html
- 文件位置：~/Documents/openclaw-monitor/static/bfe/{YYYYMMDD}/{PLATFORM}/
