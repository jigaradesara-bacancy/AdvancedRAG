import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { Chunk } from './models/index.js';
import { ensureVectorIndex } from './services/vectorStore.service.js';
import { recoverInterrupted } from './services/ingestion/jobRunner.js';
import { scanDocumentsDirectory } from './services/document.service.js';

await connectDatabase();
await Chunk.init();
await ensureVectorIndex();
await scanDocumentsDirectory().then((r) => logger.info(r, 'documents directory scanned'));
await recoverInterrupted();

createApp().listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
