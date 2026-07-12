import express, { Request, Response } from 'express';
import { testDatabaseConnection } from '../config/database';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();

  // Always build a complete response — never return a bare { status: 'error' }
  const healthData: Record<string, unknown> = {
    status: 'degraded',
    database: 'unknown',
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 3001,
    response_time_ms: 0,
    auth: {
      jwt_configured: !!process.env.JWT_SECRET,
      endpoints_active: true,
    },
    cors: {
      enabled: true,
      origins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    },
  };

  try {
    const testResult = await testDatabaseConnection();

    if (testResult.success) {
      healthData.status = 'healthy';
      healthData.database = 'connected';
      healthData.company_count = testResult.count ?? 0;
    } else {
      healthData.status = 'degraded';
      healthData.database = 'disconnected';
      healthData.error = testResult.error;
    }
  } catch {
    healthData.status = 'degraded';
    healthData.database = 'not_initialized';
  }

  healthData.response_time_ms = Date.now() - startTime;
  res.status(200).json(healthData);
});

export default router;
