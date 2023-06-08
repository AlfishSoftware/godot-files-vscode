// Override TypeScript definitions to disallow arbitrary Node.js
declare var process: object | undefined;
declare class Buffer {
  static from(data: Uint8Array | ReadonlyArray<number> | string): Buffer;
  static from(str: string, encoding?: BufferEncoding): Buffer;
  toString(encoding?: BufferEncoding): string;
}
declare type BufferEncoding = 'utf8' | 'utf16le' | 'latin1' | 'base64' | 'base64url' | 'hex';

declare module 'fs' {
  export function rmSync(path: string, options?: object): void
}
declare function require(module: 'fs'): typeof import('fs');

declare module 'crypto' {
  function createHash(algorithm: string, options?: object): Hash;
  type BinaryToTextEncoding = 'base64' | 'base64url' | 'hex';
  class Hash {
    update(data: string, inputEncoding?: BufferEncoding): Hash;
    digest(): Buffer;
    digest(encoding: BinaryToTextEncoding): string;
  }
}
declare function require(module: 'crypto'): typeof import('crypto');
