import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 8000 });
  logger.info({ db: env.MONGODB_DB_NAME }, 'mongodb connected');
}
