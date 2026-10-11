import { defineConfig } from 'vite';
import vinext from 'vinext';
import { cloudflare } from '@cloudflare/vite-plugin';
import { prepareMediaRuntime } from './scripts/prepare-media-runtime';
prepareMediaRuntime();
export default defineConfig({ plugins:[vinext(),cloudflare({types:{includeRuntime:false},
 viteEnvironment:{name:'rsc',childEnvironments:['ssr']}})] });
