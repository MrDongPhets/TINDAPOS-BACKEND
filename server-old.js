  // server.js - Added sync endpoints for getting users data
  const express = require('express');
  const cors = require('cors');
  const jwt = require('jsonwebtoken');
  const bcrypt = require('bcryptjs');
  const { createClient } = require('@supabase/supabase-js');

  const app = express();
  const PORT = process.env.PORT || 3000;

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

  // Initialize Supabase client (lazy initialization)
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
        // Don't throw error, just log it - let the app continue with limited functionality
      } else {
        console.log('✅ Supabase connection verified');
        // Initialize demo data only if connection is successful
        await initializeDemoData();
      }
      
      return supabase;
      
    } catch (error) {
      console.error('❌ Failed to initialize Supabase:', error.message);
      // Return null instead of throwing to allow app to continue
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
        .from('users')
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
      console.log('🔄 Checking for demo data...');

      // Check if admin user exists
      const { data: existingAdmin, error: checkError } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', 'admin@techcorp.com')
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking admin user:', checkError.message);
        return;
      }

      if (existingAdmin) {
        console.log('✅ Demo admin user already exists');
        return;
      }

      console.log('📝 Creating demo users...');

      // Hash the demo password
      const hashedPassword = await bcrypt.hash('password123', 12);

      // Create demo users
      const demoUsers = [
        {
          email: 'admin@techcorp.com',
          password: hashedPassword,
          name: 'Demo Admin',
          role: 'super_admin',
          is_active: true,
          created_at: new Date().toISOString()
        },
        {
          email: 'manager@techcorp.com',
          password: hashedPassword,
          name: 'Demo Manager',
          role: 'manager',
          is_active: true,
          created_at: new Date().toISOString()
        },
        {
          email: 'cashier@techcorp.com',
          password: hashedPassword,
          name: 'Demo Cashier',
          role: 'cashier',
          is_active: true,
          created_at: new Date().toISOString()
        }
      ];

      const { data: users, error: insertError } = await supabase
        .from('users')
        .insert(demoUsers)
        .select();

      if (insertError) {
        console.error('Failed to create demo users:', insertError.message);
        return;
      }

      console.log('✅ Demo users created:', users.length);

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
  const generateToken = (user) => {
    return jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role 
      }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
  };

  // Enhanced middleware to verify JWT token with better error handling
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
        
        // Provide more specific error messages
        let errorCode = 'INVALID_TOKEN';
        let errorMessage = 'Invalid or expired token';
        
        if (err.name === 'TokenExpiredError') {
          errorCode = 'TOKEN_EXPIRED';
          errorMessage = 'Token has expired';
        } else if (err.name === 'JsonWebTokenError') {
          errorCode = 'MALFORMED_TOKEN';
          errorMessage = 'Token is malformed';
        } else if (err.name === 'NotBeforeError') {
          errorCode = 'TOKEN_NOT_ACTIVE';
          errorMessage = 'Token not active yet';
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

  // Optional authentication middleware - doesn't fail if no token
  const optionalAuthentication = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        console.log('Optional auth failed (continuing anyway):', err.message);
        req.user = null;
      } else {
        req.user = user;
      }
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

  // Routes

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({ 
      message: 'POS System API Server Running',
      status: 'active',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      endpoints: {
        health: '/health',
        auth: {
          login: '/auth/login',
          register: '/auth/register',
          profile: '/auth/profile'
        },
        sync: {
          users: '/sync/users',
          all: '/sync/all'
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
        supabase_url: process.env.SUPABASE_URL,
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.version,
          environment: process.env.NODE_ENV || 'development'
        },
        response_time_ms: 0
      };

      // Try to get Supabase client and test connection
      const client = await getSupabaseClient();
      
      if (client) {
        const testResult = await testSupabaseConnection();
        
        if (testResult.success) {
          healthData.status = 'healthy';
          healthData.database = 'connected';
          healthData.user_count = testResult.count || 0;
        } else {
          healthData.status = 'unhealthy';
          healthData.database = 'disconnected';
          healthData.error = testResult.error;
          healthData.error_details = testResult.details;
        }
      } else {
        healthData.status = 'unhealthy';
        healthData.database = 'initialization_failed';
        healthData.error = 'Could not initialize Supabase client';
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

  // NEW: Sync endpoints for getting data from Supabase

  // Get all users from Supabase for syncing
  app.get('/sync/users', async (req, res) => {
    try {
      console.log('🔄 Sync users request received');

      const client = await getSupabaseClient();
      
      if (!client) {
        return res.status(503).json({
          error: 'Database connection not available',
          code: 'SERVICE_UNAVAILABLE'
        });
      }

      // Get all users from Supabase (excluding password for security)
      const { data: users, error } = await client
        .from('users')
        .select('id, email, name, role, phone, is_active, created_at, updated_at, last_login')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Failed to fetch users:', error.message);
        return res.status(500).json({ 
          error: 'Failed to fetch users from database',
          code: 'DB_ERROR',
          details: error.message
        });
      }

      console.log(`✅ Retrieved ${users?.length || 0} users for sync`);

      res.json({
        users: users || [],
        count: users?.length || 0,
        timestamp: new Date().toISOString(),
        source: 'supabase'
      });

    } catch (error) {
      console.error('❌ Sync users error:', error.message);
      res.status(500).json({ 
        error: 'Internal server error during sync',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // Get all data for complete sync (users only for now, can expand later)
  app.get('/sync/all', async (req, res) => {
    try {
      console.log('🔄 Complete sync request received');

      const client = await getSupabaseClient();
      
      if (!client) {
        return res.status(503).json({
          error: 'Database connection not available',
          code: 'SERVICE_UNAVAILABLE'
        });
      }

      // Get all users
      const { data: users, error: usersError } = await client
        .from('users')
        .select('id, email, name, role, phone, is_active, created_at, updated_at, last_login')
        .order('created_at', { ascending: false });

      if (usersError) {
        console.error('❌ Failed to fetch users:', usersError.message);
        return res.status(500).json({ 
          error: 'Failed to fetch users from database',
          code: 'DB_ERROR',
          details: usersError.message
        });
      }

      // You can add more tables here later (products, categories, etc.)
      const syncData = {
        users: users || [],
        // products: [], // Add when you have products table
        // categories: [], // Add when you have categories table
        // customers: [], // Add when you have customers table
        counts: {
          users: users?.length || 0,
          // products: 0,
          // categories: 0,
          // customers: 0
        },
        timestamp: new Date().toISOString(),
        source: 'supabase'
      };

      console.log(`✅ Complete sync data prepared:`, syncData.counts);

      res.json(syncData);

    } catch (error) {
      console.error('❌ Complete sync error:', error.message);
      res.status(500).json({ 
        error: 'Internal server error during complete sync',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // Login endpoint
  app.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      console.log(`🔐 Login attempt for: ${email}`);

      // Validate input
      if (!email || !password) {
        return res.status(400).json({ 
          error: 'Email and password are required',
          code: 'MISSING_CREDENTIALS'
        });
      }

      // Get Supabase client
      const client = await getSupabaseClient();
      
      if (!client) {
        // Fallback authentication for demo
        console.log('⚠️ Using fallback authentication');
        
        const demoUsers = {
          'admin@techcorp.com': { id: 1, name: 'Demo Admin', role: 'super_admin', email: 'admin@techcorp.com' },
          'manager@techcorp.com': { id: 2, name: 'Demo Manager', role: 'manager', email: 'manager@techcorp.com' },
          'cashier@techcorp.com': { id: 3, name: 'Demo Cashier', role: 'cashier', email: 'cashier@techcorp.com' }
        };
        
        const user = demoUsers[email.toLowerCase()];
        if (user && password === 'password123') {
          const token = generateToken(user);
          return res.json({
            message: 'Login successful (fallback mode)',
            user,
            token,
            source: 'fallback'
          });
        } else {
          return res.status(401).json({ 
            error: 'Invalid email or password (fallback mode)',
            code: 'INVALID_CREDENTIALS'
          });
        }
      }

      // Normal Supabase authentication
      const { data: user, error } = await client
        .from('users')
        .select('*')
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

      // Generate JWT token
      const token = generateToken(user);

      // Return user data (without password)
      const { password: _, ...userWithoutPassword } = user;
      
      res.json({
        message: 'Login successful',
        user: userWithoutPassword,
        token,
        source: 'supabase'
      });

      console.log(`✅ User logged in: ${user.email}`);

    } catch (error) {
      console.error('Login error:', error.message);
      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  });
//all get function
// Add these staff endpoints to your server.js file

// GET /staff - Fetch staff with proper store filtering
app.get('/staff', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    console.log('🔄 Get staff request received from user:', {
      userId: req.user.id,
      userRole: req.user.role,
      userStoreId: req.user.store_id
    });

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    let query = client
      .from('staff')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // Apply filtering based on user role
    if (req.user.role === 'manager' && req.user.store_id) {
      console.log(`🏪 Manager filtering staff by store: ${req.user.store_id}`);
      query = query.eq('store_id', req.user.store_id);
    } else if (req.user.role === 'super_admin') {
      const { store_id } = req.query;
      if (store_id) {
        console.log(`👑 Super admin filtering staff by store: ${store_id}`);
        query = query.eq('store_id', store_id);
      } else {
        console.log('👑 Super admin accessing all staff');
      }
    }

    const { data: staff, error } = await query;

    if (error) {
      console.error('❌ Failed to fetch staff:', error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch staff from database',
        code: 'DB_ERROR',
        details: error.message
      });
    }

    // FIXED: Map position back to role for consistency
    const staffWithRole = staff.map(member => ({
      ...member,
      role: member.position || member.role || 'staff' // Ensure role field exists
    }));

    console.log(`✅ Retrieved ${staffWithRole?.length || 0} staff members`);

    res.json({
      staff: staffWithRole || [],
      count: staffWithRole?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get staff error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /staff - Create new staff member with store validation
app.post('/staff', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { name, staff_id, store_id, passcode, image_url, role, hourly_rate } = req.body;

    console.log('📝 Creating staff request:', {
      name,
      staff_id,
      store_id,
      passcode: passcode ? '***' : 'missing',
      role,
      hourly_rate,
      userRole: req.user.role,
      userStoreId: req.user.store_id
    });

    // Validate required fields
    if (!name || !staff_id || !store_id || !passcode) {
      return res.status(400).json({ 
        error: 'Name, staff ID, store ID, and passcode are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate store access for managers
    if (req.user.role === 'manager' && req.user.store_id) {
      if (store_id !== req.user.store_id) {
        return res.status(403).json({
          error: 'Managers can only create staff for their assigned store',
          code: 'STORE_ACCESS_DENIED'
        });
      }
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Check if staff ID already exists
    console.log('🔍 Checking for existing staff ID:', staff_id);
    const { data: existingStaff, error: checkError } = await client
      .from('staff')
      .select('id, staff_id, store_id')
      .eq('staff_id', staff_id.trim().toUpperCase())
      .eq('is_active', true)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.log('❌ Error checking existing staff:', checkError);
      return res.status(500).json({
        error: 'Database query error',
        code: 'DB_CHECK_ERROR',
        details: checkError.message
      });
    }

    if (existingStaff) {
      console.log('❌ Staff ID already exists:', existingStaff);
      return res.status(409).json({ 
        error: `Staff ID "${staff_id}" already exists`,
        code: 'STAFF_ID_EXISTS'
      });
    }

    // FIXED: Use 'role' field to match your Supabase schema
    const staffData = {
      name: name.trim(),
      staff_id: staff_id.trim().toUpperCase(),
      store_id: store_id,
      passcode: passcode.trim(),
      image_url: image_url || null,
      role: role || 'staff', // Use 'role' instead of 'position'
      hourly_rate: hourly_rate ? parseFloat(hourly_rate) : 15.00,
      is_active: true,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('📝 Inserting staff data:', {
      ...staffData,
      passcode: '***'
    });

    const { data: newStaff, error: insertError } = await client
      .from('staff')
      .insert([staffData])
      .select()
      .single();

    if (insertError) {
      console.error('❌ Database insert error:', {
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        code: insertError.code
      });
      return res.status(400).json({ 
        error: 'Failed to create staff member in database',
        code: 'DB_INSERT_ERROR',
        details: insertError.message
      });
    }

    console.log('✅ Staff created successfully in Supabase:', newStaff.staff_id);

    res.status(201).json({
      message: 'Staff member created successfully',
      staff: newStaff
    });

  } catch (error) {
    console.error('❌ Server error creating staff:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});


// PUT /staff/:staffId - Update staff member
app.put('/staff/:staffId', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { staffId } = req.params;
    const updates = req.body;

    console.log(`📝 Updating staff: ${staffId}`);

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Prepare update data
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    // Remove fields that shouldn't be updated
    delete updateData.id;
    delete updateData.created_at;
    delete updateData.created_by;

    const { data: updatedStaff, error } = await client
      .from('staff')
      .update(updateData)
      .eq('id', staffId)
      .select()
      .single();

    if (error) {
      console.error('Update staff error:', error.message);
      return res.status(400).json({ 
        error: 'Failed to update staff member',
        code: 'DB_UPDATE_ERROR',
        details: error.message
      });
    }

    if (!updatedStaff) {
      return res.status(404).json({ 
        error: 'Staff member not found',
        code: 'STAFF_NOT_FOUND'
      });
    }

    console.log('✅ Staff updated successfully:', updatedStaff.staff_id);

    res.json({
      message: 'Staff member updated successfully',
      staff: updatedStaff
    });

  } catch (error) {
    console.error('❌ Update staff error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /staff/:staffId - Delete staff member (soft delete)
app.delete('/staff/:staffId', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { staffId } = req.params;

    console.log(`🗑️ Deleting staff: ${staffId}`);

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { data: deletedStaff, error } = await client
      .from('staff')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', staffId)
      .select()
      .single();

    if (error) {
      console.error('Delete staff error:', error.message);
      return res.status(400).json({ 
        error: 'Failed to delete staff member',
        code: 'DB_DELETE_ERROR'
      });
    }

    if (!deletedStaff) {
      return res.status(404).json({ 
        error: 'Staff member not found',
        code: 'STAFF_NOT_FOUND'
      });
    }

    console.log('✅ Staff deleted successfully:', deletedStaff.staff_id);

    res.json({
      message: 'Staff member deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete staff error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ========================= STORES ENDPOINTS =========================

// Get all stores
app.get('/stores', authenticateToken, async (req, res) => {
  try {
    console.log('🔄 Get stores request received from user:', {
      userId: req.user.id,
      userRole: req.user.role,
      userCompanyId: req.user.company_id,
      userStoreId: req.user.store_id,
      queryParams: req.query
    });

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { company_id } = req.query;

    let query = client
      .from('stores')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // Apply filtering based on user role
    if (req.user.role === 'super_admin') {
      // Super admin can see all stores or filter by company
      if (company_id) {
        console.log(`👑 Super admin filtering stores by company: ${company_id}`);
        query = query.eq('company_id', company_id);
      } else {
        console.log('👑 Super admin accessing all stores');
      }
    } else if (req.user.role === 'manager') {
      // ENHANCED: Manager can see all stores in their company
      if (req.user.company_id) {
        console.log(`🏢 Manager accessing company stores: ${req.user.company_id}`);
        query = query.eq('company_id', req.user.company_id);
      } else if (req.user.store_id) {
        console.log(`🏪 Manager accessing assigned store: ${req.user.store_id}`);
        query = query.eq('id', req.user.store_id);
      }
    } else if (req.user.store_id) {
      // Other roles only see their assigned store
      console.log(`🏪 User accessing assigned store: ${req.user.store_id}`);
      query = query.eq('id', req.user.store_id);
    }

    const { data: stores, error } = await query;

    if (error) {
      console.error('❌ Failed to fetch stores:', error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch stores from database',
        code: 'DB_ERROR',
        details: error.message
      });
    }

    console.log(`✅ Retrieved ${stores?.length || 0} stores for ${req.user.role}`);

    res.json({
      stores: stores || [],
      count: stores?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get stores error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});
// Create new store
app.post('/stores', authenticateToken, requireRole(['super_admin']), async (req, res) => {
  try {
    const { name, address, phone, manager_id, company_id } = req.body;

    console.log(`📝 Creating store: ${name}`);

    if (!name || !company_id) {
      return res.status(400).json({ 
        error: 'Store name and company ID are required',
        code: 'MISSING_FIELDS'
      });
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Get company name for store record
    const { data: company } = await client
      .from('companies')
      .select('name')
      .eq('id', company_id)
      .single();

    const storeData = {
      name: name.trim(),
      address: address?.trim() || null,
      phone: phone?.trim() || null,
      manager_id: manager_id || null,
      company_id: company_id,
      company_name: company?.name || 'Unknown Company',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newStore, error: insertError } = await client
      .from('stores')
      .insert([storeData])
      .select()
      .single();

    if (insertError) {
      console.error('Database error creating store:', insertError.message);
      return res.status(400).json({ 
        error: 'Failed to create store',
        code: 'DB_INSERT_ERROR',
        details: insertError.message
      });
    }

    console.log('✅ Store created successfully:', newStore.name);

    res.status(201).json({
      message: 'Store created successfully',
      store: newStore
    });

  } catch (error) {
    console.error('❌ Create store error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ========================= SYNC ENDPOINTS UPDATES =========================

// Update the sync/all endpoint to include staff and stores
app.get('/sync/all', async (req, res) => {
  try {
    console.log('🔄 Complete sync request received');

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Get all users
    const { data: users, error: usersError } = await client
      .from('users')
      .select('id, email, name, role, phone, store_id, company_id, is_active, created_at, updated_at, last_login')
      .order('created_at', { ascending: false });

    if (usersError) {
      console.error('❌ Failed to fetch users:', usersError.message);
      return res.status(500).json({ 
        error: 'Failed to fetch users from database',
        code: 'DB_ERROR',
        details: usersError.message
      });
    }

    // Get all companies
    const { data: companies, error: companiesError } = await client
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (companiesError) {
      console.error('❌ Failed to fetch companies:', companiesError.message);
    }

    // Get all stores
    const { data: stores, error: storesError } = await client
      .from('stores')
      .select('*')
      .order('created_at', { ascending: false });

    if (storesError) {
      console.error('❌ Failed to fetch stores:', storesError.message);
    }

    // Get all staff
    const { data: staff, error: staffError } = await client
      .from('staff')
      .select('*')
      .order('created_at', { ascending: false });

    if (staffError) {
      console.error('❌ Failed to fetch staff:', staffError.message);
    }

    // Get all categories
    const { data: categories, error: categoriesError } = await client
      .from('categories')
      .select('*')
      .order('created_at', { ascending: false });

    if (categoriesError) {
      console.error('❌ Failed to fetch categories:', categoriesError.message);
    }

    // Get all products
    const { data: products, error: productsError } = await client
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (productsError) {
      console.error('❌ Failed to fetch products:', productsError.message);
    }

    const syncData = {
      users: users || [],
      companies: companies || [],
      stores: stores || [],
      staff: staff || [],
      categories: categories || [],
      products: products || [],
      counts: {
        users: users?.length || 0,
        companies: companies?.length || 0,
        stores: stores?.length || 0,
        staff: staff?.length || 0,
        categories: categories?.length || 0,
        products: products?.length || 0
      },
      timestamp: new Date().toISOString(),
      source: 'supabase'
    };

    console.log(`✅ Complete sync data prepared:`, syncData.counts);

    res.json(syncData);

  } catch (error) {
    console.error('❌ Complete sync error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error during complete sync',
      code: 'INTERNAL_ERROR'
    });
  }
});

  // Register endpoint
  app.post('/auth/register', async (req, res) => {
    try {
      const { email, password, name, role = 'cashier', phone } = req.body;

      console.log(`📝 Registration attempt for: ${email}`);

      // Validate input
      if (!email || !password || !name) {
        return res.status(400).json({ 
          error: 'Email, password, and name are required',
          code: 'MISSING_FIELDS'
        });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          error: 'Invalid email format',
          code: 'INVALID_EMAIL'
        });
      }

      // Password validation
      if (password.length < 6) {
        return res.status(400).json({ 
          error: 'Password must be at least 6 characters long',
          code: 'WEAK_PASSWORD'
        });
      }

      // Get Supabase client
      const client = await getSupabaseClient();
      
      if (!client) {
        return res.status(503).json({
          error: 'Registration unavailable - database connection failed',
          code: 'SERVICE_UNAVAILABLE'
        });
      }

      // Check if user already exists
      const { data: existingUser, error: checkError } = await client
        .from('users')
        .select('id, email')
        .eq('email', email.toLowerCase())
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Database error checking user:', checkError.message);
        return res.status(500).json({ 
          error: 'Database error while checking user',
          code: 'DB_ERROR'
        });
      }

      if (existingUser) {
        return res.status(409).json({ 
          error: 'User with this email already exists',
          code: 'USER_EXISTS'
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Prepare user data
      const userData = {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name: name.trim(),
        role: role,
        is_active: true,
        created_at: new Date().toISOString()
      };

      // Add phone if provided
      if (phone && phone.trim()) {
        userData.phone = phone.trim();
      }

      // Create user
      const { data: user, error: insertError } = await client
        .from('users')
        .insert([userData])
        .select('id, email, name, role, phone, is_active, created_at')
        .single();

      if (insertError) {
        console.error('Database error creating user:', insertError.message);
        
        if (insertError.code === '23505') {
          return res.status(409).json({ 
            error: 'User with this email already exists',
            code: 'USER_EXISTS'
          });
        }
        
        return res.status(400).json({ 
          error: 'Failed to create user account',
          code: 'DB_INSERT_ERROR',
          details: insertError.message
        });
      }

      console.log('✅ User created successfully:', user.email);

      // Generate JWT token
      const token = generateToken(user);

      res.status(201).json({
        message: 'User registered successfully',
        user,
        token,
        source: 'supabase'
      });

    } catch (error) {
      console.error('❌ Registration error:', error.message);
      res.status(500).json({ 
        error: 'Internal server error during registration',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // Get user profile
  app.get('/auth/profile', authenticateToken, async (req, res) => {
    try {
      const client = await getSupabaseClient();
      
      if (!client) {
        // Return cached user info from JWT
        return res.json({ 
          user: req.user,
          source: 'fallback'
        });
      }

      const { data: user, error } = await client
        .from('users')
        .select('id, email, name, role, phone, is_active, created_at, last_login')
        .eq('id', req.user.id)
        .single();

      if (error || !user) {
        return res.status(404).json({ 
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      res.json({ user, source: 'supabase' });

    } catch (error) {
      console.error('Profile error:', error.message);
      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // FIXED: Logout endpoint with optional authentication
  app.post('/auth/logout', optionalAuthentication, (req, res) => {
    // Always return success for logout, regardless of token validity
    // This prevents 403 errors when tokens are expired/invalid
    
    if (req.user) {
      console.log(`✅ User logged out: ${req.user.email}`);
    } else {
      console.log(`✅ Logout request processed (no valid token found)`);
    }
    
    res.json({ 
      message: 'Logout successful',
      code: 'LOGOUT_SUCCESS'
    });
  });

  // Get all users endpoint (for admin/manager)
  app.get('/users', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
    try {
      const client = await getSupabaseClient();
      
      if (!client) {
        return res.status(503).json({
          error: 'Database unavailable',
          code: 'SERVICE_UNAVAILABLE'
        });
      }

      const { page = 1, limit = 50, role, active } = req.query;
      const offset = (page - 1) * limit;

      let query = client
        .from('users')
        .select('id, email, name, role, phone, is_active, created_at, last_login', { count: 'exact' });

      // Apply filters
      if (role) {
        query = query.eq('role', role);
      }
      if (active !== undefined) {
        query = query.eq('is_active', active === 'true');
      }

      // Apply pagination
      query = query.range(offset, offset + limit - 1);
      query = query.order('created_at', { ascending: false });

      const { data: users, error, count } = await query;

      if (error) {
        console.error('Get users error:', error.message);
        return res.status(500).json({ 
          error: 'Database query failed',
          code: 'DB_ERROR'
        });
      }

      res.json({
        users: users || [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      });

    } catch (error) {
      console.error('Get users error:', error.message);
      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // Add these endpoints to your server.js file

// ========================= CATEGORIES ENDPOINTS =========================

// GET /categories - Fetch categories with store filtering
app.get('/categories', authenticateToken, requireRole(['super_admin', 'manager', 'cashier']), async (req, res) => {
  try {
    console.log('🔄 Get categories request from user:', {
      userId: req.user.id,
      userRole: req.user.role,
      userStoreId: req.user.store_id
    });

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    let query = client
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    // Apply filtering based on user role
    if (req.user.role === 'manager' && req.user.store_id) {
      console.log(`🏪 Manager filtering categories by store: ${req.user.store_id}`);
      query = query.eq('store_id', req.user.store_id);
    } else if (req.user.role === 'cashier' && req.user.store_id) {
      console.log(`🏪 Cashier filtering categories by store: ${req.user.store_id}`);
      query = query.eq('store_id', req.user.store_id);
    } else if (req.user.role === 'super_admin') {
      const { store_id } = req.query;
      if (store_id) {
        console.log(`👑 Super admin filtering categories by store: ${store_id}`);
        query = query.eq('store_id', store_id);
      } else {
        console.log('👑 Super admin accessing all categories');
      }
    }

    const { data: categories, error } = await query;

    if (error) {
      console.error('❌ Failed to fetch categories:', error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch categories from database',
        code: 'DB_ERROR',
        details: error.message
      });
    }

    console.log(`✅ Retrieved ${categories?.length || 0} categories`);

    res.json({
      categories: categories || [],
      count: categories?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get categories error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /categories - Create new category
app.post('/categories', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { name, description, color, icon, store_id } = req.body;

    console.log(`📝 Creating category: ${name} by user ${req.user.role}:${req.user.id}`);

    // Validate required fields
    if (!name || !store_id) {
      return res.status(400).json({ 
        error: 'Category name and store ID are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate store access for managers
    if (req.user.role === 'manager' && req.user.store_id) {
      if (store_id !== req.user.store_id) {
        return res.status(403).json({
          error: 'Managers can only create categories for their assigned store',
          code: 'STORE_ACCESS_DENIED'
        });
      }
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Create category
    const categoryData = {
      name: name.trim(),
      description: description || '',
      color: color || '#3b82f6',
      icon: icon || 'cube-outline',
      store_id: store_id,
      is_active: true,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newCategory, error: insertError } = await client
      .from('categories')
      .insert([categoryData])
      .select()
      .single();

    if (insertError) {
      console.error('Database error creating category:', insertError.message);
      return res.status(400).json({ 
        error: 'Failed to create category',
        code: 'DB_INSERT_ERROR',
        details: insertError.message
      });
    }

    console.log('✅ Category created successfully:', newCategory.name);

    res.status(201).json({
      message: 'Category created successfully',
      category: newCategory
    });

  } catch (error) {
    console.error('❌ Create category error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ========================= PRODUCTS ENDPOINTS =========================

// GET /products - Fetch products with store filtering and search
app.get('/products', authenticateToken, requireRole(['super_admin', 'manager', 'cashier']), async (req, res) => {
  try {
    console.log('🔄 Get products request from user:', {
      userId: req.user.id,
      userRole: req.user.role,
      userStoreId: req.user.store_id,
      queryParams: req.query
    });

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { category_id, search, limit = 100 } = req.query;

    let query = client
      .from('products')
      .select(`
        *,
        categories:category_id (
          id,
          name,
          color,
          icon
        )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(parseInt(limit));

    // Apply filtering based on user role
    if (req.user.role === 'manager' && req.user.store_id) {
      console.log(`🏪 Manager filtering products by store: ${req.user.store_id}`);
      query = query.eq('store_id', req.user.store_id);
    } else if (req.user.role === 'cashier' && req.user.store_id) {
      console.log(`🏪 Cashier filtering products by store: ${req.user.store_id}`);
      query = query.eq('store_id', req.user.store_id);
    } else if (req.user.role === 'super_admin') {
      const { store_id } = req.query;
      if (store_id) {
        console.log(`👑 Super admin filtering products by store: ${store_id}`);
        query = query.eq('store_id', store_id);
      } else {
        console.log('👑 Super admin accessing all products');
      }
    }

    // Category filter
    if (category_id) {
      query = query.eq('category_id', category_id);
    }

    // Search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,barcode.ilike.%${search}%`);
    }

    const { data: products, error } = await query;

    if (error) {
      console.error('❌ Failed to fetch products:', error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch products from database',
        code: 'DB_ERROR',
        details: error.message
      });
    }

    console.log(`✅ Retrieved ${products?.length || 0} products`);

    res.json({
      products: products || [],
      count: products?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get products error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /products - Create new product
app.post('/products', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { 
      name, description, sku, barcode, category_id, store_id,
      default_price, manila_price, delivery_price, wholesale_price,
      stock_quantity, min_stock_level, max_stock_level, unit,
      weight, dimensions, image_url, images, is_featured, tags
    } = req.body;

    console.log(`📝 Creating product: ${name} by user ${req.user.role}:${req.user.id}`);

    // Validate required fields
    if (!name || !store_id || !default_price) {
      return res.status(400).json({ 
        error: 'Product name, store ID, and default price are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate store access for managers
    if (req.user.role === 'manager' && req.user.store_id) {
      if (store_id !== req.user.store_id) {
        return res.status(403).json({
          error: 'Managers can only create products for their assigned store',
          code: 'STORE_ACCESS_DENIED'
        });
      }
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Check if SKU already exists
    if (sku) {
      const { data: existingProduct } = await client
        .from('products')
        .select('id, sku')
        .eq('sku', sku.trim().toUpperCase())
        .eq('is_active', true)
        .single();

      if (existingProduct) {
        return res.status(409).json({ 
          error: `SKU "${sku}" already exists`,
          code: 'SKU_EXISTS'
        });
      }
    }

    // Create product
    const productData = {
      name: name.trim(),
      description: description || '',
      sku: sku ? sku.trim().toUpperCase() : null,
      barcode: barcode || null,
      category_id: category_id || null,
      store_id: store_id,
      default_price: parseFloat(default_price),
      manila_price: manila_price ? parseFloat(manila_price) : null,
      delivery_price: delivery_price ? parseFloat(delivery_price) : null,
      wholesale_price: wholesale_price ? parseFloat(wholesale_price) : null,
      stock_quantity: parseInt(stock_quantity || 0),
      min_stock_level: parseInt(min_stock_level || 5),
      max_stock_level: parseInt(max_stock_level || 100),
      unit: unit || 'pcs',
      weight: weight ? parseFloat(weight) : null,
      dimensions: dimensions || null,
      image_url: image_url || null,
      images: images || null,
      is_active: true,
      is_featured: is_featured || false,
      tags: tags || null,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newProduct, error: insertError } = await client
      .from('products')
      .insert([productData])
      .select(`
        *,
        categories:category_id (
          id,
          name,
          color,
          icon
        )
      `)
      .single();

    if (insertError) {
      console.error('Database error creating product:', insertError.message);
      return res.status(400).json({ 
        error: 'Failed to create product',
        code: 'DB_INSERT_ERROR',
        details: insertError.message
      });
    }

    console.log('✅ Product created successfully:', newProduct.name);

    res.status(201).json({
      message: 'Product created successfully',
      product: newProduct
    });

  } catch (error) {
    console.error('❌ Create product error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /products/:productId - Update product
app.put('/products/:productId', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { productId } = req.params;
    const updates = req.body;

    console.log(`📝 Updating product: ${productId}`);

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Prepare update data
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    // Remove fields that shouldn't be updated
    delete updateData.id;
    delete updateData.created_at;
    delete updateData.created_by;

    const { data: updatedProduct, error } = await client
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .select(`
        *,
        categories:category_id (
          id,
          name,
          color,
          icon
        )
      `)
      .single();

    if (error) {
      console.error('Update product error:', error.message);
      return res.status(400).json({ 
        error: 'Failed to update product',
        code: 'DB_UPDATE_ERROR',
        details: error.message
      });
    }

    if (!updatedProduct) {
      return res.status(404).json({ 
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    console.log('✅ Product updated successfully:', updatedProduct.name);

    res.json({
      message: 'Product updated successfully',
      product: updatedProduct
    });

  } catch (error) {
    console.error('❌ Update product error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /products/:productId - Delete product (soft delete)
app.delete('/products/:productId', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { productId } = req.params;

    console.log(`🗑️ Deleting product: ${productId}`);

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { data: deletedProduct, error } = await client
      .from('products')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', productId)
      .select()
      .single();

    if (error) {
      console.error('Delete product error:', error.message);
      return res.status(400).json({ 
        error: 'Failed to delete product',
        code: 'DB_DELETE_ERROR'
      });
    }

    if (!deletedProduct) {
      return res.status(404).json({ 
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    console.log('✅ Product deleted successfully:', deletedProduct.name);

    res.json({
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete product error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ========================= INVENTORY ENDPOINTS =========================

// GET /inventory/movements - Get inventory movements
app.get('/inventory/movements', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    console.log('🔄 Get inventory movements request');

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { product_id, limit = 50 } = req.query;

    let query = client
      .from('inventory_movements')
      .select(`
        *,
        products:product_id (
          id,
          name,
          sku
        )
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    // Apply filtering based on user role
    if (req.user.role === 'manager' && req.user.store_id) {
      query = query.eq('store_id', req.user.store_id);
    }

    if (product_id) {
      query = query.eq('product_id', product_id);
    }

    const { data: movements, error } = await query;

    if (error) {
      console.error('❌ Failed to fetch inventory movements:', error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch inventory movements',
        code: 'DB_ERROR',
        details: error.message
      });
    }

    res.json({
      movements: movements || [],
      count: movements?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get inventory movements error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /inventory/adjust - Adjust product stock
app.post('/inventory/adjust', authenticateToken, requireRole(['super_admin', 'manager']), async (req, res) => {
  try {
    const { product_id, new_quantity, movement_type = 'adjustment', notes = '' } = req.body;

    console.log(`📦 Adjusting stock for product: ${product_id} to ${new_quantity}`);

    if (!product_id || new_quantity === undefined) {
      return res.status(400).json({ 
        error: 'Product ID and new quantity are required',
        code: 'MISSING_FIELDS'
      });
    }

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Get current product stock
    const { data: product, error: productError } = await client
      .from('products')
      .select('stock_quantity, store_id, name')
      .eq('id', product_id)
      .single();

    if (productError || !product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    const previousStock = product.stock_quantity;
    const quantity = new_quantity - previousStock;

    // Update product stock
    const { error: updateError } = await client
      .from('products')
      .update({ 
        stock_quantity: new_quantity,
        updated_at: new Date().toISOString()
      })
      .eq('id', product_id);

    if (updateError) {
      console.error('Error updating product stock:', updateError.message);
      return res.status(400).json({
        error: 'Failed to update product stock',
        code: 'DB_UPDATE_ERROR'
      });
    }

    // Record inventory movement
    const movementData = {
      product_id: product_id,
      store_id: product.store_id,
      movement_type: movement_type,
      quantity: quantity,
      previous_stock: previousStock,
      new_stock: new_quantity,
      notes: notes,
      created_by: req.user.id,
      created_at: new Date().toISOString()
    };

    const { data: movement, error: movementError } = await client
      .from('inventory_movements')
      .insert([movementData])
      .select()
      .single();

    if (movementError) {
      console.error('Error recording inventory movement:', movementError.message);
      // Don't fail the request if movement recording fails
    }

    console.log(`✅ Stock updated for ${product.name}: ${previousStock} → ${new_quantity}`);

    res.json({
      message: 'Stock updated successfully',
      product_id: product_id,
      previous_stock: previousStock,
      new_stock: new_quantity,
      movement: movement
    });

  } catch (error) {
    console.error('❌ Adjust stock error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ========================= STATISTICS ENDPOINTS =========================

// GET /products/stats - Get product statistics
app.get('/products/stats', authenticateToken, requireRole(['super_admin', 'manager', 'cashier']), async (req, res) => {
  try {
    console.log('📊 Get product stats request');

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    let storeFilter = '';
    let storeParams = [];

    // Apply store filtering based on user role
    if (req.user.role === 'manager' && req.user.store_id) {
      storeFilter = 'AND store_id = $1';
      storeParams = [req.user.store_id];
    } else if (req.user.role === 'cashier' && req.user.store_id) {
      storeFilter = 'AND store_id = $1';
      storeParams = [req.user.store_id];
    }

    // Get total products
    const { data: totalProducts } = await client
      .rpc('count_products', { store_filter: req.user.store_id || null });

    // Get total categories
    const { data: totalCategories } = await client
      .rpc('count_categories', { store_filter: req.user.store_id || null });

    // Get low stock products
    const { data: lowStockProducts } = await client
      .rpc('count_low_stock_products', { store_filter: req.user.store_id || null });

    // Get out of stock products
    const { data: outOfStockProducts } = await client
      .rpc('count_out_of_stock_products', { store_filter: req.user.store_id || null });

    const stats = {
      totalProducts: totalProducts || 0,
      totalCategories: totalCategories || 0,
      lowStockProducts: lowStockProducts || 0,
      outOfStockProducts: outOfStockProducts || 0
    };

    res.json({
      stats: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get product stats error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

app.get('/companies', authenticateToken, requireRole(['super_admin']), async (req, res) => {
  try {
    console.log('🔄 Get companies request received');

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { data: companies, error } = await client
      .from('companies')
      .select(`
        *,
        stores:stores(count)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Failed to fetch companies:', error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch companies from database',
        code: 'DB_ERROR',
        details: error.message
      });
    }

    console.log(`✅ Retrieved ${companies?.length || 0} companies`);

    res.json({
      companies: companies || [],
      count: companies?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get companies error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});
app.get('/companies', authenticateToken, requireRole(['super_admin']), async (req, res) => {
  try {
    console.log('🔄 Get companies request received');

    const client = await getSupabaseClient();
    
    if (!client) {
      return res.status(503).json({
        error: 'Database connection not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const { data: companies, error } = await client
      .from('companies')
      .select(`
        *,
        stores:stores(count)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Failed to fetch companies:', error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch companies from database',
        code: 'DB_ERROR',
        details: error.message
      });
    }

    console.log(`✅ Retrieved ${companies?.length || 0} companies`);

    res.json({
      companies: companies || [],
      count: companies?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get companies error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
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

  // For Vercel, we need to export the app
  module.exports = app;

  // Only start server locally (not on Vercel)
  if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  }