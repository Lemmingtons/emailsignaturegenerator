// Media encoders & animators: PNG chunk structure/CRC32/zlib round-trip
// (including multi-block stored deflate >65,535 bytes), GIF89a proper block
// framing + dithering, PhotoAnimator.shapeStill, and SweepAnimator.buildDrawFrames.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const PngEncoder = require('../js/png-encoder');
const GifEncoder = require('../js/gif-encoder');
const PhotoAnimator = require('../js/photo-animator');
const SweepAnimator = require('../js/sweep-animator');

// ── PNG chunk parser + independent CRC32 verifier ──

// Independent IEEE 802.3 CRC32 (polynomial 0xEDB88320) so we do not only check
// PngEncoder against its own _crc32 implementation.
function referenceCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function parsePng(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.ok(bytes.length >= 8, 'PNG shorter than signature');
  for (let i = 0; i < 8; i++) assert.equal(bytes[i], sig[i], `PNG signature byte ${i}`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'truncated PNG chunk header');
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= bytes.length, `truncated PNG chunk ${type}`);
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = view.getUint32(dataEnd, false);
    const chunkBody = bytes.subarray(offset + 4, dataEnd);
    assert.equal(referenceCrc32(chunkBody), expectedCrc, `independent CRC32 mismatch on chunk ${type}`);
    assert.equal(PngEncoder._crc32(chunkBody), expectedCrc, `PngEncoder CRC32 mismatch on chunk ${type}`);
    chunks.push({ type, length, data });
    offset = dataEnd + 4;
  }
  assert.equal(offset, bytes.length, 'trailing bytes after PNG chunks');
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks[chunks.length - 1].type, 'IEND');
  assert.equal(chunks[chunks.length - 1].length, 0);

  const ihdr = chunks[0].data;
  const ihdrView = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const width = ihdrView.getUint32(0, false);
  const height = ihdrView.getUint32(4, false);
  assert.equal(ihdr[8], 8, 'bit depth 8');
  assert.equal(ihdr[9], 6, 'colour type 6 (RGBA)');
  assert.equal(ihdr[10], 0, 'deflate compression');
  assert.equal(ihdr[11], 0, 'filter method 0');
  assert.equal(ihdr[12], 0, 'no interlace');

  const idatChunks = chunks.filter((c) => c.type === 'IDAT');
  assert.ok(idatChunks.length >= 1, 'PNG must contain IDAT');
  const compressed = Buffer.concat(idatChunks.map((c) => Buffer.from(c.data)));
  const raw = zlib.inflateSync(compressed);
  const stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height, 'inflated scanline byte count');

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, `scanline ${y} filter byte must be 0`);
    rgba.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, chunks, rgba };
}

// 1. Direct PNG encode + tintMask + discMask pixel verification.
{
  const w = 4;
  const h = 3;
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 17) & 0xff;
    pixels[i + 1] = (i * 31) & 0xff;
    pixels[i + 2] = (i * 47) & 0xff;
    pixels[i + 3] = i % 8 === 0 ? 128 : 255;
  }
  const parsed = parsePng(PngEncoder.encode(pixels, w, h));
  assert.equal(parsed.width, w);
  assert.equal(parsed.height, h);
  assert.deepEqual(parsed.rgba, pixels, 'decoded RGBA pixels match source exactly');

  // tintMask keeps rgb and maps mask into alpha.
  const mask = new Uint8Array([0, 64, 192, 255]);
  const tinted = PngEncoder.tintMask(mask, 2, 2, [14, 90, 138]);
  const parsedTint = parsePng(PngEncoder.encode(tinted, 2, 2));
  for (let p = 0; p < 4; p++) {
    assert.deepEqual([...parsedTint.rgba.subarray(p * 4, p * 4 + 4)], [14, 90, 138, mask[p]]);
  }

  // discMask renders an antialiased filled disc with knocked-out white glyph inside.
  const size = 24;
  const fullMask = new Uint8Array(size * size).fill(255);
  const disc = PngEncoder.discMask(fullMask, size, [10, 80, 160]);
  const parsedDisc = parsePng(PngEncoder.encode(disc, size, size));
  // Corner (0,0) is outside the disc -> alpha 0.
  assert.equal(parsedDisc.rgba[3], 0, 'discMask corner is transparent');
  // Centre pixel is inside the full white glyph -> white and opaque.
  const mid = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
  assert.deepEqual([...parsedDisc.rgba.subarray(mid, mid + 4)], [255, 255, 255, 255]);
  // A pixel near the disc rim (inside disc, outside inner glyph) uses the brand rgb.
  const rim = (Math.floor(size / 2) * size + 2) * 4;
  assert.deepEqual([...parsedDisc.rgba.subarray(rim, rim + 4)], [10, 80, 160, 255]);

  assert.throws(() => PngEncoder.encode(new Uint8Array(4), 0, 1), /png_dimensions_required/);
  assert.throws(() => PngEncoder.encode(new Uint8Array(4), 2, 2), /png_size_mismatch/);
}

// 2. Multi-block zlibStored (>65,535 raw scanline bytes).
{
  const w = 150;
  const h = 150; // raw scanlines = 150 * (600 + 1) = 90,150 bytes (> 65,535)
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      pixels[i] = (x * 3 + y) & 0xff;
      pixels[i + 1] = (y * 5) & 0xff;
      pixels[i + 2] = (x ^ y) & 0xff;
      pixels[i + 3] = 255;
    }
  }
  const png = PngEncoder.encode(pixels, w, h);
  const parsed = parsePng(png);
  assert.equal(parsed.width, w);
  assert.equal(parsed.height, h);
  assert.deepEqual(parsed.rgba, pixels, 'multi-block zlibStored PNG inflates to exact pixels');
}

// ── GIF89a structural block parser (no raw 0x2C scan) ──

function parseGif(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 6)).toString('ascii'), 'GIF89a', 'GIF89a header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const packed = bytes[10];
  const hasGct = (packed & 0x80) !== 0;
  const gctCount = hasGct ? (1 << ((packed & 0x07) + 1)) : 0;
  let pos = 13 + gctCount * 3;

  const frames = [];
  let netscapeLoop = false;
  let pendingGce = null;

  function skipSubBlocks() {
    while (pos < bytes.length) {
      const size = bytes[pos++];
      if (size === 0) return;
      assert.ok(pos + size <= bytes.length, 'GIF sub-block overruns buffer');
      pos += size;
    }
    assert.fail('unterminated GIF sub-block sequence');
  }

  while (pos < bytes.length) {
    const introducer = bytes[pos++];
    if (introducer === 0x3B) {
      assert.equal(pos, bytes.length, 'bytes found after GIF trailer');
      return { width, height, gctCount, netscapeLoop, frames };
    }
    if (introducer === 0x21) {
      const label = bytes[pos++];
      if (label === 0xF9) {
        const blockSize = bytes[pos++];
        assert.equal(blockSize, 4, 'GCE block size must be 4');
        const gcePacked = bytes[pos];
        const delay = view.getUint16(pos + 1, true);
        const transparentIndex = bytes[pos + 3];
        pos += 4;
        assert.equal(bytes[pos++], 0, 'GCE terminator');
        pendingGce = {
          disposal: (gcePacked >> 2) & 0x07,
          hasTransparency: (gcePacked & 0x01) !== 0,
          delay,
          transparentIndex,
        };
      } else if (label === 0xFF) {
        const appBlockSize = bytes[pos++];
        const appId = Buffer.from(bytes.subarray(pos, pos + appBlockSize)).toString('ascii');
        pos += appBlockSize;
        if (appId === 'NETSCAPE2.0') netscapeLoop = true;
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
    } else if (introducer === 0x2C) {
      const left = view.getUint16(pos, true);
      const top = view.getUint16(pos + 2, true);
      const frameW = view.getUint16(pos + 4, true);
      const frameH = view.getUint16(pos + 6, true);
      const imgPacked = bytes[pos + 8];
      pos += 9;
      if (imgPacked & 0x80) {
        const lctCount = 1 << ((imgPacked & 0x07) + 1);
        pos += lctCount * 3;
      }
      const lzwMinCodeSize = bytes[pos++];
      assert.ok(lzwMinCodeSize >= 2 && lzwMinCodeSize <= 8, 'valid LZW minimum code size');
      skipSubBlocks();
      frames.push({ left, top, width: frameW, height: frameH, gce: pendingGce });
      pendingGce = null;
    } else {
      assert.fail(`unexpected GIF block introducer 0x${introducer.toString(16)} at offset ${pos - 1}`);
    }
  }
  assert.fail('missing GIF trailer 0x3B');
}

// 3. GIF block framing, inter-frame differencing, hold frames, and dither: true.
{
  const w = 32;
  const h = 32;
  const makeGradient = (offset) => {
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        buf[i] = Math.min(255, x * 8);
        buf[i + 1] = Math.min(255, y * 8);
        buf[i + 2] = (x + y + offset) * 3 & 0xff;
        buf[i + 3] = 255;
      }
    }
    return buf;
  };

  const frame0 = makeGradient(0);
  const frame1 = frame0.slice();
  // Mutate only a 4x4 patch in the middle.
  for (let y = 12; y < 16; y++) {
    for (let x = 10; x < 14; x++) {
      const i = (y * w + x) * 4;
      frame1[i] = 255; frame1[i + 1] = 20; frame1[i + 2] = 20;
    }
  }
  const frame2 = frame1.slice(); // identical hold frame

  const gif = GifEncoder.encode({
    width: w,
    height: h,
    frames: [frame0, frame1, frame2],
    delay: [6, 8, 500],
    loop: true,
    dither: false,
    optimise: true,
  });
  const parsed = parseGif(gif);
  assert.equal(parsed.width, w);
  assert.equal(parsed.height, h);
  assert.equal(parsed.netscapeLoop, true);
  assert.equal(parsed.frames.length, 3);
  assert.deepEqual(parsed.frames.map((f) => f.gce.delay), [6, 8, 500]);
  assert.equal(parsed.frames[0].width, w);
  assert.equal(parsed.frames[0].height, h);
  assert.equal(parsed.frames[0].gce.hasTransparency, false);
  assert.ok(parsed.frames[1].width < w && parsed.frames[1].height < h, 'changed sub-rectangle is cropped');
  assert.equal(parsed.frames[1].gce.hasTransparency, true);
  assert.equal(parsed.frames[2].width, 1, 'identical hold frame collapses to 1x1');
  assert.equal(parsed.frames[2].height, 1);

  // Floyd-Steinberg dithering path (dither: true) produces valid GIF89a framing
  // and differs from undithered output under a constrained palette.
  const undithered = GifEncoder.encode({
    width: w, height: h, frames: [frame0], delay: 8, loop: false, dither: false, maxColors: 16,
  });
  const dithered = GifEncoder.encode({
    width: w, height: h, frames: [frame0], delay: 8, loop: false, dither: true, maxColors: 16,
  });
  const parsedDither = parseGif(dithered);
  assert.equal(parsedDither.netscapeLoop, false);
  assert.equal(parsedDither.frames.length, 1);
  assert.notEqual(Buffer.compare(Buffer.from(undithered), Buffer.from(dithered)), 0, 'dither: true alters quantised pixels');

  assert.throws(() => GifEncoder.encode({ width: 0, height: 10, frames: [frame0] }), /gif_dimensions_required/);
  assert.throws(() => GifEncoder.encode({ width: w, height: h, frames: [] }), /gif_no_frames/);
  assert.throws(() => GifEncoder.encode({ width: w, height: h, frames: [new Uint8ClampedArray(4)] }), /gif_frame_size_mismatch/);
}

// 4. PhotoAnimator.shapeStill
{
  const size = 32;
  const photo = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    photo[i] = 20; photo[i + 1] = 120; photo[i + 2] = 200; photo[i + 3] = 255;
  }

  // square returns a copy without mutating the source.
  const sq = PhotoAnimator.shapeStill({ photo, size, shape: 'square', background: '#ffffff' });
  assert.notEqual(sq, photo);
  assert.deepEqual(sq, photo);

  // circle composites corners onto background while preserving the centre.
  const circ = PhotoAnimator.shapeStill({ photo, size, shape: 'circle', background: '#ff0000' });
  assert.deepEqual([...circ.subarray(0, 4)], [255, 0, 0, 255], 'circle corner uses background colour');
  const mid = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
  assert.deepEqual([...circ.subarray(mid, mid + 4)], [20, 120, 200, 255], 'circle centre preserves photo');
  // Input buffer must stay untouched.
  assert.deepEqual([...photo.subarray(0, 4)], [20, 120, 200, 255], 'shapeStill does not mutate input');

  // rounded composites extreme corners while preserving mid-edge pixels inside the radius.
  const rnd = PhotoAnimator.shapeStill({ photo, size, shape: 'rounded', background: '#ffffff' });
  assert.deepEqual([...rnd.subarray(0, 4)], [255, 255, 255, 255], 'rounded corner uses background');
  const topMid = Math.floor(size / 2) * 4;
  assert.deepEqual([...rnd.subarray(topMid, topMid + 4)], [20, 120, 200, 255], 'rounded top edge stays photo');

  assert.throws(() => PhotoAnimator.shapeStill({ photo: new Uint8ClampedArray(4), size }), /photo_size_mismatch/);
}

// 5. SweepAnimator.buildDrawFrames
{
  const width = 40;
  const height = 4;
  const artwork = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    artwork[i] = 10; artwork[i + 1] = 60; artwork[i + 2] = 180; artwork[i + 3] = 255;
  }

  const built = SweepAnimator.buildDrawFrames({
    artwork, width, height, background: [255, 255, 255], frames: 6, delay: 5,
  });
  assert.equal(built.frames.length, 6);
  assert.equal(built.delay, 5);

  // Frame 0 is the completed artwork (Outlook fallback), matching the final frame.
  // Interior columns x <= width - 2 are 100% revealed (exact match to artwork),
  // while the rightmost 1px column blends over the 2px feather edge.
  assert.deepEqual(built.frames[0], built.frames[built.frames.length - 1], 'frame 0 and final frame match for seamless loop');
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= width - 2; x++) {
      const i = (y * width + x) * 4;
      assert.deepEqual(
        [...built.frames[0].subarray(i, i + 4)],
        [...artwork.subarray(i, i + 4)],
        `frame 0 interior pixel (${x},${y}) matches artwork`,
      );
    }
  }

  // Frame 1 reveals left side while far right stays background.
  const rightPixel = (width - 1) * 4;
  assert.deepEqual([...built.frames[1].subarray(rightPixel, rightPixel + 4)], [255, 255, 255, 255], 'frame 1 hides right side');
  assert.ok(built.frames[1][0] < 255, 'frame 1 starts revealing from the left');

  // Revealed width increases monotonically across frames 1..last.
  const revealedCols = (frame) => {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (frame[x * 4] < 250) count++;
    }
    return count;
  };
  for (let f = 2; f < built.frames.length; f++) {
    assert.ok(revealedCols(built.frames[f]) >= revealedCols(built.frames[f - 1]), `frame ${f} does not shrink revealed width`);
  }
  assert.equal(built.frames[built.frames.length - 1][0], artwork[0]);
  assert.equal(built.frames[built.frames.length - 1][(width - 2) * 4], artwork[(width - 2) * 4]);

  assert.throws(() => SweepAnimator.buildDrawFrames({ artwork, width: 0, height }), /sweep_dimensions_required/);
  assert.throws(() => SweepAnimator.buildDrawFrames({ artwork: new Uint8ClampedArray(4), width, height }), /sweep_size_mismatch/);
}

console.log('Media encoder and animator checks passed.');
