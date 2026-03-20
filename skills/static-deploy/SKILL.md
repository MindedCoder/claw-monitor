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
| `RESOURCE_DIRS` | 资源文件夹名称，多个用空格分隔（与 HTML 同级的依赖目录，无则留空） | `hn_files` 或 `images css js` |

### 部署路径规则

```
/bfe/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html      ← HTML（重命名）
/bfe/{YYYYMMDD}/{PLATFORM}/{RESOURCE_DIR}/     ← 资源文件（原名保留）
```

### 执行以下脚本

```bash
set -e

# ── 参数（AI 填入，资源文件夹可多个）──
SOURCE_HTML="__SOURCE_HTML__"
PLATFORM="__PLATFORM__"
RESOURCE_DIRS="__RESOURCE_DIR1__ __RESOURCE_DIR2__"

# ── 确保 deploy-static.sh 存在 ──
DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
  curl -fsSL "https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/src/deploy-static.sh" -o "$DEPLOY_SCRIPT"
  chmod +x "$DEPLOY_SCRIPT"
fi

# ── 执行部署（资源文件夹展开为多个参数）──
URL_PATH=$("$DEPLOY_SCRIPT" "$SOURCE_HTML" "$PLATFORM" $RESOURCE_DIRS)
echo ""
echo "本地访问: http://127.0.0.1:9001/$URL_PATH"
echo "公网访问: https://claw.bfelab.com/bfe/$(echo "$URL_PATH" | sed 's|^bfe/||')"
echo "ALL DONE"
```

执行完成后回复用户：
- 本地访问：http://127.0.0.1:9001/bfe/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html
- 公网访问：https://claw.bfelab.com/bfe/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html
- 文件位置：~/Documents/openclaw-monitor/static/bfe/{YYYYMMDD}/{PLATFORM}/

---

## 被其他 Skill 调用

其他 skill 无需解析本文件，直接在自己的脚本中调用 `deploy-static.sh`：

```bash
# 用法: deploy-static.sh <源HTML路径> <平台> [资源文件夹1] [资源文件夹2] ...
DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"

# 单个资源文件夹
URL_PATH=$("$DEPLOY_SCRIPT" "/tmp/report.html" "youzan" "report_files")

# 多个资源文件夹
URL_PATH=$("$DEPLOY_SCRIPT" "/tmp/page.html" "taobao" "images" "css" "js")

echo "访问地址: http://127.0.0.1:9001/$URL_PATH"
```

脚本说明：
- 参数 1（必填）：源 HTML 文件绝对路径
- 参数 2（必填）：平台名称
- 参数 3+（可选）：一个或多个资源文件夹名称（与 HTML 同目录下）
- stdout 最后一行输出部署后的 URL 路径，日志输出到 stderr
