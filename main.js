#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const readline = require('readline');

const LOG_FILE = path.join(os.tmpdir(), 'image-compressor.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args
    .map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch {}
}

log('==================== 启动 ====================');
log('argv =', process.argv);
log('cwd =', process.cwd());
log('execPath =', process.execPath, '| node', process.version, '| pid', process.pid);
console.log(`[调试] 日志写入 ${LOG_FILE}`);

process.on('uncaughtException', err => {
  log('!! uncaughtException:', err && err.stack ? err.stack : String(err));
});
process.on('unhandledRejection', err => {
  log('!! unhandledRejection:', err && err.stack ? err.stack : String(err));
});
process.on('exit', code => {
  log('---- exit ----', `code=${code}`);
});

let render, FORMATS;
try {
  ({ render, FORMATS } = require('./src/renderer'));
  log('[依赖] renderer / sharp 加载成功');
} catch (err) {
  log('!! 依赖加载失败:', err && err.stack ? err.stack : String(err));
  throw err;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.avif', '.tiff'];

const BANNER = `
╔══════════════════════════════════╗
║       图片压缩  v1.1.1           ║
║    Image Compressor Desktop      ║
╚══════════════════════════════════╝
`;

function isImageFile(p) {
  return typeof p === 'string' && IMAGE_EXTS.includes(path.extname(p).toLowerCase()) && fs.existsSync(p);
}

function notify(apiBase, message, notifyType = 'success') {
  try {
    const data = JSON.stringify({ notify_type: notifyType, message });
    const req = http.request({
      hostname: '127.0.0.1', port: 9527, path: '/api/notify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    });
    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch {}
}

function pause(seconds = 5, prompt = `\n窗口将在 ${seconds} 秒后自动关闭，按 Enter 键立即关闭...`) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const timer = setTimeout(finish, seconds * 1000);

    if (!process.stdin.isTTY) return;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      clearTimeout(timer);
      rl.close();
      finish();
    });
  });
}

function settingsFromParams(params = {}) {
  const quality = Number(params.quality ?? 80);
  return {
    quality: Number.isFinite(quality) ? Math.min(100, Math.max(1, Math.round(quality))) : 80,
    format: FORMATS.includes(params.format) ? params.format : 'jpeg',
    maxSize: Math.max(0, Math.round(Number(params.max_size ?? 0)) || 0),
  };
}

function writeEnvelope(env, payload) {
  if (!env || !env.output_json) { log('[信封] 跳过（无 output_json）', payload); return; }
  try {
    fs.writeFileSync(env.output_json, JSON.stringify(payload, null, 2), 'utf8');
    log('[信封] 已写入', env.output_json, payload);
  } catch (err) {
    log('!! [信封] 写入失败:', env.output_json, err && err.stack ? err.stack : String(err));
  }
}

async function processFiles(files, settings) {
  const outputPaths = [];
  const failures = [];

  for (const file of files) {
    const name = path.basename(file);
    try {
      const result = await render(file, settings);
      const saved = result.originalSize > 0
        ? ((1 - result.compressedSize / result.originalSize) * 100).toFixed(1)
        : '?';
      console.log(`  ✓ ${name} → ${path.basename(result.outputPath)} (节省 ${saved}%)`);
      log(`[OK] ${file} -> ${result.outputPath} (节省 ${saved}%, ${result.originalSize}->${result.compressedSize})`);
      outputPaths.push(result.outputPath);
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`);
      log(`[FAIL] ${file}:`, err && err.stack ? err.stack : String(err));
      failures.push({ file, error: err.message });
    }
  }

  return { outputPaths, failures };
}

async function runBatch(files, settings) {
  console.log(BANNER);
  console.log(`[批处理] 共 ${files.length} 个文件 | 格式 ${settings.format.toUpperCase()} | 质量 ${settings.quality}`);
  return processFiles(files, settings);
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonPath = argv[0] && argv[0].endsWith('.json') ? argv[0] : null;
  log('--- main() ---', `argv.slice(2)=${JSON.stringify(argv)} | jsonPath=${jsonPath}`);

  // 无参数直接运行：打开本地可视化界面（拖拽预览 + 手动下载）
  if (argv.length === 0) {
    log('[分支] 无参数 -> 打开图形界面');
    console.log(BANNER);
    console.log('[启动] 正在打开图形界面...');
    const { start } = require('./src/server');
    await start([]);
    return;
  }

  // 盒子触发：命令行第一个参数是参数 JSON 文件
  if (jsonPath && fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    log('[JSON 原文]', raw);
    const payload = JSON.parse(raw);
    const env = payload.environment || {};
    const data = payload.data || {};
    const params = payload.params || {};
    const isNode = env.invoke_mode === 'node';
    const files = (data.target_paths || []).filter(isImageFile);
    const settings = settingsFromParams(params);

    log('[分支] 盒子 JSON', `invoke_mode=${env.invoke_mode} isNode=${isNode}`);
    log('[data]', data, '| [params]', params, '| [settings]', settings);
    log('[有效文件]', files, `(原始 ${(data.target_paths || []).length} 个)`);

    if (files.length === 0) {
      const msg = '未找到可处理的图片';
      log('[结果] 无有效文件');
      if (isNode) {
        writeEnvelope(env, { code: 1, msg, output_paths: [], failed: [] });
      } else {
        console.log(msg);
        notify(env.api_base, msg, 'warning');
        await pause();
      }
      return;
    }

    if (!isNode) {
      const { outputPaths, failures } = await runBatch(files, settings);
      log('[结果] 手动完成', `成功 ${outputPaths.length}, 失败 ${failures.length}`);
      console.log(`\n完成: ${outputPaths.length} 成功, ${failures.length} 失败`);
      notify(env.api_base, `压缩完成: ${outputPaths.length} 成功, ${failures.length} 失败`,
        failures.length ? 'warning' : 'success');
      await pause();
      return;
    }

    // 节点模式：无人值守，直接回传信封
    const { outputPaths, failures } = await processFiles(files, settings);
    log('[结果] 节点完成', `成功 ${outputPaths.length}, 失败 ${failures.length}`);
    writeEnvelope(env, {
      code: outputPaths.length > 0 ? 0 : 2,
      msg: `成功 ${outputPaths.length} 个，失败 ${failures.length} 个`,
      output_paths: outputPaths,
      failed: failures,
    });
    return;
  }

  // 命令行直接传图片路径：本地批处理
  const files = argv.filter(isImageFile);
  log('[分支] CLI 路径', `有效 ${files.length}/${argv.length}`);
  if (files.length === 0) {
    console.log('错误: 未找到有效的图片文件');
    console.log('用法: node main.js <图片文件1> <图片文件2> ...');
    await pause();
    process.exit(1);
  }

  const { outputPaths, failures } = await runBatch(files, settingsFromParams({}));
  log('[结果] CLI 完成', `成功 ${outputPaths.length}, 失败 ${failures.length}`);
  console.log(`\n完成: ${outputPaths.length} 成功, ${failures.length} 失败`);
  await pause();
}

main().catch(async err => {
  log('!! main() 捕获异常:', err && err.stack ? err.stack : String(err));
  console.error('错误:', err.message);
  await pause();
  process.exit(1);
});
