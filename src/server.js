const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');
const { compressBuffer } = require('./renderer');

const PORT = 19530;
const WIN_W = 1100;
const WIN_H = 750;
const CONFIG_FILE = path.join(__dirname, '..', 'image-compressor-config.json');
const PID_FILE = path.join(os.tmpdir(), 'bmscript-image-compressor.pid');
const DATA_DIR = path.join(os.tmpdir(), 'bmscript-image-compressor-data');

const DEFAULT_CONFIG = {
  quality: 80,
  format: 'jpeg',
  maxSize: 0,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const HTML = `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>图片压缩</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={darkMode:'class'}</script>
<link rel="icon" href="imgs/logo.png">
<style>
input[type="range"]{accent-color:#14b8a6;height:6px}
input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:#14b8a6;cursor:pointer;box-shadow:0 0 10px rgba(20,184,166,.4)}
canvas{max-width:100%;max-height:400px;border-radius:.5rem}
#toast{transition:opacity .3s;opacity:0;pointer-events:none}
#toast.show{opacity:1}
.preview-grid{background:repeating-conic-gradient(#1f2937 0% 25%,#111827 0% 50%) 50%/20px 20px}
</style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen flex flex-col">

<div class="flex flex-1 overflow-hidden">
  <aside class="w-72 bg-gray-900/80 border-r border-gray-800 p-4 space-y-3 overflow-y-auto shrink-0">
    <h1 class="text-lg font-bold text-teal-400 mb-1">
      <svg class="inline w-5 h-5 mr-1 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
      图片压缩
    </h1>
    <p class="text-xs text-gray-500">支持 JPEG / PNG / WebP / AVIF</p>

    <hr class="border-gray-800">

    <div>
      <div class="upload-area border-2 border-dashed border-gray-600 rounded-xl p-4 text-center cursor-pointer hover:border-teal-500 hover:bg-teal-500/5 transition" id="uploadArea" onclick="document.getElementById('fileInput').click()">
        <div class="text-3xl mb-1">📷</div>
        <p class="text-sm text-gray-400">点击或拖拽图片</p>
        <p class="text-xs text-gray-600 mt-1">JPG / PNG / WebP</p>
      </div>
      <input type="file" id="fileInput" accept="image/*" class="hidden" onchange="handleFile(this.files[0])">
    </div>

    <hr class="border-gray-800">

    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-gray-400 text-xs">压缩质量</label>
        <span class="font-semibold text-xs w-12 text-right text-teal-400" id="qualityValue">80%</span>
      </div>
      <input type="range" id="quality" min="10" max="100" value="80" class="w-full" oninput="updatePreview()">
    </div>

    <div>
      <label class="text-gray-400 text-xs block mb-1">输出格式</label>
      <select id="format" class="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm focus:outline-none focus:border-teal-400" onchange="updatePreview()">
        <option value="jpeg">JPEG</option>
        <option value="png">PNG</option>
        <option value="webp">WebP</option>
        <option value="avif">AVIF</option>
      </select>
    </div>

    <div>
      <label class="text-gray-400 text-xs block mb-1">最大尺寸</label>
      <select id="maxSize" class="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm focus:outline-none focus:border-teal-400" onchange="updatePreview()">
        <option value="0">原尺寸</option>
        <option value="1920">1920px</option>
        <option value="1280">1280px</option>
        <option value="800">800px</option>
        <option value="640">640px</option>
      </select>
    </div>

    <hr class="border-gray-800">

    <button class="w-full py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium transition cursor-pointer" onclick="saveConfig()">💾 保存配置</button>
  </aside>

  <main class="flex-1 flex flex-col p-4 gap-3 overflow-auto">
    <div class="bg-teal-900/40 border border-teal-800 rounded-lg px-4 py-2.5 text-sm text-teal-200 leading-relaxed">
      <strong>💡 提示：</strong>调整参数实时预览，配置支持保存复用。您可通过“不忙脚本盒子”的右键菜单或快捷键快速选图，并按当前配置在后台批量压缩。
    </div>

    <div class="flex gap-2 flex-wrap">
      <button class="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition cursor-pointer" onclick="download()">📥 下载压缩图片</button>
      <button class="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm hover:border-teal-400 transition cursor-pointer" onclick="resetImage()">🔄 重新上传</button>
    </div>

    <div class="grid grid-cols-2 gap-4 flex-1">
      <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
        <div class="px-3 py-2 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
          <span class="text-xs font-medium text-gray-300">原图</span>
          <span class="text-xs text-gray-500" id="originalSize">-</span>
        </div>
        <div class="flex-1 preview-grid flex items-center justify-center p-2 min-h-[200px] relative">
          <img id="originalImage" class="max-w-full max-h-full object-contain hidden" alt="原图">
          <div id="originalPlaceholder" class="text-center text-gray-600">
            <div class="text-4xl mb-2">🖼️</div>
            <p class="text-sm">选择图片开始</p>
          </div>
        </div>
        <div class="px-3 py-1.5 bg-gray-800/30 border-t border-gray-800 flex gap-4 text-xs text-gray-500">
          <span id="originalWidth">-</span> × <span id="originalHeight">-</span>
          <span id="originalFormat">-</span>
        </div>
      </div>

      <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
        <div class="px-3 py-2 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
          <span class="text-xs font-medium text-gray-300">压缩后</span>
          <span class="text-xs text-teal-400" id="compressedSize">-</span>
        </div>
        <div class="flex-1 preview-grid flex items-center justify-center p-2 min-h-[200px] relative">
          <img id="compressedImage" class="max-w-full max-h-full object-contain hidden" alt="压缩后">
          <div id="compressedPlaceholder" class="text-center text-gray-600">
            <div class="text-4xl mb-2">⚡</div>
            <p class="text-sm">等待压缩</p>
          </div>
        </div>
        <div class="px-3 py-1.5 bg-gray-800/30 border-t border-gray-800 flex gap-4 text-xs text-gray-500">
          <span id="compressedWidth">-</span> × <span id="compressedHeight">-</span>
          <span id="compressedFormat">-</span>
        </div>
      </div>
    </div>

    <div class="bg-gradient-to-r from-teal-900/30 to-purple-900/30 border border-teal-800 rounded-xl px-5 py-3 text-center" id="savingsCard">
      <div class="text-3xl font-bold text-teal-400 font-mono" id="savingsValue">0%</div>
      <div class="text-xs text-gray-500 mt-1">压缩节省</div>
    </div>
  </main>
</div>

<div id="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-lg text-sm font-medium shadow-lg z-50"></div>

<script>
let originalFile = null;
let originalImage = null;
let originalDataUrl = null;
let compressedBlob = null;
const FORMAT_MAP = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
const EXT_MAP = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };

const dropZone = document.getElementById('uploadArea');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('border-teal-500', 'bg-teal-500/5'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-teal-500', 'bg-teal-500/5'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('border-teal-500', 'bg-teal-500/5');
  handleFile(e.dataTransfer.files[0]);
});

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-lg text-sm font-medium shadow-lg z-50 show ' +
    (type === 'error' ? 'bg-red-700 text-white' : type === 'success' ? 'bg-green-700 text-white' : 'bg-teal-700 text-white');
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove('show'), 3000);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  originalFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    originalDataUrl = e.target.result;
    originalImage = new Image();
    originalImage.onload = () => {
      const fmt = file.type.split('/')[1].toUpperCase();
      document.getElementById('originalImage').src = originalDataUrl;
      document.getElementById('originalImage').classList.remove('hidden');
      document.getElementById('originalPlaceholder').classList.add('hidden');
      document.getElementById('originalSize').textContent = formatSize(file.size);
      document.getElementById('originalWidth').textContent = originalImage.width;
      document.getElementById('originalHeight').textContent = originalImage.height;
      document.getElementById('originalFormat').textContent = fmt;
      updatePreview();
    };
    originalImage.src = originalDataUrl;
  };
  reader.readAsDataURL(file);
}

function handleFilePath(filePath) {
  fetch('/api/load-image?path=' + encodeURIComponent(filePath))
    .then(r => { if (!r.ok) throw Error(); return r.blob(); })
    .then(blob => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        originalDataUrl = img.src;
        document.getElementById('originalImage').src = originalDataUrl;
        document.getElementById('originalImage').classList.remove('hidden');
        document.getElementById('originalPlaceholder').classList.add('hidden');
        document.getElementById('originalSize').textContent = formatSize(blob.size);
        document.getElementById('originalWidth').textContent = img.width;
        document.getElementById('originalHeight').textContent = img.height;
        document.getElementById('originalFormat').textContent = filePath.split('.').pop().toUpperCase();
        updatePreview();
      };
      img.src = URL.createObjectURL(blob);
    })
    .catch(() => showToast('无法加载图片', 'error'));
}

function updatePreview() {
  if (!originalImage) return;
  const quality = parseInt(document.getElementById('quality').value);
  const format = document.getElementById('format').value;
  const maxSize = parseInt(document.getElementById('maxSize').value);

  document.getElementById('qualityValue').textContent = quality + '%';

  let width = originalImage.width;
  let height = originalImage.height;

  if (maxSize > 0 && (width > maxSize || height > maxSize)) {
    if (width > height) {
      height = Math.round((height * maxSize) / width);
      width = maxSize;
    } else {
      width = Math.round((width * maxSize) / height);
      height = maxSize;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(originalImage, 0, 0, width, height);

  const mimeType = FORMAT_MAP[format] || 'image/jpeg';
  canvas.toBlob(blob => {
    compressedBlob = blob;
    const url = URL.createObjectURL(blob);
    document.getElementById('compressedImage').src = url;
    document.getElementById('compressedImage').classList.remove('hidden');
    document.getElementById('compressedPlaceholder').classList.add('hidden');
    document.getElementById('compressedSize').textContent = formatSize(blob.size);
    document.getElementById('compressedWidth').textContent = width;
    document.getElementById('compressedHeight').textContent = height;
    document.getElementById('compressedFormat').textContent = format.toUpperCase();

    const origSize = originalFile ? originalFile.size : (originalDataUrl ? Math.round(originalDataUrl.length * 0.75) : 0);
    if (origSize > 0) {
      const savings = ((1 - blob.size / origSize) * 100).toFixed(1);
      document.getElementById('savingsValue').textContent = savings + '%';
    }
  }, mimeType, quality / 100);
}

function resetImage() {
  originalFile = null;
  originalImage = null;
  originalDataUrl = null;
  compressedBlob = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('originalImage').classList.add('hidden');
  document.getElementById('originalPlaceholder').classList.remove('hidden');
  document.getElementById('compressedImage').classList.add('hidden');
  document.getElementById('compressedPlaceholder').classList.remove('hidden');
  document.getElementById('originalSize').textContent = '-';
  document.getElementById('compressedSize').textContent = '-';
  document.getElementById('originalWidth').textContent = '-';
  document.getElementById('originalHeight').textContent = '-';
  document.getElementById('compressedWidth').textContent = '-';
  document.getElementById('compressedHeight').textContent = '-';
  document.getElementById('originalFormat').textContent = '-';
  document.getElementById('compressedFormat').textContent = '-';
  document.getElementById('savingsValue').textContent = '0%';
}

function download() {
  if (!originalImage) { showToast('请先选择图片', 'error'); return; }
  const quality = parseInt(document.getElementById('quality').value);
  const format = document.getElementById('format').value;
  const maxSize = parseInt(document.getElementById('maxSize').value);
  const ext = EXT_MAP[format] || 'jpg';

  showToast('服务端压缩中...', 'info');

  fetch('/api/compress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: originalDataUrl,
      settings: { quality, format, maxSize }
    }),
  })
  .then(r => {
    if (!r.ok) throw Error();
    return r.blob();
  })
  .then(blob => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'compressed_' + Date.now() + '.' + ext;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('下载完成', 'success');
  })
  .catch(() => showToast('压缩失败', 'error'));
}

function loadConfigFromServer() {
  fetch('/api/config').then(r => r.json()).then(cfg => {
    if (cfg.quality !== undefined) document.getElementById('quality').value = cfg.quality;
    if (cfg.format) document.getElementById('format').value = cfg.format;
    if (cfg.maxSize !== undefined) document.getElementById('maxSize').value = cfg.maxSize;
    if (originalImage) updatePreview();
    else document.getElementById('qualityValue').textContent = cfg.quality + '%';
  }).catch(() => {});
}

function saveConfig() {
  const cfg = {
    quality: parseInt(document.getElementById('quality').value),
    format: document.getElementById('format').value,
    maxSize: parseInt(document.getElementById('maxSize').value),
  };
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  }).then(r => r.json()).then(d => {
    if (d.ok) showToast('配置已保存', 'success');
    else showToast('保存失败', 'error');
  }).catch(() => showToast('保存失败', 'error'));
}

loadConfigFromServer();

const searchParams = new URLSearchParams(window.location.search);
const filePaths = searchParams.getAll('files');
if (filePaths.length > 0) handleFilePath(filePaths[0]);
<\/script>
</body>
</html>`;

// --- Compress via Sharp (MozJPEG / libwebp — same encoders as Squoosh) ---

async function compressImage(base64DataUrl, settings = {}) {
  const base64Data = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
  return compressBuffer(Buffer.from(base64Data, 'base64'), settings);
}

// --- Config ---

function loadConfig(configPath) {
  const file = configPath || CONFIG_FILE;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config, configPath) {
  const file = configPath || CONFIG_FILE;
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
}

// --- PID ---

function readPid() {
  try { return JSON.parse(fs.readFileSync(PID_FILE, 'utf8')); } catch { return null; }
}

function writePid() {
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port: PORT }), 'utf8');
}

function cleanPid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// --- Browser ---

function findBrowser() {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const la = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf,   'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(la,   'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf,   'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
}

function getScreenSize() {
  try {
    const out = execSync(
      'wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution /format:csv',
      { encoding: 'utf8', timeout: 3000 }
    );
    const vals = out.trim().split('\n').filter(Boolean).pop().split(',');
    return { w: parseInt(vals[1]), h: parseInt(vals[2]) };
  } catch {
    return { w: 1920, h: 1080 };
  }
}

function openBrowser(url) {
  const browser = findBrowser();
  if (!browser) {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    return null;
  }
  const { w, h } = getScreenSize();
  const posX = Math.round((w - WIN_W) / 2);
  const posY = Math.round((h - WIN_H) / 2);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return spawn(browser, [
    `--app=http://127.0.0.1:${PORT}/`, `--window-size=${WIN_W},${WIN_H}`,
    `--window-position=${posX},${posY}`, `--user-data-dir=${DATA_DIR}`,
    '--no-first-run', '--no-default-browser-check',
  ], { stdio: 'ignore', detached: false });
}

// --- Server ---

function createServer(configPath) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loadConfig(configPath)));
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          saveConfig(JSON.parse(body), configPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/load-image') {
      const fp = url.searchParams.get('path');
      if (!fp) { res.writeHead(400); res.end('Missing path'); return; }
      const ct = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
      });
      return;
    }

    if (url.pathname === '/api/compress' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { image, settings } = JSON.parse(body);
          if (!image) throw new Error('Missing image data');

          const format = settings?.format || 'jpeg';
          const ext = format === 'jpeg' ? 'jpg' : format;
          const mimeType = format === 'jpeg' ? 'image/jpeg'
            : format === 'png' ? 'image/png'
            : format === 'webp' ? 'image/webp'
            : format === 'avif' ? 'image/avif'
            : 'image/jpeg';

          const outputBuffer = await compressImage(image, settings);

          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Disposition': `attachment; filename=compressed.${ext}`,
            'Content-Length': outputBuffer.length,
          });
          res.end(outputBuffer);
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // Serve embedded HTML for root path
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    // Serve other static files from disk
    const root = path.join(__dirname, '..');
    const filePath = path.join(root, decodeURIComponent(url.pathname));
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// --- Start ---

async function start(files, configPath) {
  const existing = readPid();
  if (existing && isAlive(existing.pid)) {
    openBrowser(`http://127.0.0.1:${existing.port}/`);
    process.exit(0);
  }
  const server = await createServer(configPath);
  writePid();
  process.on('exit', () => cleanPid());
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  let url = `http://127.0.0.1:${PORT}/`;
  if (files && files.length > 0) {
    url += '?' + files.map(f => 'files=' + encodeURIComponent(f)).join('&');
  }
  const bp = openBrowser(url);
  if (bp) bp.on('exit', () => { server.close(); process.exit(0); });
}

module.exports = { start, loadConfig, saveConfig };
