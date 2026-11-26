// The chat translations players liked least, and their suggestions:
//   node scripts/tr-report.mjs [how many] [file]
// (on the VM: cd ~/ludo-activity && node scripts/tr-report.mjs)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TranslationFeedback } from '../server/tr-feedback.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const n = Number(process.argv[2]) || 20;
const file = process.argv[3] || path.join(here, '..', 'data', 'translation-feedback.json');
const fb = new TranslationFeedback(file);
const rows = fb.worst(n);
if (!rows.length) console.log('No 👎 yet.');
for (const r of rows) {
  console.log(`\n${r.from || '?'} → ${r.to}  👍 ${r.up}  👎 ${r.down}${r.approved ? '  ✅ players: ' + r.approved : ''}`);
  console.log(`  message:  ${r.text}`);
  console.log(`  shown:    ${r.shown}`);
  for (const s of r.suggestions) console.log(`  suggested: ${s}`);
}
