---
name: claw-monitor
description: "一键部署 OpenClaw 监控面板 + frpc 公网隧道，对话中直接触发无需预装"
metadata:
  openclaw:
    emoji: "📡"
    os: ["darwin", "linux"]
---

# Claw Monitor — 监控面板 + frpc 隧道

用户说「打开网页状态窗口」「打开状态窗口」「open status page」等类似意图时触发本 skill。

## 目录结构

```
claw-monitor/
├── SKILL.md                       ← 本文件
├── scripts/
│   ├── install.sh                 ← 一键安装脚本（frpc + monitor + cron 保活）
│   └── keepalive.sh               ← cron 保活脚本（每分钟检查并拉起）
└── references/
    ├── config.example.json        ← 监控配置模板
    └── frpc.toml.example          ← frpc 隧道配置模板
```

## 参数

| 变量 | 说明 | 来源 |
|------|------|------|
| `INSTANCE_NAME` | 实例名称（用于公网访问路径） | 从对话中提取，或询问用户 |

首次安装时**必须询问用户实例名称**，例如：「请问你的实例名叫什么？（用于公网访问路径，如 claw.bfelab.com/你的名字）」

## 规则

1. 如果用户未提供实例名，先询问，拿到后再执行
2. 全部步骤执行完成后再回复用户结果
3. 不要解释你要做什么，直接执行
4. 通过环境变量 `INSTANCE_NAME` 传递给 `scripts/install.sh`

---

### 执行以下脚本（一次性全部执行）

```bash
INSTANCE_NAME="__用户提供的实例名__" bash scripts/install.sh
```

如果上述相对路径不可用，则读取 `scripts/install.sh` 的内容并在 exec 工具中执行，确保 `INSTANCE_NAME` 环境变量已设置。

执行完成后回复用户：
- 监控面板：http://127.0.0.1:9001
- 公网访问：https://claw.bfelab.com/{instanceName}
- frpc 隧道已启动
- Chat 探针 + Ping 探针已启用
- cron 每分钟保活：进程崩溃自动拉起
- 更新命令：`curl -fsSL https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/update.sh | bash`
