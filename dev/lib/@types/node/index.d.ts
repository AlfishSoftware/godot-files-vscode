// Override TypeScript definitions to disallow arbitrary Node.js
declare class Buffer {
  static from(data: Uint8Array): Buffer;
  toString(encoding: string): string;
}
