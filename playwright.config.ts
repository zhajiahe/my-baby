import {defineConfig,devices} from '@playwright/test';
import {readFileSync,mkdirSync,chmodSync} from 'node:fs';
const target=JSON.parse(readFileSync('.migration/target.json','utf8'));
if(new URL(target.origin).hostname.split('.')[0]!=='mybaby-web-migration-test')throw new Error('e2e_isolated_origin_required');
mkdirSync('.migration/e2e',{recursive:true,mode:0o700});chmodSync('.migration/e2e',0o700);
const runId=process.env.MYBABY_E2E_RUN_ID ||= new Date().toISOString().replace(/[:.]/g,'-');
export default defineConfig({testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:60000,
 expect:{timeout:15000}, // explicit UI readiness budget; does not retry failed cases
 outputDir:`.migration/e2e/artifacts-${runId}`,reporter:[['./tests/e2e/audit-reporter.ts']],
 use:{baseURL:target.origin,trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:15000},
 projects:[{name:'chromium-desktop',use:{...devices['Desktop Chrome'],channel:process.env.MYBABY_E2E_CHROMIUM_BUNDLED==='true'?undefined:'chrome'}},
 {name:'chromium-iphone-layout',use:{...devices['iPhone 13'],browserName:'chromium',channel:process.env.MYBABY_E2E_CHROMIUM_BUNDLED==='true'?undefined:'chrome'}},
 ...(process.env.MYBABY_E2E_WEBKIT==='true'?[{name:'webkit-iphone-simulation',use:{...devices['iPhone 13'],browserName:'webkit' as const}}]:[])],
});
