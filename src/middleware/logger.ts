import { Request, Response, NextFunction } from 'express';

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);

  if (req.body && Object.keys(req.body).length > 0) {
    const logBody: Record<string, unknown> = { ...req.body };
    if (logBody.password) logBody.password = '***';
    console.log('   Body:', JSON.stringify(logBody));
  }

  next();
}

export { requestLogger };
