import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE_FILE = 'infra-pids.json';

function loadPids(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, STATE_FILE), 'utf8')); } catch { return {}; }
}

function savePids(dataDir, pids) {
  fs.writeFileSync(path.join(dataDir, STATE_FILE), JSON.stringify(pids, null, 2));
}

function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function frpcBinPath(home) {
  const candidates = [
    path.join(home, 'bin', 'frpc'),
    path.join(home, '.local', 'bin', 'frpc'),
    '/usr/local/bin/frpc'
  ];
  return candidates.find(p => fs.existsSync(p));
}

function generateFrpcToml(cfg, dataDir) {
  const frpc = cfg.frpc || {};
  if (!frpc.serverAddr) return null;

  const monitorPort = cfg.monitor?.port || 9001;
  const tomlPath = path.join(dataDir, 'frpc.toml');
  const content = `serverAddr = "${frpc.serverAddr}"
serverPort = ${frpc.serverPort || 7000}

[[proxies]]
name = "monitor"
type = "tcp"
localIP = "127.0.0.1"
localPort = ${monitorPort}
remotePort = ${frpc.remotePort || 19090}
`;
  fs.writeFileSync(tomlPath, content);
  return tomlPath;
}

/**
 * infra_services 工具 handler
 */
export async function monitorToolHandler(params, { cfg, dataDir, home, pluginDir }) {
  const { action, service = 'all' } = params;
  const pids = loadPids(dataDir);
  const results = [];

  if (action === 'status') {
    const monitorAlive = pids.monitor ? isRunning(pids.monitor) : false;
    const frpcAlive = pids.frpc ? isRunning(pids.frpc) : false;
    return {
      monitor: { pid: pids.monitor || null, running: monitorAlive, port: cfg.monitor?.port || 9001 },
      frpc: { pid: pids.frpc || null, running: frpcAlive },
      statusPageUrl: cfg.statusPageUrl || '(未配置)'
    };
  }

  if (action === 'stop') {
    if (service === 'all' || service === 'monitor') {
      if (pids.monitor && isRunning(pids.monitor)) {
        process.kill(pids.monitor, 'SIGTERM');
        results.push(`monitor (pid ${pids.monitor}) 已停止`);
        delete pids.monitor;
      } else {
        results.push('monitor 未运行');
      }
    }
    if (service === 'all' || service === 'frpc') {
      if (pids.frpc && isRunning(pids.frpc)) {
        process.kill(pids.frpc, 'SIGTERM');
        results.push(`frpc (pid ${pids.frpc}) 已停止`);
        delete pids.frpc;
      } else {
        results.push('frpc 未运行');
      }
    }
    savePids(dataDir, pids);
    return { results };
  }

  if (action === 'start') {
    // ── 启动 Monitor ──
    if (service === 'all' || service === 'monitor') {
      if (pids.monitor && isRunning(pids.monitor)) {
        results.push(`monitor 已在运行 (pid ${pids.monitor})`);
      } else {
        const monitorScript = path.join(pluginDir, 'skills', 'claw-monitor', 'src', 'monitor.js');
        if (!fs.existsSync(monitorScript)) {
          results.push(`错误：找不到 monitor.js，路径: ${monitorScript}`);
        } else {
          const logFile = path.join(dataDir, 'monitor.log');
          const out = fs.openSync(logFile, 'a');
          const child = spawn('node', [monitorScript], {
            stdio: ['ignore', out, out],
            detached: true,
            env: {
              ...process.env,
              WEB_PORT: String(cfg.monitor?.port || 9001),
              INFRA_DATA_DIR: dataDir
            }
          });
          child.unref();
          pids.monitor = child.pid;
          results.push(`monitor 已启动 (pid ${child.pid})，端口 ${cfg.monitor?.port || 9001}`);
        }
      }
    }

    // ── 启动 frpc ──
    if (service === 'all' || service === 'frpc') {
      if (pids.frpc && isRunning(pids.frpc)) {
        results.push(`frpc 已在运行 (pid ${pids.frpc})`);
      } else {
        const frpcBin = frpcBinPath(home);
        if (!frpcBin) {
          results.push('错误：找不到 frpc，请先运行 postinstall 或手动安装 frpc 到 ~/bin/');
        } else {
          const tomlPath = generateFrpcToml(cfg, dataDir);
          if (!tomlPath) {
            results.push('错误：未配置 frpc.serverAddr，请在插件 config 中设置');
          } else {
            const logFile = path.join(dataDir, 'frpc.log');
            const out = fs.openSync(logFile, 'a');
            const child = spawn(frpcBin, ['-c', tomlPath], {
              stdio: ['ignore', out, out],
              detached: true
            });
            child.unref();
            pids.frpc = child.pid;
            results.push(`frpc 已启动 (pid ${child.pid})`);
          }
        }
      }
    }

    savePids(dataDir, pids);
    return { results };
  }

  return { error: `未知操作: ${action}` };
}
