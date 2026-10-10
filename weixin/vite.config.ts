import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

// Runtime types are supplied by @cloudflare/workers-types. Avoid spawning
// workerd merely to generate types on hosts below its supported macOS version.
export default defineConfig({ plugins: [cloudflare({ types: { includeRuntime: false } })] });
