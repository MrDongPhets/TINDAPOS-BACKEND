// server-new.js - Fixed CORS configuration
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

console.log('🔍 Environment Debug:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
console.log('SUPABASE_URL value:', process.env.SUPABASE_URL || 'MISSING');
console.log('SERVICE_KEY exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('SERVICE_KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.length : 0);
console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);

const app = express();
const PORT = process.env.PORT || 3001;

// JWT helpers
const JWT_SECRET = process.env.JWT_SECRET;

const generateToken = (user, userType = 'client') => {
  const payload = {
    id: user.id,
    email: user.email,
    userType: userType
  };

  if (userType === 'super_admin') {
    payload.permissions = user.permissions || {};
  } else {
    payload.role = user.role;
    payload.company_id = user.company_id;
    payload.store_id = user.store_id;
  }

  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'NO_TOKEN'
    })
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      let errorCode = 'INVALID_TOKEN'
      let errorMessage = 'Invalid or expired token'

      if (err.name === 'TokenExpiredError') {
        errorCode = 'TOKEN_EXPIRED'
        errorMessage = 'Token has expired'
      } else if (err.name === 'JsonWebTokenError') {
        errorCode = 'TOKEN_MALFORMED'
        errorMessage = 'Token is malformed'
      }

      return res.status(403).json({ 
        error: errorMessage,
        code: errorCode
      })
    }
    
    req.user = user
    next()
  })
}

const isProduction = process.env.NODE_ENV === 'production';

// PRODUCTION-READY CORS CONFIGURATION
const getAllowedOrigins = () => {
  const origins = []
  
  // Development origins
  if (!isProduction) {
    origins.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    )
  }
  
  // Production origins from environment variables
  if (process.env.FRONTEND_URL) {
    origins.push(process.env.FRONTEND_URL)
  }
  
  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`)
  }
  
  // Additional allowed origins (comma-separated)
  if (process.env.ALLOWED_ORIGINS) {
    const additionalOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    origins.push(...additionalOrigins)
  }
  
  // Auto-detect Vercel preview deployments
  if (process.env.VERCEL && process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`)
  }
  
  return origins
}

// FIXED CORS CONFIGURATION
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = getAllowedOrigins()
    
    console.log('🔍 CORS Check:')
    console.log('   Origin:', origin)
    console.log('   Allowed Origins:', allowedOrigins)
    console.log('   Environment:', isProduction ? 'production' : 'development')
    
    // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
    if (!origin) {
      console.log('   ✅ No origin - allowing request')
      return callback(null, true)
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('   ✅ Origin allowed')
      callback(null, true)
    } else {
      console.log('   ❌ Origin blocked by CORS')
      callback(new Error(`CORS blocked: ${origin} not in allowed origins`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  optionsSuccessStatus: 200
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    const logBody = { ...req.body };
    if (logBody.password) logBody.password = '***';
    console.log('   Body:', JSON.stringify(logBody));
  }
  next();
});

// Environment validation
function validateEnvVars() {
  console.log('🔍 Checking environment variables...');
  console.log('   Environment:', process.env.NODE_ENV || 'development');
  
  const required = {
    'SUPABASE_URL': process.env.SUPABASE_URL,
    'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'JWT_SECRET': process.env.JWT_SECRET
  };
  
  const missing = [];
  
  Object.entries(required).forEach(([key, value]) => {
    if (!value) {
      missing.push(key);
      console.log(`   ❌ Missing: ${key}`);
    } else {
      console.log(`   ✅ ${key}: ${value.substring(0, 10)}...`);
    }
  });
  
  if (missing.length > 0) {
    console.error('   ❌ Missing required environment variables:', missing);
    return false;
  }

  console.log('   ✅ All environment variables validated');
  return true;
}

let supabase = null;

async function initializeSupabase() {
  try {
    console.log('🔌 Initializing Supabase client...');
    
    if (!validateEnvVars()) {
      throw new Error('Environment validation failed - missing required variables');
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log('📡 Supabase URL:', supabaseUrl);
    console.log('🔑 Service Key exists:', !!supabaseServiceKey);
    
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    console.log('✅ Supabase client created');
    
    // Test connection
    const testResult = await testDatabaseConnection();
    
    if (testResult.success) {
      console.log('✅ Database connection verified');
    } else {
      console.log('❌ Database connection failed:', testResult.error);
      throw new Error(`Database connection failed: ${testResult.error}`);
    }
    
    return supabase;
    
  } catch (error) {
    console.error('❌ Failed to initialize Supabase:', error.message);
    console.error('Stack trace:', error.stack);
    return null;
  }
}

async function testDatabaseConnection() {
  if (!supabase) {
    return { success: false, error: 'Supabase client not initialized' };
  }
  
  try {
    console.log('🧪 Testing database connection...');
    
    const { data, error, count } = await supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      console.error('Database test failed:', error.message);
      return { success: false, error: error.message };
    }
    
    console.log(`✅ Database test successful - Found ${count || 0} companies`);
    return { success: true, count };
    
  } catch (error) {
    console.error('Database test exception:', error.message);
    return { success: false, error: error.message };
  }
}

async function ensureDemoData() {
  if (!supabase) {
    console.log('⚠️ Skipping demo data - Supabase not available');
    return;
  }

  try {
    console.log('📄 Ensuring demo data exists...');

    // Check and create super admin
    await ensureSuperAdmin();
    
    // Check and create demo company and user
    await ensureDemoCompanyAndUser();

    console.log('🎉 Demo data verification completed');

  } catch (error) {
    console.error('Demo data error:', error.message);
  }
}

async function ensureSuperAdmin() {
  const { data: existingSuperAdmin } = await supabase
    .from('super_admins')
    .select('id, email')
    .eq('email', 'admin@system.com')
    .single();

  if (!existingSuperAdmin) {
    console.log('👑 Creating demo super admin...');
    
    const hashedPassword = await bcrypt.hash('superadmin123', 12);
    
    const { error: superAdminError } = await supabase
      .from('super_admins')
      .insert([{
        email: 'admin@system.com',
        password: hashedPassword,
        name: 'System Administrator',
        phone: '+1-555-000-0001',
        is_active: true,
        permissions: {
          view_analytics: true,
          system_settings: true,
          manage_companies: true,
          manage_subscriptions: true
        }
      }]);

    if (superAdminError) {
      console.error('Failed to create super admin:', superAdminError.message);
    } else {
      console.log('✅ Demo super admin created');
    }
  } else {
    console.log('ℹ️ Super admin already exists');
  }
}

async function ensureDemoCompanyAndUser() {
  // First ensure company exists
  let { data: company } = await supabase
    .from('companies')
    .select('id, name')
    .eq('name', 'Demo Bakery')
    .single();

  if (!company) {
    console.log('🏢 Creating demo company...');
    
    const { data: newCompany, error: companyError } = await supabase
      .from('companies')
      .insert([{
        name: 'Demo Bakery',
        description: 'A demo bakery for testing the POS system',
        contact_email: 'contact@demobakery.com',
        contact_phone: '+1-555-BAKERY',
        address: '123 Bakery Street, Sweet City, SC 12345',
        website: 'https://demobakery.com',
        is_active: true,
        settings: {}
      }])
      .select()
      .single();

    if (companyError) {
      console.error('Failed to create company:', companyError.message);
      return;
    } else {
      company = newCompany;
      console.log('✅ Demo company created');
    }
  } else {
    console.log('ℹ️ Demo company already exists');
  }

  // Now ensure demo user exists
  const testEmail = 'manager@demobakery.com';
  const testPassword = 'password123';

  const { data: existingUser } = await supabase
    .from('users')
    .select('id, email, company_id, is_active')
    .eq('email', testEmail)
    .single();

  if (!existingUser) {
    console.log('👤 Creating demo user...');

    const hashedPassword = await bcrypt.hash(testPassword, 12);
    
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([{
        email: testEmail.toLowerCase(),
        password: hashedPassword,
        name: 'Demo Manager',
        role: 'manager',
        phone: '+1-555-0101',
        company_id: company.id,
        is_active: true
      }])
      .select()
      .single();

    if (userError) {
      console.error('Failed to create user:', userError.message);
    } else {
      console.log('✅ Demo user created');
      console.log(`   📧 Email: ${testEmail}`);
      console.log(`   🔑 Password: ${testPassword}`);
    }
  } else {
    console.log('ℹ️ Demo user already exists');
    
    // Verify the password works
    const { data: userData } = await supabase
      .from('users')
      .select('password')
      .eq('id', existingUser.id)
      .single();

    if (userData?.password) {
      const passwordWorks = await bcrypt.compare(testPassword, userData.password);
      if (!passwordWorks) {
        console.log('🔧 Fixing demo user password...');
        
        const hashedPassword = await bcrypt.hash(testPassword, 12);
        await supabase
          .from('users')
          .update({ password: hashedPassword })
          .eq('id', existingUser.id);
        
        console.log('✅ Demo user password fixed');
      }
    }
    
    console.log(`   📧 Email: ${testEmail}`);
    console.log(`   🔑 Password: ${testPassword}`);
  }

  // Create subscription if needed
  if (company.id) {
    const { data: existingSubscription } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('company_id', company.id)
      .single();

    if (!existingSubscription) {
      console.log('💳 Creating demo subscription...');
      
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);

      const { error: subscriptionError } = await supabase
        .from('subscriptions')
        .insert([{
          company_id: company.id,
          plan_name: 'trial',
          plan_type: 'monthly',
          status: 'active',
          price_amount: 0,
          currency: 'USD',
          max_users: 5,
          max_stores: 1,
          max_products: 100,
          features: {
            pos: true,
            reports: false,
            inventory: true,
            multi_store: false
          },
          trial_ends_at: trialEndDate.toISOString(),
          current_period_end: trialEndDate.toISOString()
        }]);

      if (subscriptionError) {
        console.log('Warning: Failed to create subscription:', subscriptionError.message);
      } else {
        console.log('✅ Demo subscription created');
      }
    }
  }
}

const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.userType !== 'super_admin') {
    return res.status(403).json({
      error: 'Super admin access required',
      code: 'SUPER_ADMIN_REQUIRED'
    });
  }
  next();
};

// Auth verify endpoint
app.get('/auth/verify', authenticateToken, async (req, res) => {
  try {
    // If we get here, token is valid (middleware passed)
    const userId = req.user.id
    const userType = req.user.userType

    if (userType === 'super_admin') {
      // Verify super admin still exists and is active
      const { data: admin, error } = await supabase
        .from('super_admins')
        .select('id, email, is_active')
        .eq('id', userId)
        .eq('is_active', true)
        .single()

      if (error || !admin) {
        return res.status(401).json({
          error: 'Admin account not found or inactive',
          code: 'ADMIN_INACTIVE'
        })
      }
    } else {
      // Verify client user still exists and is active
      const { data: user, error } = await supabase
        .from('users')
        .select('id, email, is_active, company_id')
        .eq('id', userId)
        .eq('is_active', true)
        .single()

      if (error || !user) {
        return res.status(401).json({
          error: 'User account not found or inactive',
          code: 'USER_INACTIVE'
        })
      }

      // Also verify company is still active
      if (user.company_id) {
        const { data: company, error: companyError } = await supabase
          .from('companies')
          .select('id, is_active')
          .eq('id', user.company_id)
          .eq('is_active', true)
          .single()

        if (companyError || !company) {
          return res.status(401).json({
            error: 'Company account is inactive',
            code: 'COMPANY_INACTIVE'
          })
        }
      }
    }

    res.json({
      valid: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        userType: req.user.userType,
        role: req.user.role
      }
    })

  } catch (error) {
    console.error('Token verification error:', error)
    res.status(500).json({
      error: 'Token verification failed',
      code: 'VERIFICATION_ERROR'
    })
  }
})

app.post('/auth/cleanup', authenticateToken, async (req, res) => {
  try {
    // This endpoint can be called to clean up any server-side session data
    // For now, just acknowledge the cleanup
    res.json({ 
      message: 'Session cleanup successful',
      code: 'CLEANUP_SUCCESS'
    })
  } catch (error) {
    res.status(500).json({ 
      error: 'Session cleanup failed',
      code: 'CLEANUP_ERROR'
    })
  }
})

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'POS System API - CORS Fixed Version',
    status: 'active',
    timestamp: new Date().toISOString(),
    version: '2.1.3',
    port: PORT,
    cors_origins: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    ],
    demo_credentials: {
      business_user: {
        email: 'manager@demobakery.com',
        password: 'password123'
      },
      super_admin: {
        email: 'admin@system.com',
        password: 'superadmin123'
      }
    },
    endpoints: {
      health: 'GET /health',
      auth: {
        login: 'POST /auth/login',
        superAdminLogin: 'POST /auth/super-admin/login',
        verify: 'GET /auth/verify',
        registerCompany: 'POST /auth/register-company',
        logout: 'POST /auth/logout'
      }
    }
  });
});

app.get('/health', async (req, res) => {
  const startTime = Date.now()
  
  try {
    let healthData = {
      status: 'checking',
      database: 'testing',
      timestamp: new Date().toISOString(),
      port: PORT,
      response_time_ms: 0,
      auth: {
        jwt_configured: !!JWT_SECRET,
        endpoints_active: true
      },
      cors: {
        enabled: true,
        origins: [
          'http://localhost:3000',
          'http://127.0.0.1:3000'
        ]
      }
    }

    if (supabase) {
      const testResult = await testDatabaseConnection()
      
      if (testResult.success) {
        healthData.status = 'healthy'
        healthData.database = 'connected'
        healthData.company_count = testResult.count || 0
      } else {
        healthData.status = 'degraded'
        healthData.database = 'disconnected'
        healthData.error = testResult.error
      }
    } else {
      healthData.status = 'degraded'
      healthData.database = 'not_initialized'
    }
    
    healthData.response_time_ms = Date.now() - startTime
    res.status(200).json(healthData)

  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// Business User Login - Fixed with better debugging
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log(`🔐 Login attempt for: ${email}`);

    if (!email || !password) {
      console.log('❌ Missing credentials');
      return res.status(400).json({ 
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    if (!supabase) {
      console.log('❌ Database not available');
      return res.status(503).json({
        error: 'Database service unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // First, find the user without the company join to debug
    console.log('🔍 Step 1: Finding user...');
    const { data: userCheck, error: userCheckError } = await supabase
      .from('users')
      .select('id, email, password, is_active, company_id, name, role')
      .eq('email', email.toLowerCase())
      .single();

    if (userCheckError || !userCheck) {
      console.log(`❌ User not found: ${email}`);
      console.log('   Error:', userCheckError?.message || 'No error message');
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    console.log('✅ User found:', userCheck.email);
    console.log('   Active:', userCheck.is_active);
    console.log('   Company ID:', userCheck.company_id);

    if (!userCheck.is_active) {
      console.log('❌ User account is inactive');
      return res.status(401).json({ 
        error: 'Account is inactive',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Verify password
    console.log('🔍 Step 2: Verifying password...');
    if (!userCheck.password) {
      console.log('❌ No password hash found');
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const isValidPassword = await bcrypt.compare(password, userCheck.password);
    console.log('   Password valid:', isValidPassword);

    if (!isValidPassword) {
      console.log('❌ Invalid password');
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Get user with company info
    console.log('🔍 Step 3: Getting user with company...');
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`
        *,
        companies!inner(*)
      `)
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (userError) {
      console.log('❌ Error getting user with company:', userError.message);
      // If company join fails, still allow login but without company data
      const basicUser = { ...userCheck, companies: null };
      const token = generateToken(basicUser, 'client');
      const { password: _, ...userWithoutPassword } = basicUser;
      
      return res.json({
        message: 'Login successful (no company data)',
        user: userWithoutPassword,
        company: null,
        subscription: null,
        token,
        userType: 'client'
      });
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Get subscription
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('company_id', user.company_id)
      .single();

    const token = generateToken(user, 'client');
    const { password: _, ...userWithoutPassword } = user;
    
    console.log('✅ Login successful for:', user.email);

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      company: user.companies,
      subscription: subscription,
      token,
      userType: 'client'
    });

  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Super Admin Login
app.post('/auth/super-admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log(`👑 Super admin login attempt: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    if (!supabase) {
      return res.status(503).json({
        error: 'Database service unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { data: admin, error } = await supabase
      .from('super_admins')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (error || !admin) {
      console.log(`❌ Super admin not found: ${email}`);
      return res.status(401).json({ 
        error: 'Invalid admin credentials',
        code: 'INVALID_ADMIN_CREDENTIALS'
      });
    }

    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      console.log(`❌ Invalid password for super admin ${email}`);
      return res.status(401).json({ 
        error: 'Invalid admin credentials',
        code: 'INVALID_ADMIN_CREDENTIALS'
      });
    }

    await supabase
      .from('super_admins')
      .update({ last_login: new Date().toISOString() })
      .eq('id', admin.id);

    const token = generateToken(admin, 'super_admin');
    const { password: _, ...adminWithoutPassword } = admin;
    
    console.log(`✅ Super admin logged in: ${admin.email}`);

    res.json({
      message: 'Super admin login successful',
      user: adminWithoutPassword,
      token,
      userType: 'super_admin'
    });

  } catch (error) {
    console.error('Super admin login error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Register Company
app.post('/auth/register-company', async (req, res) => {
  try {
    const { company, user, subscription } = req.body;

    console.log(`🏢 Company registration: ${company?.name}`);

    if (!company?.name || !company?.email || !user?.name || !user?.email || !user?.password) {
      return res.status(400).json({ 
        error: 'Company name, email, user name, email and password are required',
        code: 'MISSING_FIELDS'
      });
    }

    if (!supabase) {
      return res.status(503).json({
        error: 'Registration service unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Check existing company
    const { data: existingCompany } = await supabase
      .from('companies')
      .select('id')
      .eq('contact_email', company.email.toLowerCase())
      .single();

    if (existingCompany) {
      return res.status(409).json({
        error: 'Company with this email already exists',
        code: 'COMPANY_EXISTS'
      });
    }

    // Check existing user
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', user.email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({
        error: 'User with this email already exists',
        code: 'USER_EXISTS'
      });
    }

    const hashedPassword = await bcrypt.hash(user.password, 12);

    // Create company
    const { data: newCompany, error: companyError } = await supabase
      .from('companies')
      .insert([{
        name: company.name.trim(),
        description: company.description || `Business using POS system`,
        contact_email: company.email.toLowerCase().trim(),
        contact_phone: company.phone || null,
        address: company.address || null,
        website: company.website || null,
        is_active: true,
        settings: {}
      }])
      .select()
      .single();

    if (companyError) {
      console.error('Failed to create company:', companyError.message);
      return res.status(400).json({
        error: 'Failed to create company: ' + companyError.message,
        code: 'COMPANY_CREATE_ERROR'
      });
    }

    // Create user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([{
        email: user.email.toLowerCase().trim(),
        password: hashedPassword,
        name: user.name.trim(),
        role: 'manager',
        phone: user.phone || null,
        company_id: newCompany.id,
        is_active: true
      }])
      .select('id, email, name, role, phone, company_id, is_active, created_at')
      .single();

    if (userError) {
      console.error('Failed to create user:', userError.message);
      return res.status(400).json({
        error: 'Failed to create user account: ' + userError.message,
        code: 'USER_CREATE_ERROR'
      });
    }

    console.log(`✅ Company registered: ${newCompany.name} with user: ${newUser.email}`);

    res.status(201).json({
      success: true,
      message: 'Company registered successfully',
      company: newCompany,
      user: newUser
    });

  } catch (error) {
    console.error('❌ Company registration error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error during registration',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Admin endpoints with proper CORS
app.get('/admin/stats/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({
        error: 'Database service unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Get total users count
    const { count: totalUsers, error: usersError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (usersError) {
      console.error('Failed to fetch user stats:', usersError.message);
      return res.status(500).json({
        error: 'Failed to fetch user statistics',
        code: 'DB_ERROR'
      });
    }

    // Get users by role distribution
    const { data: usersByRole, error: roleError } = await supabase
      .from('users')
      .select('role')
      .eq('is_active', true);

    const roleDistribution = {
      manager: 0,
      supervisor: 0,
      staff: 0
    };

    if (!roleError && usersByRole) {
      usersByRole.forEach(user => {
        if (roleDistribution.hasOwnProperty(user.role)) {
          roleDistribution[user.role]++;
        }
      });
    }

    // Get recent user registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: recentUsers, error: recentError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString())
      .eq('is_active', true);

    res.json({
      totalUsers: totalUsers || 0,
      roleDistribution,
      recentUsers: recentUsers || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get user stats error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get subscription statistics (Super Admin)
app.get('/admin/stats/subscriptions', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({
        error: 'Database service unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Get all active subscriptions
    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'active');

    if (subsError) {
      console.error('Failed to fetch subscription stats:', subsError.message);
      return res.status(500).json({
        error: 'Failed to fetch subscription statistics',
        code: 'DB_ERROR'
      });
    }

    // Calculate total revenue
    let totalRevenue = 0;
    const planDistribution = {
      trial: 0,
      basic: 0,
      pro: 0,
      custom: 0
    };

    if (subscriptions) {
      subscriptions.forEach(sub => {
        totalRevenue += parseFloat(sub.price_amount || 0);
        
        const planName = sub.plan_name?.toLowerCase() || 'trial';
        if (planDistribution.hasOwnProperty(planName)) {
          planDistribution[planName]++;
        } else {
          planDistribution.custom++;
        }
      });
    }

    // Get subscription trends (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { data: recentSubs, error: trendError } = await supabase
      .from('subscriptions')
      .select('created_at, plan_name, price_amount')
      .gte('created_at', sixMonthsAgo.toISOString())
      .order('created_at', { ascending: true });

    res.json({
      totalRevenue,
      totalSubscriptions: subscriptions?.length || 0,
      planDistribution,
      monthlyTrend: recentSubs || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get subscription stats error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

app.get('/admin/companies', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    console.log('🏢 Fetching companies data...');
    
    if (!supabase) {
      return res.status(503).json({
        error: 'Database service unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Get ONLY companies data - no relationships at all
    const { data: companies, error: companiesError } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (companiesError) {
      console.error('Failed to fetch companies:', companiesError.message);
      return res.status(500).json({
        error: 'Failed to fetch companies',
        code: 'DB_ERROR',
        details: companiesError.message
      });
    }

    if (!companies) {
      console.log('No companies found');
      return res.json({
        companies: [],
        count: 0,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`✅ Found ${companies.length} companies`);

    res.json({
      companies: companies,
      count: companies.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get companies error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message
    });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  console.log('✅ Logout request processed');
  res.json({ 
    message: 'Logout successful',
    code: 'LOGOUT_SUCCESS'
  });
});

// Error handlers
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error.message);
  res.status(500).json({ 
    error: 'Internal server error',
    code: 'UNHANDLED_ERROR'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    method: req.method
  });
});

// Initialize and start server
(async () => {
  console.log('🚀 Starting POS System API Server...');
  console.log(`🔍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Port: ${PORT}`);
  
  await initializeSupabase();
  
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Local API: http://localhost:${PORT}`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
    console.log('🌐 CORS enabled for:');
    console.log('   - http://localhost:3000');
    console.log('   - http://127.0.0.1:3000');
    console.log('');
    console.log('📋 Demo Credentials:');
    console.log('   Business User: manager@demobakery.com / password123');
    console.log('   Super Admin: admin@system.com / superadmin123');
    console.log('✅ Server ready to accept connections');
  });

  process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('✅ Process terminated');
    });
  });
})();

module.exports = app;