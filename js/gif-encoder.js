// ── GIF89a encoder ──
// Self-contained animated GIF writer. No dependencies, no build step, runs in the
// browser and in Node (the validator exercises it there).
//
// GIF is the only animated image format email clients render. Animated WebP and
// APNG are not supported by Outlook or Gmail, so everything here targets GIF89a:
// a single global colour table shared by every frame (avoids palette flicker),
// median-cut quantisation, optional Floyd-Steinberg dithering, and LZW compression.

(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.GifEncoder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  // ── Growable byte buffer ──

  function ByteWriter(initialSize) {
    this.buf = new Uint8Array(initialSize || 8192);
    this.len = 0;
  }

  ByteWriter.prototype._ensure = function(extra) {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  };

  ByteWriter.prototype.byte = function(value) {
    this._ensure(1);
    this.buf[this.len++] = value & 0xFF;
  };

  ByteWriter.prototype.bytes = function(arr) {
    this._ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  };

  // GIF integers are little-endian.
  ByteWriter.prototype.short = function(value) {
    this.byte(value & 0xFF);
    this.byte((value >> 8) & 0xFF);
  };

  ByteWriter.prototype.ascii = function(str) {
    for (let i = 0; i < str.length; i++) this.byte(str.charCodeAt(i));
  };

  ByteWriter.prototype.toUint8Array = function() {
    return this.buf.slice(0, this.len);
  };

  // ── Colour quantisation ──
  //
  // Histogram at 6 bits per channel (262144 buckets) keeps median-cut fast while
  // staying well above the 256 colours a GIF can actually hold.

  const HIST_BITS = 6;
  const HIST_SIZE = 1 << (HIST_BITS * 3);
  const HIST_SHIFT = 8 - HIST_BITS;

  function histogramKey(r, g, b) {
    return ((r >> HIST_SHIFT) << (HIST_BITS * 2)) |
           ((g >> HIST_SHIFT) << HIST_BITS) |
           (b >> HIST_SHIFT);
  }

  // Bucket centre, so a bucket maps back to the middle of the range it covers
  // rather than its darkest corner.
  function keyToRgb(key) {
    const half = 1 << (HIST_SHIFT - 1);
    const r = ((key >> (HIST_BITS * 2)) & ((1 << HIST_BITS) - 1)) << HIST_SHIFT;
    const g = ((key >> HIST_BITS) & ((1 << HIST_BITS) - 1)) << HIST_SHIFT;
    const b = (key & ((1 << HIST_BITS) - 1)) << HIST_SHIFT;
    return [Math.min(255, r + half), Math.min(255, g + half), Math.min(255, b + half)];
  }

  function buildHistogram(frames) {
    const counts = new Uint32Array(HIST_SIZE);
    for (const frame of frames) {
      for (let i = 0; i < frame.length; i += 4) {
        counts[histogramKey(frame[i], frame[i + 1], frame[i + 2])]++;
      }
    }
    return counts;
  }

  function makeBox(entries) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, total = 0;
    for (const e of entries) {
      if (e.r < rMin) rMin = e.r;
      if (e.r > rMax) rMax = e.r;
      if (e.g < gMin) gMin = e.g;
      if (e.g > gMax) gMax = e.g;
      if (e.b < bMin) bMin = e.b;
      if (e.b > bMax) bMax = e.b;
      total += e.count;
    }
    const rSpan = rMax - rMin;
    const gSpan = gMax - gMin;
    const bSpan = bMax - bMin;
    return {
      entries,
      total,
      // Weight the split priority by population so busy regions of the image get
      // more palette slots than a large but near-empty colour range.
      priority: Math.max(rSpan, gSpan, bSpan) * total,
      channel: rSpan >= gSpan && rSpan >= bSpan ? 'r' : (gSpan >= bSpan ? 'g' : 'b'),
    };
  }

  function splitBox(box) {
    const channel = box.channel;
    const sorted = box.entries.slice().sort((a, b) => a[channel] - b[channel]);

    // Split at the weighted median so both halves carry similar pixel counts.
    const half = box.total / 2;
    let running = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length; i++) {
      running += sorted[i].count;
      if (running >= half) {
        cut = Math.min(Math.max(i, 1), sorted.length - 1);
        break;
      }
    }

    return [makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut))];
  }

  function averageColour(box) {
    let r = 0, g = 0, b = 0, total = 0;
    for (const e of box.entries) {
      r += e.r * e.count;
      g += e.g * e.count;
      b += e.b * e.count;
      total += e.count;
    }
    if (!total) return [0, 0, 0];
    return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
  }

  function buildPalette(frames, maxColors) {
    const counts = buildHistogram(frames);

    const entries = [];
    for (let key = 0; key < HIST_SIZE; key++) {
      const count = counts[key];
      if (!count) continue;
      const [r, g, b] = keyToRgb(key);
      entries.push({ r, g, b, count });
    }

    if (!entries.length) return [[0, 0, 0]];
    if (entries.length <= maxColors) return entries.map((e) => [e.r, e.g, e.b]);

    let boxes = [makeBox(entries)];
    while (boxes.length < maxColors) {
      let target = -1;
      let best = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].entries.length < 2) continue;
        if (boxes[i].priority > best) {
          best = boxes[i].priority;
          target = i;
        }
      }
      if (target < 0) break;
      const [a, b] = splitBox(boxes[target]);
      boxes.splice(target, 1, a, b);
    }

    return boxes.map(averageColour);
  }

  // ── Palette lookup ──

  function makeMatcher(palette) {
    const size = palette.length;
    const pr = new Int32Array(size);
    const pg = new Int32Array(size);
    const pb = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      pr[i] = palette[i][0];
      pg[i] = palette[i][1];
      pb[i] = palette[i][2];
    }

    // Exact-colour cache. Photographs repeat colours heavily, so this absorbs
    // most of the nearest-neighbour work even with dithering enabled.
    const cache = new Map();

    return function nearest(r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;

      let bestIndex = 0;
      let bestDist = Infinity;
      for (let i = 0; i < size; i++) {
        const dr = r - pr[i];
        const dg = g - pg[i];
        const db = b - pb[i];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
          if (dist === 0) break;
        }
      }

      cache.set(key, bestIndex);
      return bestIndex;
    };
  }

  function clamp255(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
  }

  // Maps one RGBA frame to palette indices. Floyd-Steinberg diffusion keeps
  // gradients on skin tones from banding once they are cut to 256 colours.
  function mapFrame(rgba, width, height, palette, nearest, dither) {
    const out = new Uint8Array(width * height);

    if (!dither) {
      for (let i = 0, p = 0; p < out.length; i += 4, p++) {
        out[p] = nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
      }
      return out;
    }

    // Error carried into the current and next row, 3 channels per pixel.
    let curErr = new Float32Array(width * 3);
    let nextErr = new Float32Array(width * 3);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const e = x * 3;

        const r = clamp255(Math.round(rgba[i] + curErr[e]));
        const g = clamp255(Math.round(rgba[i + 1] + curErr[e + 1]));
        const b = clamp255(Math.round(rgba[i + 2] + curErr[e + 2]));

        const index = nearest(r, g, b);
        out[y * width + x] = index;

        const dr = r - palette[index][0];
        const dg = g - palette[index][1];
        const db = b - palette[index][2];

        // 7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right
        if (x + 1 < width) {
          curErr[e + 3] += dr * 0.4375;
          curErr[e + 4] += dg * 0.4375;
          curErr[e + 5] += db * 0.4375;
        }
        if (x > 0) {
          nextErr[e - 3] += dr * 0.1875;
          nextErr[e - 2] += dg * 0.1875;
          nextErr[e - 1] += db * 0.1875;
        }
        nextErr[e] += dr * 0.3125;
        nextErr[e + 1] += dg * 0.3125;
        nextErr[e + 2] += db * 0.3125;
        if (x + 1 < width) {
          nextErr[e + 3] += dr * 0.0625;
          nextErr[e + 4] += dg * 0.0625;
          nextErr[e + 5] += db * 0.0625;
        }
      }

      const swap = curErr;
      curErr = nextErr;
      nextErr = swap;
      nextErr.fill(0);
    }

    return out;
  }

  // ── LZW ──

  function lzwEncode(indices, minCodeSize, out) {
    const CLEAR = 1 << minCodeSize;
    const END = CLEAR + 1;

    let codeSize = minCodeSize + 1;
    let next = END + 1;
    let dict = new Map();

    let bitBuffer = 0;
    let bitCount = 0;
    const block = new Uint8Array(255);
    let blockLen = 0;

    function flushBlock() {
      if (!blockLen) return;
      out.byte(blockLen);
      out.bytes(block.subarray(0, blockLen));
      blockLen = 0;
    }

    function emitByte(value) {
      block[blockLen++] = value;
      if (blockLen === 255) flushBlock();
    }

    function writeCode(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        emitByte(bitBuffer & 0xFF);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    }

    function resetDict() {
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = END + 1;
    }

    writeCode(CLEAR);

    if (indices.length) {
      let current = indices[0];

      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const combined = (current << 8) | k;
        const existing = dict.get(combined);

        if (existing !== undefined) {
          current = existing;
          continue;
        }

        writeCode(current);
        dict.set(combined, next);
        next++;

        // Widen only once `next` has passed the current width. The decoder's table
        // trails the encoder's by one entry, so `>=` here would switch to wider
        // codes a full code before the decoder starts reading them that way.
        if (next > (1 << codeSize)) {
          if (codeSize < 12) {
            codeSize++;
          } else {
            writeCode(CLEAR);
            resetDict();
          }
        }

        current = k;
      }

      writeCode(current);
    }

    writeCode(END);

    if (bitCount > 0) emitByte(bitBuffer & 0xFF);
    flushBlock();
    out.byte(0); // block terminator
  }

  // ── Assembly ──

  function paddedPaletteSize(count) {
    let size = 2;
    while (size < count) size *= 2;
    return Math.min(256, Math.max(2, size));
  }

  // Bounding box of pixels that differ from the previous frame, or null when the
  // frame is identical to its predecessor.
  function changedBounds(current, previous, width, height) {
    let minX = width, minY = height, maxX = -1, maxY = -1;

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (current[row + x] === previous[row + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0) return null;
    return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  /**
   * Encode RGBA frames into an animated GIF89a.
   *
   * @param {object} options
   * @param {number} options.width
   * @param {number} options.height
   * @param {Array<Uint8ClampedArray|Uint8Array>} options.frames RGBA, width*height*4 each
   * @param {number|number[]} [options.delay] frame delay in hundredths of a second.
   *   An array sets each frame individually, which is how a looping effect holds on
   *   its resting frame between passes instead of running continuously.
   * @param {boolean} [options.loop] loop forever (false plays through once)
   * @param {boolean} [options.dither] Floyd-Steinberg dithering. Diffuses error across
   *   the whole frame, which defeats inter-frame differencing — leave off for animation.
   * @param {boolean} [options.optimise] emit only the changed rectangle per frame
   * @param {number} [options.maxColors]
   * @returns {Uint8Array}
   */
  function encode(options) {
    const width = options.width;
    const height = options.height;
    const frames = options.frames || [];
    const delay = options.delay == null ? 8 : options.delay;
    const delayAt = (index) => {
      const value = Array.isArray(delay) ? delay[index] : delay;
      // GIF stores the delay as an unsigned 16-bit value.
      return Math.max(0, Math.min(65535, Math.round(value == null ? 8 : value)));
    };
    const loop = options.loop === true;
    const dither = options.dither === true;
    const optimise = options.optimise !== false;

    if (!width || !height) throw new Error('gif_dimensions_required');
    if (!frames.length) throw new Error('gif_no_frames');
    for (const frame of frames) {
      if (frame.length !== width * height * 4) throw new Error('gif_frame_size_mismatch');
    }

    // Reserve the last table slot as the transparent index so unchanged pixels can
    // be skipped between frames.
    const maxColors = Math.min(255, options.maxColors || 255);
    const palette = buildPalette(frames, maxColors);
    const nearest = makeMatcher(palette);
    const transparentIndex = palette.length;
    const tableSize = paddedPaletteSize(palette.length + 1);

    const out = new ByteWriter(64 * 1024);

    // Header + logical screen descriptor
    out.ascii('GIF89a');
    out.short(width);
    out.short(height);
    // Global colour table present, 8-bit colour resolution, table size exponent
    out.byte(0x80 | 0x70 | (Math.log2(tableSize) - 1));
    out.byte(0); // background colour index
    out.byte(0); // pixel aspect ratio

    for (let i = 0; i < tableSize; i++) {
      const colour = palette[i] || [0, 0, 0];
      out.byte(colour[0]);
      out.byte(colour[1]);
      out.byte(colour[2]);
    }

    // Only emit the Netscape looping block when looping is wanted. Omitting it is
    // the most reliable way to get a single play across clients.
    if (loop) {
      out.byte(0x21);
      out.byte(0xFF);
      out.byte(0x0B);
      out.ascii('NETSCAPE2.0');
      out.byte(0x03);
      out.byte(0x01);
      out.short(0); // 0 = repeat forever
      out.byte(0);
    }

    let previous = null;

    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      const frame = frames[frameIndex];
      const indices = mapFrame(frame, width, height, palette, nearest, dither);

      // Work out which rectangle actually changed.
      let left = 0;
      let top = 0;
      let frameWidth = width;
      let frameHeight = height;
      let useTransparency = false;

      if (previous && optimise) {
        const bounds = changedBounds(indices, previous, width, height);
        if (bounds) {
          left = bounds.minX;
          top = bounds.minY;
          frameWidth = bounds.width;
          frameHeight = bounds.height;
        } else {
          // Nothing moved. Emit a 1x1 transparent pixel purely to hold the delay.
          left = 0;
          top = 0;
          frameWidth = 1;
          frameHeight = 1;
        }
        useTransparency = true;
      }

      // Graphic control extension. Disposal 1 leaves the previous frame in place so
      // transparent pixels reveal it rather than the background.
      out.byte(0x21);
      out.byte(0xF9);
      out.byte(0x04);
      out.byte(useTransparency ? 0x05 : 0x04);
      out.short(delayAt(frameIndex));
      out.byte(useTransparency ? transparentIndex : 0);
      out.byte(0);

      // Image descriptor
      out.byte(0x2C);
      out.short(left);
      out.short(top);
      out.short(frameWidth);
      out.short(frameHeight);
      out.byte(0); // no local colour table, not interlaced

      // Build the sub-rectangle, marking pixels equal to the previous frame transparent.
      let payload;
      if (!previous || !optimise) {
        payload = indices;
      } else {
        payload = new Uint8Array(frameWidth * frameHeight);
        for (let y = 0; y < frameHeight; y++) {
          const srcRow = (top + y) * width + left;
          const dstRow = y * frameWidth;
          for (let x = 0; x < frameWidth; x++) {
            const value = indices[srcRow + x];
            payload[dstRow + x] = value === previous[srcRow + x] ? transparentIndex : value;
          }
        }
      }

      out.byte(8); // LZW minimum code size
      lzwEncode(payload, 8, out);

      previous = indices;
    }

    out.byte(0x3B); // trailer

    return out.toUint8Array();
  }

  return Object.freeze({
    encode,
    // Exposed for tests
    _buildPalette: buildPalette,
    _lzwEncode: lzwEncode,
    _ByteWriter: ByteWriter,
  });
});
