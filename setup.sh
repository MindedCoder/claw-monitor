#!/bin/bash
# OpenClaw Skill Pack 安装器
#
# 用法 1（远程）: curl -fsSL https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/setup.sh | bash
# 用法 2（本地）: cd claw-monitor && bash setup.sh
# 用法 3（AI 对话中）: 用户说「帮我安装 https://github.com/MindedCoder/claw-monitor」
#
# 环境变量（AI 在调用前设置）:
#   INSTANCE_NAME  — 实例名称，用于公网访问路径
#
# 工作原理：
#   1. 如果不在仓库目录里，先 clone 到临时目录
#   2. 读取 manifest.json 获取 skill 列表
#   3. 将所有 skills 复制到 ~/.openclaw/workspace/skills/
#   4. 在 TOOLS.md 注册触发词
set -e

SKILLS_BASE="$HOME/.openclaw/workspace/skills"
TOOLS_MD="$HOME/.openclaw/workspace/TOOLS.md"

# ── 0. 确定源码目录 ──
if [ -f "./manifest.json" ]; then
  REPO_DIR="$(pwd)"
  NEED_CLEANUP=false
else
  REPO_DIR=$(mktemp -d)
  NEED_CLEANUP=true
  echo "📥 正在下载 claw-monitor..."
  git clone --depth 1 https://github.com/MindedCoder/claw-monitor.git "$REPO_DIR" 2>/dev/null
fi

# ── 1. 读取 manifest.json ──
if [ ! -f "$REPO_DIR/manifest.json" ]; then
  echo "ERROR: manifest.json not found"
  [ "$NEED_CLEANUP" = true ] && rm -rf "$REPO_DIR"
  exit 1
fi

PACK_NAME=$(python3 -c "import json;print(json.load(open('$REPO_DIR/manifest.json'))['name'])")
echo "📦 安装 skill pack: $PACK_NAME"

# ── 2. 复制所有 skills（保留完整目录结构）──
for skill_dir in "$REPO_DIR"/skills/*/; do
  [ ! -d "$skill_dir" ] && continue
  skill_name=$(basename "$skill_dir")
  target_dir="$SKILLS_BASE/$skill_name"
  mkdir -p "$target_dir"
  cp -r "$skill_dir"* "$target_dir/" 2>/dev/null
  # 确保脚本可执行
  find "$target_dir" -name "*.sh" -exec chmod +x {} \; 2>/dev/null
  echo "  ✅ $skill_name"
done

# ── 3. 在 TOOLS.md 注册 skills ──
touch "$TOOLS_MD"

# 从 manifest.json 读取 skill 信息并注册
python3 -c "
import json, sys

manifest = json.load(open('$REPO_DIR/manifest.json'))
tools_md_path = '$TOOLS_MD'

with open(tools_md_path, 'r') as f:
    content = f.read()

entries = []
for skill in manifest.get('skills', []):
    name = skill['name']
    if name in content:
        print(f'  ⏭️  {name}（已注册）')
        continue
    desc = skill['description']
    trigger = skill['trigger']
    entries.append(f'''
### {name}
{desc}
当用户说「{trigger}」时，读取 \`skills/{name}/SKILL.md\` 并按其中的步骤用 exec 工具依次执行。
''')
    print(f'  ✅ TOOLS.md 已注册 {name}')

if entries:
    with open(tools_md_path, 'a') as f:
        if '## 可用 Skills' not in content:
            f.write('\n## 可用 Skills\n')
        for entry in entries:
            f.write(entry)
"

# ── 4. 执行 postInstall 脚本（从 manifest.json 读取）──
echo ""
echo "🚀 正在执行安装后脚本..."
python3 -c "
import json
manifest = json.load(open('$REPO_DIR/manifest.json'))
for cmd in manifest.get('postInstall', []):
    print(cmd)
" 2>/dev/null | while read -r cmd; do
  # 将路径中的 skills/ 映射到已安装目录
  resolved_cmd=$(echo "$cmd" | sed "s|skills/|$SKILLS_BASE/|g")
  echo "  🚀 $cmd"
  # 透传环境变量给 postInstall 脚本
  INSTANCE_NAME="${INSTANCE_NAME:-}" bash -c "$resolved_cmd" || echo "  ⚠️  $cmd 执行失败（非致命）"
done

# ── 5. 清理 ──
[ "$NEED_CLEANUP" = true ] && rm -rf "$REPO_DIR"

# ── 6. 打印结果 ──
echo ""
echo "🎉 安装完成！可用 skills："
for skill_dir in "$SKILLS_BASE"/*/; do
  [ -f "$skill_dir/SKILL.md" ] || continue
  echo "  • $(basename "$skill_dir")"
done
echo ""
echo "在对话中说出触发词即可使用，详见 TOOLS.md"
