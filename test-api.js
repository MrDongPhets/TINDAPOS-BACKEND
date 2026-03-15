// server-new.js - Updated for new database schema
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Enhanced environment variable validation
function validateEnvVars() {
  const required = {
    'SUPABASE_URL': process.env.SUPABASE_URL,
    'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'JWT_SECRET': process.env.JWT_SECRET
  };
  
  const missing = [];
  
  Object.entries(required).forEach(([key, value]) => {
    if (!value) {
      missing.push(key);
    }
  });
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    return false;
  }

  // Fix URL protocol issue
  if (process.env.SUPABASE_URL && !process.env.SUPABASE_URL.startsWith('http')) {
    process.env.SUPABASE_URL = 'https://' + process.env.SUPABASE_URL;
  }

  console.log('✅ All environment variables validated');
  return true;
}

// Global variables
let supabase = null;
let initializationPromise = null;

// Initialize Supabase client
async function getSupabaseClient() {
  if (supabase) {
    return supabase;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = initializeSupabase();
  return initializationPromise;
}

async function initializeSupabase() {
  try {
    if (!validateEnvVars()) {
      throw new Error('Environment validation failed');
    }

    console.log('🔌 Initializing Supabase client...');
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: {
        schema: 'public'
      }
    });
    
    console.log('✅ Supabase client created');
    
    // Test the connection
    const testResult = await testSupabaseConnection();
    
    if (!testResult.success) {
      console.error('❌ Supabase connection test failed:', testResult.error);
    } else {
      console.log('✅ Supabase connection verified');
      // Initialize demo data
      await initializeDemoData();
    }
    
    return supabase;
    
  } catch (error) {
    console.error('❌ Failed to initialize Supabase:', error.message);
    return null;
  }
}

// Test Supabase connection
async function testSupabaseConnection() {
  if (!supabase) {
    return { success: false, error: 'Supabase client not initialized' };
  }
  
  try {
    console.log('🧪 Testing Supabase connection...');
    
    const { data, error, count } = await supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      console.error('Database query failed:', error.message);
      return { success: false, error: error.message, details: error };
    }
    
    console.log('✅ Database query successful');
    return { success: true, data, count };
    
  } catch (error) {
    console.error('Connection test exception:', error.message);
    return { success: false, error: error.message, exception: true };
  }
}

// Initialize demo data
async function initializeDemoData() {
  if (!supabase) {
    console.log('⚠️ Skipping demo data - Supabase not available');
    return;
  }

  try {
    console.log('📄 Checking for demo data...');

    // 1. Create demo super admin
    const { data: existingSuperAdmin, error: checkSuperAdminError } = await supabase
      .from('super_admins')
      .select('id, email')
      .eq('email', 'admin@system.com')
      .single();

    if (checkSuperAdminError && checkSuperAdminError.code !== 'PGRST116') {
      console.error('Error checking super admin:', checkSuperAdminError.message);
    }

    if (!existingSuperAdmin) {
      console.log('🔑 Creating demo super admin...');
      
      const hashedPassword = await bcrypt.hash('superadmin123', 12);
      
      const { data: superAdmin, error: superAdminError } = await supabase
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
        }])
        .select()
        .single();

      if (superAdminError) {
        console.error('Failed to create super admin:', superAdminError.message);
      } else {
        console.log('✅ Demo super admin created');
      }
    }

    // 2. Create demo company
    const { data: existingCompany, error: checkCompanyError } = await supabase
      .from('companies')
      .select('id, name')
      .eq('name', 'Demo Bakery')
      .single();

    if (checkCompanyError && checkCompanyError.code !== 'PGRST116') {
      console.error('Error checking company:', checkCompanyError.message);
    }

    let demoCompanyId = existingCompany?.id;

    if (!existingCompany) {
      console.log('🏢 Creating demo company...');
      
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .insert([{
          name: 'Demo Bakery',
          email: 'contact@demobakery.com',
          phone: '+1-555-BAKERY',
          address: '123 Bakery Street, Sweet City, SC 12345',
          website: 'https://demobakery.com',
          is_active: true
        }])
        .select()
        .single();

      if (companyError) {
        console.error('Failed to create company:', companyError.message);
        return;
      } else {
        demoCompanyId = company.id;
        console.log('✅ Demo company created');
      }
    }

    // 3. Create subscription for demo company
    if (demoCompanyId) {
      const { data: existingSubscription } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('company_id', demoCompanyId)
        .single();

      if (!existingSubscription) {
        console.log('💳 Creating demo subscription...');
        
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 14);

        const { error: subscriptionError } = await supabase
          .from('subscriptions')
          .insert([{
            company_id: demoCompanyId,
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
          console.error('Failed to create subscription:', subscriptionError.message);
        } else {
          console.log('✅ Demo subscription created');
        }
      }
    }

    // 4. Create demo store
    const { data: existingStore } = await supabase
      .from('stores')
      .select('id')
      .eq('id', 'DEMO-STORE-01')
      .single();

    if (!existingStore && demoCompanyId) {
      console.log('🏪 Creating demo store...');
      
      const { error: storeError } = await supabase
        .from('stores')
        .insert([{
          id: 'DEMO-STORE-01',
          name: 'Main Bakery Location',
          address: '123 Bakery Street, Sweet City, SC 12345',
          phone: '+1-555-BAKERY',
          company_id: demoCompanyId,
          company_name: 'Demo Bakery',
          is_active: true
        }]);

      if (storeError) {
        console.error('Failed to create store:', storeError.message);
      } else {
        console.log('✅ Demo store created');
      }
    }

    // 5. Create demo business users
    const { data: existingUser, error: checkUserError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', 'manager@demobakery.com')
      .single();

    if (checkUserError && checkUserError.code !== 'PGRST116') {
      console.error('Error checking user:', checkUserError.message);
    }

    if (!existingUser && demoCompanyId) {
      console.log('👤 Creating demo business users...');

      const hashedPassword = await bcrypt.hash('password123', 12);

      const demoUsers = [
        {
          email: 'manager@demobakery.com',
          password: hashedPassword,
          name: 'Sarah Johnson',
          role: 'manager',
          phone: '+1-555-0101',
          company_id: demoCompanyId,
          store_id: 'DEMO-STORE-01',
          is_active: true
        },
        {
          email: 'cashier@demobakery.com',
          password: hashedPassword,
          name: 'Mike Davis',
          role: 'cashier',
          phone: '+1-555-0102',
          company_id: demoCompanyId,
          store_id: 'DEMO-STORE-01',
          is_active: true
        },
        {
          email: 'staff@demobakery.com',
          password: hashedPassword,
          name: 'Emma Wilson',
          role: 'staff',
          phone: '+1-555-0103',
          company_id: demoCompanyId,
          store_id: 'DEMO-STORE-01',
          is_active: true
        }
      ];

      const { data: users, error: insertError } = await supabase
        .from('users')
        .insert(demoUsers)
        .select();

      if (insertError) {
        console.error('Failed to create demo users:', insertError.message);
      } else {
        console.log('✅ Demo business users created:', users.length);
      }
    }

    console.log('🎉 Demo data initialization completed');

  } catch (error) {
    console.error('Demo data initialization error:', error.message);
  }
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;

// Helper function to generate JWT token
const generateToken = (user, userType = 'client') => {
  const payload = {
    id: user.id,
    email: user.email,
    userType: userType
  };

  // Add different fields based on user type
  if (userType === 'super_admin') {
    payload.permissions = user.permissions || {};
  } else {
    payload.role = user.role;
    payload.company_id = user.company_id;
    payload.store_id = user.store_id;
  }

  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'NO_TOKEN'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('JWT verification failed:', err.message);
      
      let errorCode = 'INVALID_TOKEN';
      let errorMessage = 'Invalid or expired token';
      
      if (err.name === 'TokenExpiredError') {
        errorCode = 'TOKEN_EXPIRED';
        errorMessage = 'Token has expired';
      }
      
      return res.status(403).json({ 
        error: errorMessage,
        code: errorCode
      });
    }
    req.user = user;
    next();
  });
};

// Role-based authorization middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    // Check if user is super admin
    if (req.user.userType === 'super_admin') {
      return next(); // Super admin has access to everything
    }
    
    // Check regular user roles
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: allowedRoles,
        userRole: req.user.role
      });
    }
    next();
  };
};

// Super admin only middleware
const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.userType !== 'super_admin') {
    return res.status(403).json({
      error: 'Super admin access required',
      code: 'SUPER_ADMIN_REQUIRED'
    });
  }
  next();
};

// ========================= ROUTES =========================

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'POS System API Server Running - Updated Schema',
    status: 'active',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/health',
      auth: {
        clientLogin: '/auth/login',
        superAdminLogin: '/auth/super-admin/login',
        registerCompany: '/auth/register-company'
      },
      admin: {
        companies: '/admin/companies',
        subscriptions: '/admin/subscriptions'
      },
      client: {
        profile: '/client/profile',
        company: '/client/company'
      }
    }
  });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('🔍 Health check started...');
    
    let healthData = {
      status: 'checking',
      database: 'testing',
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
        environment: process.env.NODE_ENV || 'development'
      },
      response_time_ms: 0
    };

    const client = await getSupabaseClient();
    
    if (client) {
      const testResult = await testSupabaseConnection();
      
      if (testResult.success) {
        healthData.status = 'healthy';
        healthData.database = 'connected';
        healthData.company_count = testResult.count || 0;
      } else {
        healthData.status = 'unhealthy';
        healthData.database = 'disconnected';
        healthData.error = testResult.error;
      }
    } else {
      healthData.status = 'unhealthy';
      healthData.database = 'initialization_failed';
    }
    
    healthData.response_time_ms = Date.now() - startTime;
    
    const statusCode = healthData.status === 'healthy' ? 200 : 503;
    console.log(`Health check completed: ${healthData.status} (${healthData.response_time_ms}ms)`);
    
    res.status(statusCode).json(healthData);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('Health check error:', error.message);
    
    res.status(500).json({ 
      status: 'error',
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString(),
      response_time_ms: responseTime
    });
  }
});

// ========================= AUTHENTICATION ENDPOINTS =========================

// Business User Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log(`🔐 Business user login attempt for: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Find user in users table
    const { data: user, error } = await client
      .from('users')
      .select(`
        *,
        companies!inner(*)
      `)
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (error || !user) {
      console.log(`❌ User not found: ${email}`);
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log(`❌ Invalid password for ${email}`);
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Update last login
    await client
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Get subscription info
    const { data: subscription } = await client
      .from('subscriptions')
      .select('*')
      .eq('company_id', user.company_id)
      .single();

    // Generate JWT token
    const token = generateToken(user, 'client');

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      company: user.companies,
      subscription: subscription,
      token,
      userType: 'client'
    });

    console.log(`✅ Business user logged in: ${user.email}`);

  } catch (error) {
    console.error('Business login error:', error.message);
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

    console.log(`🔐 Super admin login attempt for: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Find super admin in super_admins table
    const { data: admin, error } = await client
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

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      console.log(`❌ Invalid password for super admin ${email}`);
      return res.status(401).json({ 
        error: 'Invalid admin credentials',
        code: 'INVALID_ADMIN_CREDENTIALS'
      });
    }

    // Update last login
    await client
      .from('super_admins')
      .update({ last_login: new Date().toISOString() })
      .eq('id', admin.id);

    // Generate JWT token
    const token = generateToken(admin, 'super_admin');

    // Return admin data (without password)
    const { password: _, ...adminWithoutPassword } = admin;
    
    res.json({
      message: 'Super admin login successful',
      user: adminWithoutPassword,
      token,
      userType: 'super_admin'
    });

    console.log(`✅ Super admin logged in: ${admin.email}`);

  } catch (error) {
    console.error('Super admin login error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Register Company (with first user)
app.post('/auth/register-company', async (req, res) => {
  try {
    const { company, user, subscription } = req.body;

    console.log(`🏢 Company registration: ${company.name}`);

    if (!company.name || !company.email || !user.name || !user.email || !user.password) {
      return res.status(400).json({ 
        error: 'Company name, email, user name, email and password are required',
        code: 'MISSING_FIELDS'
      });
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Registration unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Check if company already exists
    const { data: existingCompany } = await client
      .from('companies')
      .select('id')
      .eq('email', company.email.toLowerCase())
      .single();

    if (existingCompany) {
      return res.status(409).json({
        error: 'Company with this email already exists',
        code: 'COMPANY_EXISTS'
      });
    }

    // Check if user email already exists
    const { data: existingUser } = await client
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

    // Hash password
    const hashedPassword = await bcrypt.hash(user.password, 12);

    // Start transaction-like operations
    
    // 1. Create company
    const { data: newCompany, error: companyError } = await client
      .from('companies')
      .insert([{
        name: company.name.trim(),
        email: company.email.toLowerCase().trim(),
        phone: company.phone || null,
        address: company.address || null,
        website: company.website || null,
        is_active: true
      }])
      .select()
      .single();

    if (companyError) {
      console.error('Failed to create company:', companyError.message);
      return res.status(400).json({
        error: 'Failed to create company',
        code: 'COMPANY_CREATE_ERROR'
      });
    }

    // 2. Create subscription
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    const subscriptionPlan = subscription?.plan || 'trial';
    const planDetails = {
      trial: { maxUsers: 5, maxStores: 1, maxProducts: 100, price: 0 },
      basic: { maxUsers: 10, maxStores: 3, maxProducts: 1000, price: 29 },
      pro: { maxUsers: -1, maxStores: -1, maxProducts: -1, price: 79 }
    };

    const plan = planDetails[subscriptionPlan] || planDetails.trial;

    const { error: subscriptionError } = await client
      .from('subscriptions')
      .insert([{
        company_id: newCompany.id,
        plan_name: subscriptionPlan,
        plan_type: 'monthly',
        status: 'active',
        price_amount: plan.price,
        currency: 'USD',
        max_users: plan.maxUsers,
        max_stores: plan.maxStores,
        max_products: plan.maxProducts,
        features: {
          pos: true,
          reports: subscriptionPlan !== 'trial',
          inventory: true,
          multi_store: subscriptionPlan === 'pro'
        },
        trial_ends_at: subscriptionPlan === 'trial' ? trialEndDate.toISOString() : null,
        current_period_end: trialEndDate.toISOString()
      }]);

    if (subscriptionError) {
      console.error('Failed to create subscription:', subscriptionError.message);
      // Continue anyway - subscription can be created later
    }

    // 3. Create first user (owner/manager)
    const { data: newUser, error: userError } = await client
      .from('users')
      .insert([{
        email: user.email.toLowerCase().trim(),
        password: hashedPassword,
        name: user.name.trim(),
        role: 'manager', // First user is always manager
        phone: user.phone || null,
        company_id: newCompany.id,
        is_active: true
      }])
      .select('id, email, name, role, phone, company_id, is_active, created_at')
      .single();

    if (userError) {
      console.error('Failed to create user:', userError.message);
      return res.status(400).json({
        error: 'Failed to create user account',
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

// ========================= SUPER ADMIN ENDPOINTS =========================

// Get all companies (Super Admin only)
app.get('/admin/companies', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    console.log('📋 Super admin fetching companies');

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { data: companies, error } = await client
      .from('companies')
      .select(`
        *,
        subscriptions(*),
        users(count),
        stores(count)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch companies:', error.message);
      return res.status(500).json({
        error: 'Failed to fetch companies',
        code: 'DB_ERROR'
      });
    }

    res.json({
      companies: companies || [],
      count: companies?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get companies error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get all subscriptions (Super Admin only)
app.get('/admin/subscriptions', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    console.log('💳 Super admin fetching subscriptions');

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { data: subscriptions, error } = await client
      .from('subscriptions')
      .select(`
        *,
        companies(name, email, phone)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch subscriptions:', error.message);
      return res.status(500).json({
        error: 'Failed to fetch subscriptions',
        code: 'DB_ERROR'
      });
    }

    res.json({
      subscriptions: subscriptions || [],
      count: subscriptions?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get subscriptions error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ========================= CLIENT ENDPOINTS =========================

// Get client profile
app.get('/client/profile', authenticateToken, async (req, res) => {
  try {
    if (req.user.userType !== 'client') {
      return res.status(403).json({
        error: 'Client access only',
        code: 'CLIENT_ACCESS_REQUIRED'
      });
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.json({ 
        user: req.user,
        source: 'fallback'
      });
    }

    const { data: user, error } = await client
      .from('users')
      .select(`
        id, email, name, role, phone, company_id, store_id, is_active, created_at, last_login,
        companies(*)
      `)
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({ 
      user, 
      company: user.companies,
      source: 'supabase' 
    });

  } catch (error) {
    console.error('Client profile error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Logout endpoint
app.post('/auth/logout', (req, res) => {
  console.log('✅ Logout request processed');
  
  res.json({ 
    message: 'Logout successful',
    code: 'LOGOUT_SUCCESS'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error.message);
  res.status(500).json({ 
    error: 'Internal server error',
    code: 'UNHANDLED_ERROR'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    method: req.method
  });
});

// Export for Vercel
module.exports = app;

// Only start server locally (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Local API: http://localhost:${PORT}`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  });
}