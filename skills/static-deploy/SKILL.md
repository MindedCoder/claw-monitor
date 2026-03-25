---
name: static-deploy
description: "将静态 HTML 及资源文件部署到监控面板。支持 --last 模式自动读取上次构建产物，用户说「发布刚刚生成的」即可一键部署"
metadata:
  openclaw:
    emoji: "🌐"
    os: ["darwin", "linux"]
---

# Static Deploy — 部署静态页面到监控面板

用户说「部署页面」「发布 HTML」「deploy static」「把 xxx.html 挂到监控上」「发布刚刚生成的」「帮我部署上一步的结果」等类似意图时触发本 skill。

## 目录结构

```
static-deploy/
├── SKILL.md                       ← 本文件
├── scripts/
│   └── deploy-static.sh           ← 部署脚本（HTML + 资源文件夹）
└── references/
    └── usage.md                   ← 使用参考与调用示例
```

## 规则

1. 读完本文件后，判断是否走 `--last` 模式（见下方）
2. 所有步骤合并成一个 exec 调用执行
3. 执行完成后回复用户访问地址

### 判断逻辑

- 如果用户说「发布刚刚生成的」「部署上一步的结果」等**未指定具体文件**的意图 → 使用 `--last` 模式
- 如果用户明确指定了文件路径和平台 → 使用手动参数模式
- 如果参数不全且没有 manifest 可读 → 询问用户

---

### 手动参数模式（由 AI 从对话中提取并填入脚本）

| 变量 | 说明 | 示例 |
|------|------|------|
| `SOURCE_HTML` | 源 HTML 文件绝对路径 | `/Users/me/Downloads/hn.html` |
| `PLATFORM` | 平台名称 | `youzan`、`taobao`、`hn` |
| `RESOURCE_DIRS` | 资源文件夹名称，多个用空格分隔（与 HTML 同级的依赖目录，无则留空） | `hn_files` 或 `images css js` |

```bash
set -e

SOURCE_HTML="__SOURCE_HTML__"
PLATFORM="__PLATFORM__"
RESOURCE_DIRS="__RESOURCE_DIR1__ __RESOURCE_DIR2__"

DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
  curl -fsSL "https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/skills/static-deploy/scripts/deploy-static.sh" -o "$DEPLOY_SCRIPT"
  chmod +x "$DEPLOY_SCRIPT"
fi

URL_PATH=$("$DEPLOY_SCRIPT" "$SOURCE_HTML" "$PLATFORM" $RESOURCE_DIRS)
echo ""
echo "本地访问: http://127.0.0.1:9001/$URL_PATH"
echo "公网访问: https://claw.bfelab.com/$URL_PATH"
echo "ALL DONE"
```

### --last 模式（从 manifest 自动读取）

当对话中有生成类 skill 已经构建完成，或用户说「发布刚刚生成的」时，直接使用 `--last`：

```bash
set -e

DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
  curl -fsSL "https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/skills/static-deploy/scripts/deploy-static.sh" -o "$DEPLOY_SCRIPT"
  chmod +x "$DEPLOY_SCRIPT"
fi

URL_PATH=$("$DEPLOY_SCRIPT" --last)
echo ""
echo "本地访问: http://127.0.0.1:9001/$URL_PATH"
echo "公网访问: https://claw.bfelab.com/$URL_PATH"
echo "ALL DONE"
```

### 部署路径规则

```
/{instanceName}/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html  ← HTML（重命名）
/{YYYYMMDD}/{PLATFORM}/{RESOURCE_DIR}/                ← 资源文件（原名保留）
```

执行完成后回复用户：
- 本地访问：http://127.0.0.1:9001/{URL_PATH}
- 公网访问：https://claw.bfelab.com/{URL_PATH}
- 文件位置：~/Documents/openclaw-monitor/static/{YYYYMMDD}/{PLATFORM}/

---

## Manifest 协议

生成类 skill 构建完成后应写入 `~/.openclaw-last-build.json`，格式如下：

```json
{
  "html": "/absolute/path/to/output.html",
  "platform": "youzan",
  "resourceDirs": ["assets", "images"]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `html` | 是 | 生成的 HTML 文件绝对路径 |
| `platform` | 是 | 平台标识 |
| `resourceDirs` | 否 | 资源文件夹名称数组（与 HTML 同目录下） |

`deploy-static.sh --last` 会读取此文件并自动填充参数。

---

## 被其他 Skill 调用

其他 skill 有两种方式调用部署：

### 方式一：写 manifest 后调用 --last

```bash
# 生成类 skill 在构建完成后写入 manifest
cat > "$HOME/.openclaw-last-build.json" <<EOF
{"html":"/tmp/report.html","platform":"youzan","resourceDirs":["report_files"]}
EOF

# 调用部署
DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"
URL_PATH=$("$DEPLOY_SCRIPT" --last)
echo "访问地址: http://127.0.0.1:9001/$URL_PATH"
```

### 方式二：直接传参

```bash
DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"

# 单个资源文件夹
URL_PATH=$("$DEPLOY_SCRIPT" "/tmp/report.html" "youzan" "report_files")

# 多个资源文件夹
URL_PATH=$("$DEPLOY_SCRIPT" "/tmp/page.html" "taobao" "images" "css" "js")

echo "访问地址: http://127.0.0.1:9001/$URL_PATH"
```

脚本说明：
- 参数 1（必填）：源 HTML 文件绝对路径（或 `--last` 读取 manifest）
- 参数 2（必填）：平台名称
- 参数 3+（可选）：一个或多个资源文件夹名称（与 HTML 同目录下）
- stdout 最后一行输出部署后的 URL 路径，日志输出到 stderr
