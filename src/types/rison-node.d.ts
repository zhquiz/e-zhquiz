declare module 'rison-node' {
  export function encode(o: any): string
  export function decode<T = any>(s: string): T
}
