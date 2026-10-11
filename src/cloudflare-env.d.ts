declare const FixedLengthStream: {new(length:number):{readable:ReadableStream<Uint8Array>;writable:WritableStream<Uint8Array>}};
declare module 'cloudflare:workers' {
 export const env: Record<string, unknown>;
}
