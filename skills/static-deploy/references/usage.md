# Static Deploy 使用参考

## 部署路径规则

```
/{instanceName}/{YYYYMMDD}/{PLATFORM}/{HHMMSS}.html  ← HTML（重命名为时间戳）
/{YYYYMMDD}/{PLATFORM}/{RESOURCE_DIR}/                ← 资源文件（原名保留）
```

## 脚本调用方式

### --last 模式（从 manifest 自动读取）

```bash
DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"
URL_PATH=$("$DEPLOY_SCRIPT" --last)
echo "访问地址: http://127.0.0.1:9001/$URL_PATH"
```

### 手动传参模式

```bash
DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"

# 单个资源文件夹
URL_PATH=$("$DEPLOY_SCRIPT" "/tmp/report.html" "youzan" "report_files")

# 多个资源文件夹
URL_PATH=$("$DEPLOY_SCRIPT" "/tmp/page.html" "taobao" "images" "css" "js")

echo "访问地址: http://127.0.0.1:9001/$URL_PATH"
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `--last` | - | 从 manifest 读取上次构建产物 | `deploy-static.sh --last` |
| 源HTML路径 | 是 | HTML 文件绝对路径 | `/Users/me/Downloads/hn.html` |
| 平台名称 | 是 | 业务平台标识 | `youzan`、`taobao`、`hn` |
| 资源文件夹 | 否 | 与 HTML 同级的依赖目录，可多个 | `hn_files` 或 `images css js` |

## Manifest 协议

生成类 skill 构建完成后应写入 `~/.openclaw-last-build.json`：

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

## 输出

- stdout 最后一行：部署后的 URL 相对路径
- stderr：部署过程日志
