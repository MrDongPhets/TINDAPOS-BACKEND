// Write the synthetic EIS test set (src/services/eis/eisTestCases.ts) to files + a browser viewer.
//
//   npx ts-node scripts/eis-test-invoices.ts [outDir]     (default: ../eis-spec/output)
//
// valid/    → should be ACCEPTED by the EIS system under test
// invalid/  → should be REJECTED (expected error noted in manifest.json)
// The same set is served by GET /eis-test/samples. Never transmit to BIR production — Tindapo is not EIS-certified.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildTestSet } from '../src/services/eis/eisTestCases';

const OUT = resolve(process.argv[2] || join(__dirname, '..', '..', 'eis-spec', 'output'));
const { manifest, files } = buildTestSet();

rmSync(OUT, { recursive: true, force: true });
for (const [name, data] of Object.entries(files)) {
  mkdirSync(dirname(join(OUT, name)), { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Self-contained browser viewer (data embedded — opening JSON via file:// fetch is blocked by browsers)
const template = readFileSync(join(__dirname, 'eis-viewer.html'), 'utf8');
const payload = JSON.stringify({ manifest, files }).replace(/</g, '\\u003c');
writeFileSync(join(OUT, 'viewer.html'), template.replace('/*__EIS_DATA__*/null', payload));

console.log(`✅ ${manifest.cases.length} test cases → ${OUT}`);
console.log(`🌐 Open in a browser: ${join(OUT, 'viewer.html')}`);
