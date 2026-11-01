import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { uploadPdf } from '../middleware/upload.js';
import * as docs from '../controllers/documents.controller.js';
import * as chat from '../controllers/chat.controller.js';
import * as evaluation from '../controllers/evaluation.controller.js';

const expensive = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const router = Router();

router.get('/health', (req, res) => res.json({ ok: true }));
router.get('/stats', docs.stats);

router.post('/documents/upload', expensive, uploadPdf, docs.upload);
router.post('/documents/scan', docs.scan);
router.get('/documents', docs.list);
router.get('/documents/:id', docs.get);
router.delete('/documents/:id', docs.remove);
router.post('/documents/:id/process', docs.reprocess);
router.get('/documents/:id/status', docs.status);
router.get('/documents/:id/extraction', docs.extraction);
router.get('/documents/:id/chunks', docs.chunks);
router.get('/documents/:id/structure', docs.structure);
router.get('/documents/:id/visual-elements', docs.visualElements);
router.get('/documents/:id/pages/:n/image', docs.pageImage);
router.get('/documents/:id/file', docs.file);

router.post('/chat', expensive, chat.chat);
router.post('/chat/stream', expensive, chat.chatStream);
router.get('/chat/history', chat.history);
router.delete('/chat/history/:id', chat.clearConversation);
router.get('/sources/:id', chat.source);

router.get('/evaluation/cases', evaluation.cases);
router.get('/evaluation/runs', evaluation.runs);
router.post('/evaluation/run', expensive, evaluation.run);

export default router;
