import { defineConfig } from 'vitest/config';

// Explicit values keep tests independent of any local .env file.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    env: {
      VITEST: '1', MONGODB_DB_NAME: 'advanced_rag_test',
      LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', LLM_API_KEY: '', LLM_BASE_URL: '', LLM_ANSWER_MODEL: '', LLM_VISION_MODEL: '',
      EMBEDDING_PROVIDER: 'gemini', EMBEDDING_MODEL: '', EMBEDDING_DIMENSIONS: '768', EMBEDDING_BATCH_SIZE: '32',
    },
  },
});
