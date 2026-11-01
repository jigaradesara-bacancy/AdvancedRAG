import { EvalRun } from '../models/index.js';
import { loadCases, runEvaluation } from '../services/evaluation/evaluation.service.js';

export async function cases(req, res) {
  res.json(await loadCases());
}
export async function runs(req, res) {
  res.json(await EvalRun.find({}).sort('-createdAt').limit(20).lean());
}
export async function run(req, res) {
  res.json(await runEvaluation({ caseIds: req.body?.caseIds }));
}
