// src/routes/diagnostic.ts - Add this file to help diagnose the issue
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

router.get('/', (req: Request, res: Response) => {
  const diagnosticInfo: Record<string, unknown> = {
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      PORT: process.env.PORT || 3001,
      VERCEL: process.env.VERCEL || false,
      VERCEL_URL: process.env.VERCEL_URL || 'not set',
    },
    routes: {
      auth: {
        available: false,
        endpoints: []
      },
      admin: {
        available: false,
        endpoints: []
      },
      health: {
        available: false
      }
    },
    files: {
      controllers: {} as Record<string, unknown>,
      routes: {} as Record<string, unknown>,
      middleware: {} as Record<string, unknown>
    },
    database: {
      supabase_configured: !!process.env.SUPABASE_URL,
      jwt_configured: !!process.env.JWT_SECRET
    }
  };

  // Check if route files exist
  try {
    // Check auth routes
    const authPath = path.join(__dirname, 'auth');
    if (fs.existsSync(authPath)) {
      (diagnosticInfo.routes as Record<string, unknown>).auth = { available: true, endpoints: [] };
      const authFiles = fs.readdirSync(authPath);
      (diagnosticInfo.files as Record<string, unknown>).routes = { auth: authFiles };
    }

    // Check admin routes
    const adminPath = path.join(__dirname, 'admin');
    if (fs.existsSync(adminPath)) {
      (diagnosticInfo.routes as Record<string, unknown>).admin = { available: true, endpoints: [] };
      const adminFiles = fs.readdirSync(adminPath);
      const routes = (diagnosticInfo.files as Record<string, Record<string, unknown>>).routes;
      routes.admin = adminFiles;
    }

    // Check controllers
    const controllersPath = path.join(__dirname, '../controllers');
    if (fs.existsSync(controllersPath)) {
      const authControllersPath = path.join(controllersPath, 'auth');
      const adminControllersPath = path.join(controllersPath, 'admin');
      const files = diagnosticInfo.files as Record<string, Record<string, unknown>>;

      if (fs.existsSync(authControllersPath)) {
        files.controllers.auth = fs.readdirSync(authControllersPath);
      }
      if (fs.existsSync(adminControllersPath)) {
        files.controllers.admin = fs.readdirSync(adminControllersPath);
      }
    }

    // Check middleware
    const middlewarePath = path.join(__dirname, '../middleware');
    if (fs.existsSync(middlewarePath)) {
      (diagnosticInfo.files as Record<string, unknown>).middleware = fs.readdirSync(middlewarePath);
    }
  } catch (error) {
    const err = error as Error;
    diagnosticInfo.fileSystemError = err.message;
  }

  // List all registered routes
  try {
    const app = req.app;
    const routes: { path: string; methods: string[] }[] = [];

    (app as unknown as { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> }; name?: string; regexp?: { source: string }; handle?: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } }> } })._router.stack.forEach(middleware => {
      if (middleware.route) {
        routes.push({
          path: middleware.route.path,
          methods: Object.keys(middleware.route.methods)
        });
      } else if (middleware.name === 'router' && middleware.handle) {
        middleware.handle.stack.forEach(handler => {
          if (handler.route) {
            const routePath = middleware.regexp?.source.includes('auth') ? '/auth' :
                       middleware.regexp?.source.includes('admin') ? '/admin' :
                       middleware.regexp?.source.includes('health') ? '/health' : '';
            routes.push({
              path: routePath + handler.route.path,
              methods: Object.keys(handler.route.methods)
            });
          }
        });
      }
    });

    diagnosticInfo.registeredRoutes = routes;
  } catch (error) {
    const err = error as Error;
    diagnosticInfo.routeListError = err.message;
  }

  res.json(diagnosticInfo);
});

export default router;
