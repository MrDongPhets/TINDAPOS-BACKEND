// server.ts - SECURED VERSION
import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './src/config/swagger';
import { initializeDatabase } from './src/config/database';
import { connectRedis } from './src/config/redis';
import { configureCORS } from './src/config/cors';
import { requestLogger } from './src/middleware/logger';
import { errorHandler } from './src/middleware/errorHandler';
import routes from './src/routes/index';
import { ensureDemoData } from './src/services/demoDataService';
import uploadRoutes from './src/routes/client/upload';

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Middleware
app.use(configureCORS());

// Capture raw body for PayMongo webhook signature verification
app.use((req: Request, res: Response, next) => {
  if (req.path === '/billing/webhook') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      (req as any).rawBody = raw;
      try { (req as any).body = JSON.parse(raw); } catch { (req as any).body = {}; }
      next();
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);
app.use('/api/client/upload', uploadRoutes);

// Serve locally uploaded files (SQLite offline mode)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ============================================
// SWAGGER API DOCUMENTATION (Development Only)
// ============================================
if (!isProduction) {
  // Swagger available at /api-docs in development
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec as object, {
    customSiteTitle: 'KitaPOS API Documentation - DEVELOPMENT',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .information-container { margin: 20px 0 }
      .swagger-ui .scheme-container { margin: 20px 0; background: #fafafa; padding: 10px; }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      docExpansion: 'none',
      defaultModelsExpandDepth: 3,
      defaultModelExpandDepth: 3,
      displayOperationId: false,
      syntaxHighlight: {
        activate: true,
        theme: 'monokai'
      }
    }
  }));

  // Swagger JSON endpoint (development only)
  app.get('/api-docs.json', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log('📚 Swagger docs enabled at /api-docs (DEVELOPMENT MODE)');
} else {
  // Block Swagger in production
  app.use('/api-docs', (req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.get('/api-docs.json', (req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });
  console.log('🔒 Swagger disabled (PRODUCTION MODE)');
}

// Desktop mode: serve React frontend static files
// FRONTEND_PATH is set by Electron when launching the backend
if (process.env.FRONTEND_PATH) {
  const frontendPath = process.env.FRONTEND_PATH;
  console.log('🖥️ Desktop mode: serving frontend from', frontendPath);
  app.use(express.static(frontendPath));
  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  // Root endpoint - Simple API info (no sensitive data)
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'KitaPOS API',
      version: '2.2.0',
      status: 'active',
      timestamp: new Date().toISOString(),
      documentation: isProduction ? 'Available in development mode only' : '/api-docs'
    });
  });
}

// Add diagnostic route (only in development or with special header)
app.get('/diagnostic', async (req: Request, res: Response) => {
  if (!isProduction || req.headers['x-diagnostic-key'] === process.env.DIAGNOSTIC_KEY) {
    const { default: diagnostic } = await import('./src/routes/diagnostic');
    return diagnostic(req, res, () => {});
  }
  res.status(404).json({ error: 'Not found' });
});

// Health check endpoint (used by frontend to detect real connectivity)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// Mount all routes
app.use('/', routes);

// Error Handler
app.use(errorHandler);

// Desktop SPA fallback: serve index.html for all unmatched routes
if (process.env.FRONTEND_PATH) {
  const frontendPath = process.env.FRONTEND_PATH;
  app.use('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// 404 Handler (non-desktop mode only)
app.use('*', (req: Request, res: Response) => {
  const response: Record<string, unknown> = {
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    method: req.method
  };

  // Only show available endpoints in development
  if (!isProduction) {
    response.documentation = '/api-docs';
    response.availableEndpoints = {
      documentation: 'GET /api-docs',
      health: 'GET /health',
      auth: [
        'POST /auth/login',
        'POST /auth/super-admin/login',
        'POST /auth/register-company',
        'GET /auth/verify',
        'POST /auth/logout'
      ],
      admin: [
        'GET /admin/companies',
        'GET /admin/users',
        'GET /admin/stats/users',
        'GET /admin/stats/subscriptions'
      ],
      client: [
        'GET /client/dashboard/*',
        'GET /client/products',
        'GET /client/categories',
        'GET /client/stores'
      ],
      reports: [
        'GET /reports/sales',
        'GET /reports/inventory',
        'GET /reports/financial'
      ]
    };
  }

  res.status(404).json(response);
});

// Initialize and Start Server
async function startServer(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       🚀 KitaPOS Backend API Server               ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`🔍 Environment:  ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Port:         ${PORT}`);

  // Initialize Redis Cache
  await connectRedis();

  // Initialize Database
  const dbInitialized = await initializeDatabase();

  if (dbInitialized) {
    console.log('✅ Database initialized successfully');
    // Ensure demo data exists
    await ensureDemoData();
    console.log('✅ Demo data verified');
  } else {
    console.error('❌ Failed to initialize database. Server running in degraded mode.');
  }

  const server = app.listen(PORT, () => {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${PORT}`;

    console.log('');
    console.log('════════════════════════════════════════════════════');
    console.log('✅ Server is running and ready!');
    console.log('════════════════════════════════════════════════════');
    console.log(`📱 API Base:     ${baseUrl}`);
    console.log(`🔍 Health:       ${baseUrl}/health`);

    // Only show documentation URL in development
    if (!isProduction) {
      console.log(`📚 API Docs:     ${baseUrl}/api-docs`);
      console.log(`📄 OpenAPI:      ${baseUrl}/api-docs.json`);
      console.log('');
      console.log('📋 Quick Access Endpoints:');
      console.log('   Authentication:  POST /auth/login');
      console.log('   Super Admin:     POST /auth/super-admin/login');
      console.log('   Companies:       GET  /admin/companies');
      console.log('   Products:        GET  /client/products');
      console.log('   Sales Reports:   GET  /reports/sales');
      console.log('');
      console.log('🔐 Demo Credentials:');
      console.log('   Client:      manager@demobakery.com / password123');
      console.log('   Super Admin: admin@system.com / superadmin123');
    } else {
      console.log('🔒 API Documentation: Disabled in production');
      console.log('🔒 Demo Credentials: Hidden in production');
    }

    console.log('════════════════════════════════════════════════════');
  });

  process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('✅ Process terminated');
    });
  });
}

startServer();

export default app;
