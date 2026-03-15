// src/config/swagger.ts
import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'KitaPOS API Documentation',
      version: '1.0.0',
      description: 'Multi-tenant Point of Sale System API with comprehensive inventory, sales, and reporting capabilities',
      contact: {
        name: 'KitaPOS Support',
        email: 'support@kitapos.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      },
      {
        url: 'https://kitapos-backend.onrender.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token obtained from login'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Error message' },
            details: { type: 'string', example: 'Additional error details' }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            full_name: { type: 'string' },
            role: { type: 'string', enum: ['client', 'super_admin'] },
            company_id: { type: 'string', format: 'uuid' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Company: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            address: { type: 'string' },
            subscription_status: {
              type: 'string',
              enum: ['trial', 'active', 'suspended', 'cancelled']
            },
            subscription_plan: {
              type: 'string',
              enum: ['basic', 'pro', 'enterprise']
            },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Store: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            company_id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            code: { type: 'string' },
            address: { type: 'string' },
            phone: { type: 'string' },
            is_active: { type: 'boolean' }
          }
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            company_id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            sku: { type: 'string' },
            barcode: { type: 'string' },
            category_id: { type: 'string', format: 'uuid' },
            price: { type: 'number', format: 'decimal' },
            cost: { type: 'number', format: 'decimal' },
            stock_quantity: { type: 'integer' },
            low_stock_threshold: { type: 'integer' },
            image_url: { type: 'string', format: 'uri' },
            is_active: { type: 'boolean' }
          }
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            company_id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            color: { type: 'string' },
            icon: { type: 'string' },
            is_active: { type: 'boolean' }
          }
        },
        Sale: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            company_id: { type: 'string', format: 'uuid' },
            store_id: { type: 'string', format: 'uuid' },
            staff_id: { type: 'string', format: 'uuid' },
            transaction_number: { type: 'string' },
            subtotal: { type: 'number', format: 'decimal' },
            tax: { type: 'number', format: 'decimal' },
            discount: { type: 'number', format: 'decimal' },
            total: { type: 'number', format: 'decimal' },
            payment_method: {
              type: 'string',
              enum: ['cash', 'card', 'e-wallet', 'other']
            },
            customer_name: { type: 'string' },
            notes: { type: 'string' }
          }
        },
        Staff: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            company_id: { type: 'string', format: 'uuid' },
            store_id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            pin: { type: 'string' },
            role: { type: 'string', enum: ['staff', 'manager'] },
            is_active: { type: 'boolean' }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  // Paths relative to project root where server.ts is
  apis: [
    path.join(__dirname, '../routes/auth/**/*.ts'),
    path.join(__dirname, '../routes/admin/**/*.ts'),
    path.join(__dirname, '../routes/client/**/*.ts'),
    path.join(__dirname, '../routes/pos/**/*.ts'),
    path.join(__dirname, '../routes/staff/**/*.ts'),
    path.join(__dirname, '../routes/reports/**/*.ts'),
    path.join(__dirname, '../routes/*.ts'),
    path.join(__dirname, '../routes/auth/**/*.js'),
    path.join(__dirname, '../routes/admin/**/*.js'),
    path.join(__dirname, '../routes/client/**/*.js'),
    path.join(__dirname, '../routes/pos/**/*.js'),
    path.join(__dirname, '../routes/staff/**/*.js'),
    path.join(__dirname, '../routes/reports/**/*.js'),
    path.join(__dirname, '../routes/*.js')
  ]
};

console.log('🔍 Swagger Config Loaded');
console.log('📂 Scanning paths:', options.apis);

const swaggerSpec = swaggerJsdoc(options);

console.log('📝 API Endpoints Found:', Object.keys((swaggerSpec as { paths?: Record<string, unknown> }).paths || {}).length);
if (Object.keys((swaggerSpec as { paths?: Record<string, unknown> }).paths || {}).length === 0) {
  console.warn('⚠️  No API endpoints detected! Check JSDoc comments in route files.');
}

export default swaggerSpec;
