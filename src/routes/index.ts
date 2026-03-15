// src/routes/index.ts - Updated with Reports
import express, { Request, Response } from 'express';
import { API_VERSION, DEMO_CREDENTIALS } from '../config/constants';

import authRoutes from './auth/index';
import adminRoutes from './admin/index';
import healthRoute from './health';
import clientRoutes from './client/index';
import posRoutes from './pos/index';
import staffRoutes from './staff/index';
import reportsRoutes from './reports/index';
import setupRoutes from './setup';

const router = express.Router();

// Root endpoint
router.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'POS System API - Modular Version',
    status: 'active',
    timestamp: new Date().toISOString(),
    version: API_VERSION,
    environment: process.env.NODE_ENV || 'production',
    endpoints: {
      health: 'GET /health',
      auth: {
        login: 'POST /auth/login',
        superAdminLogin: 'POST /auth/super-admin/login',
        verify: 'GET /auth/verify',
        registerCompany: 'POST /auth/register-company',
        logout: 'POST /auth/logout'
      },
      admin: {
        companies: 'GET /admin/companies',
        users: 'GET /admin/users',
        userStats: 'GET /admin/stats/users',
        subscriptionStats: 'GET /admin/stats/subscriptions'
      },
      client: {
        dashboard: 'GET /client/dashboard/*',
        products: 'GET /client/products',
        categories: 'GET /client/categories',
        stores: 'GET /client/stores'
      },
      pos: {
        products: 'GET /pos/products/category',
        search: 'GET /pos/products/search',
        sales: 'POST /pos/sales',
        todaySales: 'GET /pos/sales/today'
      },
      staff: {
        login: 'POST /staff/auth/login',
        verify: 'GET /staff/auth/verify'
      },
      reports: {
        sales: 'GET /reports/sales',
        salesByPeriod: 'GET /reports/sales/period',
        topProducts: 'GET /reports/sales/top-products',
        staffPerformance: 'GET /reports/sales/staff-performance',
        salesComparison: 'GET /reports/sales/comparison',
        inventory: 'GET /reports/inventory',
        stockValue: 'GET /reports/inventory/stock-value',
        turnover: 'GET /reports/inventory/turnover',
        lowStock: 'GET /reports/inventory/low-stock',
        movements: 'GET /reports/inventory/movements',
        financial: 'GET /reports/financial',
        profitMargins: 'GET /reports/financial/profit-margins',
        expenses: 'GET /reports/financial/expenses',
        tax: 'GET /reports/financial/tax',
        revenueByStore: 'GET /reports/financial/revenue-by-store'
      }
    },
    demo_credentials: process.env.NODE_ENV !== 'production' ? DEMO_CREDENTIALS : 'Hidden in production'
  });
});

// Mount routes
router.use('/setup', setupRoutes);
router.use('/health', healthRoute);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/client', clientRoutes);
router.use('/pos', posRoutes);
router.use('/staff', staffRoutes);
router.use('/reports', reportsRoutes);

export default router;
