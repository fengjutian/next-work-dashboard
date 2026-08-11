// gen-qr.mjs - 生成 mycast://pair QR 码 PNG
// 用法: node gen-qr.mjs <6位配对码>
import QRCode from 'qrcode';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = (process.argv[2] || '').trim();
if (!/^\d{6}$/.test(code)) {
  console.error('用法: node gen-qr.mjs <6位配对码>');
  process.exit(1);
}

const HOST = '192.168.2.196';
const HTTP_PORT = 17890;
const WS_PORT = 17890;
const uri = `mycast://pair?host=${HOST}&httpPort=${HTTP_PORT}&wsPort=${WS_PORT}&code=${code}`;

const pngPath = resolve(__dirname, 'qr.png');
const svgPath = resolve(__dirname, 'qr.svg');

await QRCode.toFile(pngPath, uri, { width: 600, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000', light: '#fff' } });
const svg = await QRCode.toString(uri, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000', light: '#fff' } });
writeFileSync(svgPath, svg);

console.log('URI:', uri);
console.log('PNG:', pngPath);
console.log('SVG:', svgPath);
