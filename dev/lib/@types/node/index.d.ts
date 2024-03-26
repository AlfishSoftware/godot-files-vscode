// Override TypeScript definitions to disallow arbitrary Node.js
declare const process: undefined | {
  readonly platform
  : 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';
  env: { [key: string]: string | undefined; };
};
declare class Buffer {
  static from(data: Uint8Array | ReadonlyArray<number> | string): Buffer;
  static from(str: string, encoding?: BufferEncoding): Buffer;
  toString(encoding?: BufferEncoding): string;
}
declare type BufferEncoding = 'utf8' | 'utf16le' | 'latin1' | 'base64' | 'base64url' | 'hex';

declare module 'os' {
  function homedir(): string;
}
declare function require(module: 'os'): typeof import('os');

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

declare namespace NodeJS {
  type Signals
    = 'SIGABRT' | 'SIGALRM' | 'SIGBUS' | 'SIGCHLD' | 'SIGCONT' | 'SIGFPE' | 'SIGHUP' | 'SIGILL' | 'SIGINT'
    | 'SIGIO' | 'SIGIOT' | 'SIGKILL' | 'SIGPIPE' | 'SIGPOLL' | 'SIGPROF' | 'SIGPWR' | 'SIGQUIT' | 'SIGSEGV'
    | 'SIGSTKFLT' | 'SIGSTOP' | 'SIGSYS' | 'SIGTERM' | 'SIGTRAP' | 'SIGTSTP' | 'SIGTTIN' | 'SIGTTOU' | 'SIGUNUSED'
    | 'SIGURG' | 'SIGUSR1' | 'SIGUSR2' | 'SIGVTALRM' | 'SIGWINCH' | 'SIGXCPU' | 'SIGXFSZ' | 'SIGBREAK' | 'SIGLOST'
    | 'SIGINFO'
    ;
}
declare module 'child_process' {
  class ChildProcess {
    readonly pid?: number;
    readonly exitCode: number | null;
    readonly signalCode: string | null;
    kill(signal?: NodeJS.Signals | number): boolean;
  }
  interface PromiseWithChild<T> extends Promise<T> { child: ChildProcess; }
  function execFile(file: string, args?: ReadonlyArray<string>,
    options?: { cwd?: string, env?: object, timeout?: number; },
  ): ChildProcess;
  function execFile(file: string): object;
  namespace execFile {
    function __promisify__(file: string, args?: ReadonlyArray<string>,
      options?: { cwd?: string, env?: object, timeout?: number; },
    ): PromiseWithChild<{ stdout: string; stderr: string; }>;
  }
}
declare function require(module: 'child_process'): typeof import('child_process');

declare module 'util' {
  export namespace promisify { const custom: unique symbol; }
  export interface CustomPromisify<TCustom extends Function> extends Function { __promisify__: TCustom; }
  export function promisify<TCustom extends Function>(fn: CustomPromisify<TCustom>): TCustom;
}
declare function require(module: 'util'): typeof import('util');
