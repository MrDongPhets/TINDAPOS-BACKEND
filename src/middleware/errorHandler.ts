import { Request, Response, NextFunction } from 'express';

function errorHandler(error: Error & { status?: number; code?: string }, req: Request, res: Response, next: NextFunction): void {
  console.error('Unhandled error:', error.message);

  if (error.message.includes('CORS')) {
    res.status(403).json({
      error: 'CORS policy violation',
      code: 'CORS_ERROR'
    });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
    code: 'UNHANDLED_ERROR',
    ...(process.env.NODE_ENV !== 'production' && { details: error.message })
  });
}

export { errorHandler };
