// Override TypeScript definitions to disallow arbitrary Node.js
declare class Buffer {
  static from(data: Uint8Array): Buffer;
  toString(encoding: string): string;
}
declare module 'fs' {
  export function rmSync(path: string, options?: object): void
}
declare function require(module: 'fs'): typeof import('fs');
