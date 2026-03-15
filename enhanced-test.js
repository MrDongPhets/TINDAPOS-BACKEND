// enhanced-test.js - Comprehensive connection and debugging tool
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SERVER_URL = 'http://10.151.5.198:3000';

console.log('🔧 POS System - Enhanced Connection Test & Debug Tool');
console.log('=' .repeat(60));

async function runDiagnostics() {
  console.log('🔍 PHASE 1: ENVIRONMENT CHECK');
  console.log('-'.repeat(40));
  
  // Check environment variables
  const envVars = {
    'SUPABASE_URL': process.env.SUPABASE_URL,
    'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY ? '[PRESENT]' : '[MISSING]',
    'JWT_SECRET': process.env.JWT_SECRET ? '[PRESENT]' : '[MISSING]'
  };
  
  console.log('📋 Environment Variables:');
  Object.entries(envVars).forEach(([key, value]) => {
    const status = value && value !== '[MISSING]' ? '✅' : '❌';
    console.log(`   ${status} ${key}: ${value}`);
  });
  
  console.log('\n🔍 PHASE 2: DIRECT SUPABASE TEST');
  console.log('-'.repeat(40));
  
  // Test direct Supabase connection
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await testDirectSupabase();
  } else {
    console.log('❌ Cannot test Supabase - missing credentials');
  }
  
  console.log('\n🔍 PHASE 3: SERVER CONNECTION TEST');
  console.log('-'.repeat(40));
  
  // Test server connection
  await testServerConnection();
  
  console.log('\n🔍 PHASE 4: AUTHENTICATION TEST');
  console.log('-'.repeat(40));
  
  // Test authentication endpoints
  await testAuthentication();
  
  console.log('\n📊 DIAGNOSIS COMPLETE');
  console.log('='.repeat(60));
}

async function testDirectSupabase() {
  try {
    console.log('🧪 Testing direct Supabase connection...');
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log(`   📍 URL: ${supabaseUrl}`);
    console.log(`   🔑 Key: ${supabaseKey.substring(0, 20)}...`);
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    console.log('   ⏳ Attempting database query...');
    
    // Try a simple query
    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .limit(1);
    
    if (error) {
      console.log('   ❌ Direct Supabase query failed:');
      console.log(`      Code: ${error.code}`);
      console.log(`      Message: ${error.message}`);
      console.log(`      Details: ${error.details || 'None'}`);
      console.log(`      Hint: ${error.hint || 'None'}`);
      
      // Provide specific troubleshooting
      if (error.code === 'PGRST116') {
        console.log('   💡 SOLUTION: The "users" table doesn\'t exist in your Supabase project');
        console.log('      → Go to Supabase Dashboard → SQL Editor');
        console.log('      → Run the table creation SQL script');
      } else if (error.message.includes('permission')) {
        console.log('   💡 SOLUTION: Permission issue detected');
        console.log('      → Check your Row Level Security (RLS) policies');
        console.log('      → Ensure service role key has proper permissions');
      } else if (error.message.includes('connection')) {
        console.log('   💡 SOLUTION: Connection issue detected');
        console.log('      → Check your internet connection');
        console.log('      → Verify Supabase project is not paused');
      }
      
      return false;
    }
    
    console.log(`   ✅ Direct Supabase connection successful!`);
    console.log(`      Query executed, count: ${count || 'unknown'}`);
    return true;
    
  } catch (error) {
    console.log('   ❌ Direct Supabase test failed with exception:');
    console.log(`      ${error.message}`);
    return false;
  }
}

async function testServerConnection() {
  try {
    console.log('🌐 Testing server connection...');
    
    // Test 1: Basic server ping
    console.log('   1️⃣ Basic server ping...');
    try {
      const response = await axios.get(`${SERVER_URL}/`, { timeout: 5000 });
      console.log('   ✅ Server is responding');
      console.log(`      Message: ${response.data.message}`);
      console.log(`      Database Status: ${response.data.database}`);
    } catch (error) {
      console.log('   ❌ Server ping failed:');
      if (error.code === 'ECONNREFUSED') {
        console.log('      → Server is not running or not accessible');
        console.log('      → Start server with: node server.js');
        console.log('      → Check if port 3000 is blocked by firewall');
        return false;
      } else {
        console.log(`      → ${error.message}`);
        return false;
      }
    }
    
    // Test 2: Health endpoint
    console.log('   2️⃣ Health endpoint check...');
    try {
      const healthResponse = await axios.get(`${SERVER_URL}/health`, { timeout: 10000 });
      console.log('   ✅ Health endpoint successful');
      console.log(`      Status: ${healthResponse.data.status}`);
      console.log(`      Database: ${healthResponse.data.database}`);
      console.log(`      Response Time: ${healthResponse.data.response_time_ms}ms`);
      
      if (healthResponse.data.error) {
        console.log(`      Error: ${healthResponse.data.error}`);
      }
      
      if (healthResponse.data.troubleshooting) {
        console.log('      💡 Server suggestions:');
        healthResponse.data.troubleshooting.forEach((tip, index) => {
          console.log(`         ${index + 1}. ${tip}`);
        });
      }
      
      return healthResponse.data.status === 'healthy';
      
    } catch (error) {
      console.log('   ❌ Health endpoint failed:');
      if (error.response) {
        console.log(`      Status: ${error.response.status}`);
        console.log(`      Data:`, error.response.data);
        
        if (error.response.data.troubleshooting) {
          console.log('      💡 Server suggestions:');
          error.response.data.troubleshooting.forEach((tip, index) => {
            console.log(`         ${index + 1}. ${tip}`);
          });
        }
      } else {
        console.log(`      → ${error.message}`);
      }
      return false;
    }
    
  } catch (error) {
    console.log('❌ Server connection test failed:', error.message);
    return false;
  }
}

async function testAuthentication() {
  try {
    console.log('🔐 Testing authentication...');
    
    const testCredentials = [
      { email: 'admin@techcorp.com', password: 'password123', role: 'admin' },
      { email: 'manager@techcorp.com', password: 'password123', role: 'manager' },
      { email: 'cashier@techcorp.com', password: 'password123', role: 'cashier' }
    ];
    
    let successCount = 0;
    
    for (const creds of testCredentials) {
      try {
        console.log(`   🧪 Testing ${creds.role} login...`);
        
        const loginResponse = await axios.post(`${SERVER_URL}/auth/login`, {
          email: creds.email,
          password: creds.password
        }, { timeout: 10000 });
        
        console.log(`   ✅ ${creds.role} login successful`);
        console.log(`      User: ${loginResponse.data.user.name}`);
        console.log(`      Source: ${loginResponse.data.source}`);
        successCount++;
        
        // Test profile endpoint with the token
        try {
          const profileResponse = await axios.get(`${SERVER_URL}/auth/profile`, {
            headers: {
              'Authorization': `Bearer ${loginResponse.data.token}`
            },
            timeout: 5000
          });
          console.log(`      ✅ Profile fetch successful`);
        } catch (profileError) {
          console.log(`      ⚠️  Profile fetch failed: ${profileError.response?.status || profileError.message}`);
        }
        
      } catch (error) {
        console.log(`   ❌ ${creds.role} login failed:`);
        if (error.response) {
          console.log(`      Status: ${error.response.status}`);
          console.log(`      Message: ${error.response.data.error || error.response.data.message}`);
          console.log(`      Source: ${error.response.data.source || 'unknown'}`);
        } else {
          console.log(`      → ${error.message}`);
        }
      }
      
      console.log(''); // Add spacing between tests
    }
    
    console.log(`📊 Authentication Summary: ${successCount}/${testCredentials.length} logins successful`);
    return successCount > 0;
    
  } catch (error) {
    console.log('❌ Authentication test failed:', error.message);
    return false;
  }
}

// Generate database setup SQL
function generateSetupSQL() {
  return `
-- POS System Database Schema
-- Run this in your Supabase SQL Editor

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'cashier',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE
);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  cost DECIMAL(10,2),
  stock_quantity INTEGER DEFAULT 0,
  category_id BIGINT REFERENCES categories(id),
  barcode VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- Insert demo admin user (password: password123)
INSERT INTO users (email, password, name, role, is_active)
VALUES ('admin@techcorp.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LTaFNNFVVkA9YJzWu', 'Demo Admin', 'super_admin', true)
ON CONFLICT (email) DO NOTHING;

-- Success message
SELECT 'Database setup completed successfully!' as message;
`;
}

async function main() {
  await runDiagnostics();
  
  console.log('\n🛠️  NEXT STEPS:');
  console.log('-'.repeat(40));
  console.log('1. If Supabase connection failed:');
  console.log('   → Copy the SQL below to your Supabase SQL Editor');
  console.log('   → Run it to create the required tables');
  console.log('');
  console.log('2. If server is not running:');
  console.log('   → Run: node server.js');
  console.log('   → Check for any startup errors');
  console.log('');
  console.log('3. If authentication failed:');
  console.log('   → Ensure demo users are created');
  console.log('   → Check server logs for detailed errors');
  console.log('');
  console.log('📋 DATABASE SETUP SQL:');
  console.log('─'.repeat(60));
  console.log(generateSetupSQL());
  console.log('─'.repeat(60));
  console.log('');
  console.log('✅ Copy the SQL above and paste it in:');
  console.log('   https://supabase.com/dashboard/project/[your-project]/sql');
  console.log('');
}

// Run diagnostics
main().catch(console.error);