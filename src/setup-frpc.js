/**
 * postinstall 脚本：自动下载 frpc 到 ~/bin/
 * 支持 macOS (arm64/x64) 和 Linux (arm64/x64)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const FRPC_VERSION = '0.61.1';
const home = os.homedir();
const binDir = path.join(home, 'bin');
const frpcPath = path.join(binDir, 'frpc');

// 已存在则跳过
if (fs.existsSync(frpcPath)) {
  console.log(`[infra-services] frpc already exists at ${frpcPath}, skipping download.`);
  process.exit(0);
}

const platform = os.platform();
const arch = os.arch();

const platformMap = { darwin: 'darwin', linux: 'linux' };
const archMap = { arm64: 'arm64', x64: 'amd64' };

const osPart = platformMap[platform];
const archPart = archMap[arch];

if (!osPart || !archPart) {
  console.warn(`[infra-services] Unsupported platform: ${platform}/${arch}. Please install frpc manually to ~/bin/frpc`);
  process.exit(0); // 不阻塞安装
}

const tarName = `frp_${FRPC_VERSION}_${osPart}_${archPart}`;
const url = `https://github.com/fatedier/frp/releases/download/v${FRPC_VERSION}/${tarName}.tar.gz`;
const tmpDir = path.join(os.tmpdir(), 'frpc-install');

console.log(`[infra-services] Downloading frpc v${FRPC_VERSION} for ${osPart}/${archPart}...`);

try {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  execSync(`curl -sL "${url}" -o "${tmpDir}/frp.tar.gz"`, { stdio: 'inherit', timeout: 120000 });
  execSync(`tar -xzf "${tmpDir}/frp.tar.gz" -C "${tmpDir}/"`, { stdio: 'inherit' });

  const srcBin = path.join(tmpDir, tarName, 'frpc');
  fs.copyFileSync(srcBin, frpcPath);
  fs.chmodSync(frpcPath, 0o755);

  console.log(`[infra-services] frpc installed to ${frpcPath}`);

  // 清理
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (err) {
  console.warn(`[infra-services] Failed to download frpc: ${err.message}`);
  console.warn('[infra-services] You can install frpc manually: download from https://github.com/fatedier/frp/releases');
  process.exit(0); // 不阻塞安装
}
