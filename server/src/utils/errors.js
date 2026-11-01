export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(msg, 400, 'BAD_REQUEST', details);
export const notFound = (msg) => new AppError(msg, 404, 'NOT_FOUND');
export const conflict = (msg) => new AppError(msg, 409, 'CONFLICT');
