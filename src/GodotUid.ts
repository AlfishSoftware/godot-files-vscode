// Godot ResourceUID Helper

const toUTF8 = new TextDecoder();

/** Convert a uid path string to its numeric representation.
 * @param uidPath A ResourceUID path like `uid://1a2b3c4d5e6f7`
 * @returns The uint64 numeric ResourceUID as a bigint.
 */
export function uidPathToNum(uidPath: string): bigint {
  // const nLetters = 25; // 'z'.charCodeAt(0) - 'a'.charCodeAt(0); // 'z' is never used
  // const base = 34n; // nLetters + '9'.charCodeAt(0) - '0'.charCodeAt(0); // '9' is never used
  if (!uidPath.startsWith('uid://')) return -1n; // invalid id
  let uid = 0n;
  const n = uidPath.length;
  for (let i = 6; i < n; i++) {
    uid = BigInt.asUintN(64, uid * 34n); // uid *= base;
    const c = uidPath.charCodeAt(i);
    if (c >= 97 && c <= 122) // isAsciiLowerCase: c >= 'a'.charCodeAt(0) && c <= 'z'.charCodeAt(0);
      uid = BigInt.asUintN(64, uid + BigInt(c - 97)); // uid += c - 'a'.charCodeAt(0);
    else if (c >= 48 && c <= 57) // isDigit: c >= '0'.charCodeAt(0) && c <= '9'.charCodeAt(0);
      uid = BigInt.asUintN(64, uid + BigInt(c - 23)); // uid += c - '0'.charCodeAt(0) + nLetters;
    else return -1n; // invalid id: "uid://<invalid>", etc
  }
  return uid & 0x7FFFFFFFFFFFFFFFn;
}

/** Parse the binary uid cache data into a map.
 * @param buffer The binary data of the `uid_cache.bin` file.
 * @returns Entries mapping each numerical uid to the res path string.
 */
export function parseBinaryUidCache(buffer: ArrayBufferLike) {
  const map = new Map<bigint, string>();
  const data = new DataView(buffer);
  let entries = data.getUint32(0, true), i = 4;
  while (entries-- > 0) {
    const key = data.getBigUint64(i, true); i += 8;
    const stringBytes = data.getUint32(i, true); i += 4;
    const value = toUTF8.decode(new DataView(buffer, i, stringBytes)); i += stringBytes;
    map.set(key, value);
  }
  return map;
}
