#!/bin/bash
# 部署静态 HTML 及资源到监控面板
# 用法: deploy-static.sh <源HTML路径> <平台> [资源文件夹名]
# 示例: deploy-static.sh ~/Downloads/hn.html hn hn_files
#
# 部署路径: /bfe/{YYYYMMDD}/{平台}/{HHMMSS}.html
# 输出最后一行为访问路径，供调用方捕获

set -e

SOURCE_HTML="$1"
PLATFORM="$2"
RESOURCE_DIR="$3"

if [ -z "$SOURCE_HTML" ] || [ -z "$PLATFORM" ]; then
  echo "用法: deploy-static.sh <源HTML路径> <平台> [资源文件夹名]" >&2
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
DEPLOY_DIR="$STATIC_DIR/bfe/$DATE_STR/$PLATFORM"

mkdir -p "$DEPLOY_DIR"

# 部署 HTML
cp "$SOURCE_HTML" "$DEPLOY_DIR/${TIME_STR}.html"
echo "HTML -> $DEPLOY_DIR/${TIME_STR}.html" >&2

# 部署资源文件
if [ -n "$RESOURCE_DIR" ] && [ -d "$SOURCE_PARENT/$RESOURCE_DIR" ]; then
  rm -rf "$DEPLOY_DIR/$RESOURCE_DIR"
  cp -r "$SOURCE_PARENT/$RESOURCE_DIR" "$DEPLOY_DIR/$RESOURCE_DIR"
  echo "Resources -> $DEPLOY_DIR/$RESOURCE_DIR/" >&2
elif [ -n "$RESOURCE_DIR" ]; then
  echo "WARN: 资源目录不存在: $SOURCE_PARENT/$RESOURCE_DIR" >&2
fi

# 最后一行输出访问路径（stdout），供调用方捕获
URL_PATH="bfe/$DATE_STR/$PLATFORM/${TIME_STR}.html"
echo "$URL_PATH"
