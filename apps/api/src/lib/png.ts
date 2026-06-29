import zlib from 'node:zlib';

/**
 * Minimal, dependency-free PNG encoder used to synthesize placeholder media
 * for the seed (logo + homepage screenshot) so seeded {key,url} references
 * actually resolve. Not a general-purpose codec — solid RGB only.
 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const idx = (c ^ buf[i]!) & 0xff;
    c = CRC_TABLE[idx]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [Number.isNaN(r) ? 0 : r, Number.isNaN(g) ? 0 : g, Number.isNaN(b) ? 0 : b];
}

/** Encode an RGB PNG whose pixels are produced by `fill(x, y)`. */
export function makeRgbPng(width: number, height: number, fill: (x: number, y: number) => Rgb): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      raw[p++] = r & 0xff;
      raw[p++] = g & 0xff;
      raw[p++] = b & 0xff;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

export function solidPng(width: number, height: number, color: string): Buffer {
  const rgb = hexToRgb(color);
  return makeRgbPng(width, height, () => rgb);
}

/** A simple branded placeholder: `bg` field with a centered `fg` square. */
export function badgePng(size: number, bg: string, fg: string): Buffer {
  const bgRgb = hexToRgb(bg);
  const fgRgb = hexToRgb(fg);
  const m = Math.floor(size * 0.28);
  return makeRgbPng(size, size, (x, y) =>
    x >= m && x < size - m && y >= m && y < size - m ? fgRgb : bgRgb,
  );
}
