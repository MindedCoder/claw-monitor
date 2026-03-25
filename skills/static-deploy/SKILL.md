---
name: static-deploy
description: "将静态 HTML 及资源文件部署到监控面板。用户说「发布刚刚生成的」时，AI 从对话上下文提取文件路径和平台，一键部署"
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

1. 读完本文件后，按以下方式获取三个参数：
   - `SOURCE_HTML` 和 `RESOURCE_DIRS`：从对话上下文中回溯，找到之前生成/写入的 HTML 文件路径和资源文件夹
   - `PLATFORM`：**必须询问用户**，不要猜测
2. 如果对话上下文中找不到 HTML 文件路径，也需要询问用户
3. 所有步骤合并成一个 exec 调用执行
4. 执行完成后回复用户访问地址

---

### 参数说明

| 变量 | 说明 | 获取方式 |
|------|------|------|
| `SOURCE_HTML` | 源 HTML 文件绝对路径 | 从对话上下文提取（AI 之前写入的 .html 文件路径） |
| `PLATFORM` | 平台名称 | **询问用户** |
| `RESOURCE_DIRS` | 资源文件夹名称，多个用空格分隔 | 从对话上下文提取（与 HTML 同级的资源目录），无则留空 |

### 执行以下脚本

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

## 被其他 Skill 调用

其他 skill 无需解析本文件，直接在自己的脚本中调用 `deploy-static.sh`：

```bash
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
