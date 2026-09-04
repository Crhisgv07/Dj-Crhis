// Genera build/icon.png (512×512) con la marca CRHIS. Sin dependencias.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const S = 512;
const buf = Buffer.alloc(S * S * 4);

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const ba = buf[i + 3] / 255;
  const na = a / 255;
  const out = na + ba * (1 - na);
  buf[i] = Math.round((r * na + buf[i] * ba * (1 - na)) / (out || 1));
  buf[i + 1] = Math.round((g * na + buf[i + 1] * ba * (1 - na)) / (out || 1));
  buf[i + 2] = Math.round((b * na + buf[i + 2] * ba * (1 - na)) / (out || 1));
  buf[i + 3] = Math.round(out * 255);
}

const cx = S / 2;
const cy = S / 2;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    // fondo redondeado oscuro
    if (d < 232) set(x, y, 14, 15, 18, 255);
    // aro metálico
    if (d > 196 && d < 232) set(x, y, 60, 66, 78, 255);
    // disco central
    if (d < 150) set(x, y, 22, 24, 30, 255);
    // agujero
    if (d < 26) set(x, y, 8, 9, 11, 255);
    // barra diagonal cian (marca)
    const rot = (dx * 0.7071 + dy * 0.7071);
    const perp = (-dx * 0.7071 + dy * 0.7071);
    if (Math.abs(perp) < 22 && Math.abs(rot) < 176 && d < 232) {
      set(x, y, 46, 230, 207, 255);
    }
    // anillo LED cian tenue
    if (d > 160 && d < 172) {
      const ang = Math.atan2(dy, dx);
      if (Math.floor(ang * 40) % 2 === 0) set(x, y, 46, 230, 207, 150);
    }
  }
}

// --- Encode PNG (RGBA, filtro 0 por scanline) ---
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
}
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = fileURLToPath(new URL("../build/icon.png", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
