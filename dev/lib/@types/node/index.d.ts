// Override TypeScript definitions to disallow arbitrary Node.js
declare class Buffer {
  static from(data: Uint8Array): Buffer;
  toString(encoding?: BufferEncoding): string;
}
declare type BufferEncoding = 'utf8' | 'utf16le' | 'latin1' | 'base64' | 'base64url' | 'hex';
declare module 'fs' {
  export function rmSync(path: string, options?: object): void
}
declare function require(module: 'fs'): typeof import('fs');
