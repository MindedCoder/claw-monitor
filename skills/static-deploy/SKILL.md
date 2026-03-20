---
name: static-deploy
description: "将静态 HTML 文件部署到监控面板，通过 /路径/文件名.html 访问"
metadata:
  openclaw:
    emoji: "🌐"
    os: ["darwin", "linux"]
---

# Static Deploy — 部署静态页面到监控面板

用户说「部署页面」「发布 HTML」「deploy static」「把 xxx.html 挂到监控上」等类似意图时触发本 skill。

## 规则

1. 读完本文件后，先确认用户提供了：**源文件路径** 和 **访问路径**
2. 如果用户只给了文件路径没给访问路径，从文件路径推断合理的访问路径
3. 所有步骤合并成一个 exec 调用执行
4. 执行完成后回复用户访问地址

---

### 参数说明

- `SOURCE`：源 HTML 文件的绝对路径（用户提供）
- `URL_PATH`：期望的访问路径（如 `youzan/data.html`），不带前导 `/`

### 执行以下脚本

```bash
set -e

# 用户需提供这两个变量（由 AI 从对话中提取并填入）
SOURCE="__SOURCE_FILE__"
URL_PATH="__URL_PATH__"

# 验证源文件
if [ ! -f "$SOURCE" ]; then
  echo "ERROR: 源文件不存在: $SOURCE"
  exit 1
fi

# 部署目录
STATIC_DIR="$HOME/Documents/openclaw-monitor/static"
TARGET_DIR="$STATIC_DIR/$(dirname "$URL_PATH")"
TARGET_FILE="$STATIC_DIR/$URL_PATH"

mkdir -p "$TARGET_DIR"
cp "$SOURCE" "$TARGET_FILE"
echo "DONE: deployed $SOURCE -> $TARGET_FILE"

# 验证可访问
sleep 1
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' "http://127.0.0.1:9001/$URL_PATH" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "VERIFY: OK (HTTP 200)"
else
  echo "VERIFY: monitor may need restart (HTTP $HTTP_CODE)"
fi

echo "ALL DONE"
```

执行完成后回复用户：
- 本地访问：http://127.0.0.1:9001/{URL_PATH}
- 公网访问：https://claw.bfelab.com/bfe/{URL_PATH}
- 文件位置：~/Documents/openclaw-monitor/static/{URL_PATH}
- 如需更新，重新执行本 skill 或直接覆盖 static 目录下的文件即可
