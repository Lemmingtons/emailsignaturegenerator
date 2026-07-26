// ── Minimal PNG encoder ──
// Writes an 8-bit RGBA PNG. No dependencies, runs in a Cloudflare Worker and in
// Node (the validator exercises it there).
//
// Email clients will not render `data:` or SVG images, so social icons have to be
// real hosted PNGs. Their colour depends on the customer's brand, which means the
// Worker has to produce them on demand — hence an encoder rather than a pile of
// pre-rendered files.
//
// Deflate uses stored (uncompressed) blocks. That is a legitimate zlib stream and
// costs nothing worth optimising at these sizes: a 44x44 icon is under 8 KB and is
// then cached forever at the edge.

(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.PngEncoder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  // ── CRC32 (PNG chunk checksums) ──

  let crcTable = null;

  function buildCrcTable() {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  }

  function crc32(bytes) {
    if (!crcTable) crcTable = buildCrcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ── Adler32 (zlib stream checksum) ──

  function adler32(bytes) {
    let a = 1;
    let b = 0;
    // 5552 is the largest run that cannot overflow the 32-bit accumulator.
    for (let i = 0; i < bytes.length;) {
      const end = Math.min(i + 5552, bytes.length);
      for (; i < end; i++) {
        a += bytes[i];
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  // ── Byte helpers ──

  function u32(value) {
    return [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF];
  }

  function chunk(type, data) {
    const typeBytes = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
    const body = new Uint8Array(typeBytes.length + data.length);
    body.set(typeBytes, 0);
    body.set(data, typeBytes.length);

    const out = new Uint8Array(4 + body.length + 4);
    out.set(u32(data.length), 0);
    out.set(body, 4);
    out.set(u32(crc32(body)), 4 + body.length);
    return out;
  }

  // Wraps raw bytes in a zlib stream built from stored deflate blocks.
  function zlibStored(raw) {
    const MAX_BLOCK = 65535;
    const blockCount = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
    const out = new Uint8Array(2 + blockCount * 5 + raw.length + 4);

    let p = 0;
    out[p++] = 0x78; // CM = deflate, CINFO = 32K window
    out[p++] = 0x01; // no preset dict, check bits make the header divisible by 31

    for (let offset = 0; offset < raw.length || offset === 0; offset += MAX_BLOCK) {
      const len = Math.min(MAX_BLOCK, raw.length - offset);
      const isLast = offset + len >= raw.length;
      out[p++] = isLast ? 1 : 0;      // BFINAL, BTYPE = 00 (stored)
      out[p++] = len & 0xFF;          // LEN, little-endian
      out[p++] = (len >>> 8) & 0xFF;
      out[p++] = ~len & 0xFF;         // NLEN, one's complement of LEN
      out[p++] = (~len >>> 8) & 0xFF;
      out.set(raw.subarray(offset, offset + len), p);
      p += len;
      if (isLast) break;
    }

    out.set(u32(adler32(raw)), p);
    p += 4;

    return out.subarray(0, p);
  }

  /**
   * Encode RGBA pixels as a PNG.
   *
   * @param {Uint8Array|Uint8ClampedArray} rgba width*height*4
   * @param {number} width
   * @param {number} height
   * @returns {Uint8Array}
   */
  function encode(rgba, width, height) {
    if (!width || !height) throw new Error('png_dimensions_required');
    if (rgba.length !== width * height * 4) throw new Error('png_size_mismatch');

    // Each scanline is prefixed with its filter byte; 0 means no filtering.
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 0;
      raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }

    const ihdr = new Uint8Array([
      ...u32(width),
      ...u32(height),
      8,  // bit depth
      6,  // colour type: truecolour with alpha
      0,  // compression: deflate
      0,  // filter method
      0,  // no interlace
    ]);

    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const idat = chunk('IDAT', zlibStored(raw));
    const ihdrChunk = chunk('IHDR', ihdr);
    const iend = chunk('IEND', new Uint8Array(0));

    const out = new Uint8Array(signature.length + ihdrChunk.length + idat.length + iend.length);
    let p = 0;
    out.set(signature, p); p += signature.length;
    out.set(ihdrChunk, p); p += ihdrChunk.length;
    out.set(idat, p); p += idat.length;
    out.set(iend, p);

    return out;
  }

  /**
   * Build RGBA pixels by tinting an alpha mask with a solid colour.
   * Pixels are premultiplied against nothing — the alpha channel carries the shape,
   * which is what an email client composites over its own background.
   */
  function tintMask(mask, width, height, rgb) {
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = mask[p];
    }
    return rgba;
  }

  return Object.freeze({
    encode,
    tintMask,
    _crc32: crc32,
    _adler32: adler32,
  });
});
