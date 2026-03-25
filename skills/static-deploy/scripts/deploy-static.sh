#!/bin/bash
# 部署静态 HTML 及资源到监控面板
# 用法: deploy-static.sh <源HTML路径> <平台> [资源文件夹1] [资源文件夹2] ...
# 示例: deploy-static.sh ~/Downloads/hn.html hn hn_files images css
#
# 部署路径: /{instanceName}/{YYYYMMDD}/{平台}/{HHMMSS}.html
# 输出最后一行为访问路径，供调用方捕获

set -e

SOURCE_HTML="$1"
PLATFORM="$2"
shift 2 2>/dev/null || true
RESOURCE_DIRS=("$@")

if [ -z "$SOURCE_HTML" ] || [ -z "$PLATFORM" ]; then
  echo "用法: deploy-static.sh <源HTML路径> <平台> [资源文件夹1] [资源文件夹2] ..." >&2
  exit 1
fi

if [ ! -f "$SOURCE_HTML" ]; then
  echo "ERROR: 源文件不存在: $SOURCE_HTML" >&2
  exit 1
fi

SOURCE_PARENT="$(dirname "$SOURCE_HTML")"

DATE_STR=$(date +%Y%m%d)
TIME_STR=$(date +%H%M%S)
STATIC_DIR="$HOME/Documents/openclaw-monitor/static"
CONFIG_FILE="$HOME/Documents/openclaw-monitor/config.json"
INSTANCE_NAME=$(python3 -c "import json;c=json.load(open('$CONFIG_FILE'));print(c.get('instanceName',''))" 2>/dev/null || echo "")
DEPLOY_DIR="$STATIC_DIR/$DATE_STR/$PLATFORM"

mkdir -p "$DEPLOY_DIR"

# 部署 HTML
cp "$SOURCE_HTML" "$DEPLOY_DIR/${TIME_STR}.html"
echo "HTML -> $DEPLOY_DIR/${TIME_STR}.html" >&2

# 部署所有资源文件夹
for RES_DIR in "${RESOURCE_DIRS[@]}"; do
  [ -z "$RES_DIR" ] && continue
  if [ -d "$SOURCE_PARENT/$RES_DIR" ]; then
    rm -rf "$DEPLOY_DIR/$RES_DIR"
    cp -r "$SOURCE_PARENT/$RES_DIR" "$DEPLOY_DIR/$RES_DIR"
    echo "Resources -> $DEPLOY_DIR/$RES_DIR/" >&2
  else
    echo "WARN: 资源目录不存在: $SOURCE_PARENT/$RES_DIR" >&2
  fi
done

# 最后一行输出访问路径（stdout），供调用方捕获
if [ -n "$INSTANCE_NAME" ]; then
  URL_PATH="$INSTANCE_NAME/$DATE_STR/$PLATFORM/${TIME_STR}.html"
else
  URL_PATH="$DATE_STR/$PLATFORM/${TIME_STR}.html"
fi
echo "$URL_PATH"
