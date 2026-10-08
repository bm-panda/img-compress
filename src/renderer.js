const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const EXT_MAP = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

const FORMATS = ['jpeg', 'png', 'webp', 'avif'];

function normalizeSettings(settings = {}) {
  return {
    quality: settings.quality ?? 80,
    format: FORMATS.includes(settings.format) ? settings.format : 'jpeg',
    maxSize: settings.maxSize ?? 0,
  };
}

async function encode(input, settings = {}) {
  const { quality, format, maxSize } = normalizeSettings(settings);

  let pipeline = sharp(input);

  if (maxSize > 0) {
    const { width, height } = await pipeline.metadata();
    if (width > maxSize || height > maxSize) {
      const [w, h] = width > height
        ? [maxSize, Math.round((height * maxSize) / width)]
        : [Math.round((width * maxSize) / height), maxSize];
      pipeline = pipeline.resize(w, h, { fit: 'fill' });
    }
  }

  switch (format) {
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
    case 'jpeg':
    default:
      pipeline = pipeline.jpeg({
        quality,
        mozjpeg: true,
        trellisQuantisation: true,
        overshootDeringing: true,
        optimiseCoding: true,
        chromaSubsampling: '4:2:0',
      });
  }

  return pipeline;
}

async function render(inputPath, settings = {}) {
  const { format } = normalizeSettings(settings);
  const parsed = path.parse(inputPath);
  const ext = EXT_MAP[format] || 'jpg';
  const outputPath = settings.outputPath
    || path.join(parsed.dir, `${parsed.name}_compressed.${ext}`);

  const originalSize = fs.statSync(inputPath).size;
  const pipeline = await encode(inputPath, settings);
  await pipeline.toFile(outputPath);
  const compressedSize = fs.statSync(outputPath).size;

  return { outputPath, originalSize, compressedSize };
}

async function compressBuffer(buffer, settings = {}) {
  const pipeline = await encode(buffer, settings);
  return pipeline.toBuffer();
}

module.exports = { render, compressBuffer, EXT_MAP, FORMATS };
