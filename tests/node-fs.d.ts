// Minimal typing for the one Node API the tests use; the project does not depend on @types/node.
declare module 'node:fs' {
  interface FileBuffer extends Uint8Array {
    readonly buffer: ArrayBuffer;
  }
  export function readFileSync(path: string): FileBuffer;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
