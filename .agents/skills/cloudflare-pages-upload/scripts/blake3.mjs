// Unkeyed, 32-byte BLAKE3 for Pages asset keys; no dependencies.
// Algorithm: https://github.com/BLAKE3-team/BLAKE3/tree/master/reference_impl
// Tested against the upstream test_vectors/test_vectors.json.
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function mix(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) >>> 0;
  v[d] = rotr(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr(v[b] ^ v[c], 12);
  v[a] = (v[a] + v[b] + y) >>> 0;
  v[d] = rotr(v[d] ^ v[a], 8);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr(v[b] ^ v[c], 7);
}

function compress(cv, words, counter, length, flags) {
  const v = [...cv, ...IV.slice(0, 4), counter >>> 0,
    Math.floor(counter / 0x100000000) >>> 0, length, flags];
  let m = [...words];
  for (let r = 0; r < 7; r++) {
    mix(v, 0, 4, 8, 12, m[0], m[1]);
    mix(v, 1, 5, 9, 13, m[2], m[3]);
    mix(v, 2, 6, 10, 14, m[4], m[5]);
    mix(v, 3, 7, 11, 15, m[6], m[7]);
    mix(v, 0, 5, 10, 15, m[8], m[9]);
    mix(v, 1, 6, 11, 12, m[10], m[11]);
    mix(v, 2, 7, 8, 13, m[12], m[13]);
    mix(v, 3, 4, 9, 14, m[14], m[15]);
    m = PERM.map((i) => m[i]);
  }
  return v.map((word, i) => (word ^ (i < 8 ? v[i + 8] : cv[i - 8])) >>> 0);
}

const chain = (o) => compress(o.cv, o.words, o.counter, o.length, o.flags).slice(0, 8);

function chunkOutput(bytes, counter) {
  let cv = IV;
  const blocks = Math.max(1, Math.ceil(bytes.length / 64));
  for (let block = 0; block < blocks; block++) {
    const part = bytes.subarray(block * 64, (block + 1) * 64);
    const padded = Buffer.alloc(64);
    part.copy(padded);
    const words = Array.from({ length: 16 }, (_, i) => padded.readUInt32LE(i * 4));
    const last = block === blocks - 1;
    const output = { cv, words, counter, length: part.length,
      flags: (block === 0 ? 1 : 0) | (last ? 2 : 0) };
    if (last) return output;
    cv = chain(output);
  }
}

export function blake3(input) {
  const bytes = Buffer.from(input);
  const count = Math.max(1, Math.ceil(bytes.length / 1024));
  function tree(start, chunks) {
    if (chunks === 1) return chunkOutput(bytes.subarray(start * 1024, (start + 1) * 1024), start);
    let leftCount = 1;
    while (leftCount * 2 < chunks) leftCount *= 2;
    return { cv: IV, words: [...chain(tree(start, leftCount)),
      ...chain(tree(start + leftCount, chunks - leftCount))],
      counter: 0, length: 64, flags: 4 };
  }
  const root = tree(0, count);
  const words = compress(root.cv, root.words, 0, root.length, root.flags | 8);
  const result = Buffer.alloc(32);
  words.slice(0, 8).forEach((word, i) => result.writeUInt32LE(word, i * 4));
  return result;
}

export function assetKey(bytes) {
  // Cloudflare hashFile(): BLAKE3(base64(contents) + extension), first 32 hex digits.
  return blake3(Buffer.from(bytes.toString('base64') + 'html')).toString('hex').slice(0, 32);
}
