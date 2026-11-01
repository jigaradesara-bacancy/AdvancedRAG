import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { runEvaluation } from '../services/evaluation/evaluation.service.js';

await connectDatabase();
const run = await runEvaluation({ caseIds: process.argv.slice(2) });
console.log('Summary:', JSON.stringify(run.summary, null, 2));
for (const r of run.results) {
  const status = r.error ? `ERROR ${r.error}` : r.skipped ? `SKIPPED ${r.skipped}` : r.unscored ? 'UNSCORED (no expectations configured)' : 'scored';
  console.log(`\n[${r.id}] ${status}\n  Q: ${r.question}`);
  if (r.answer) console.log(`  A: ${r.answer.replace(/\s+/g, ' ').slice(0, 300)}`);
}
await mongoose.disconnect();
