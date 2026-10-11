import { admin, saveLocal } from './local.js';
import { observationReport, observeArgs } from '../src/readiness.js';

async function main() {
  // Parse before reading credentials or issuing requests. No mutation actions.
  const options = observeArgs(process.argv.slice(2));
  const report = observationReport(await admin('status'), Date.now(), options.hours);
  if (options.save) await saveLocal(`observation-${options.hours}-latest.json`, report);
  console.log(JSON.stringify(report, null, 2));
  if (report.phase === 'attention') process.exitCode = 2;
}
main().catch(error => {
  // Never echo URLs, raw responses, credential-file contents or fetch errors.
  const reason = error instanceof Error && /^admin_http_\d{3}$/.test(error.message) ? error.message
    : error instanceof Error && error.message === 'usage_observe_hours_24_or_72_optional_save' ? 'invalid_arguments'
      : 'status_read_or_report_failed';
  console.error(JSON.stringify({ phase: 'unavailable', reason, acceptance: 'not_automatically_verified' }));
  process.exitCode = 1;
});
