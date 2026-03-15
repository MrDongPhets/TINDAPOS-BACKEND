// debug-env.js - Debug Environment Variables
require('dotenv').config();

console.log('🔍 Environment Variables Debug Report');
console.log('=====================================');
console.log(`Node Environment: ${process.env.NODE_ENV || 'not set'}`);
console.log(`Current Working Directory: ${process.cwd()}`);
console.log('');

// Check required environment variables
const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 
  'SUPABASE_ANON_KEY',
  'JWT_SECRET'
];

console.log('Required Environment Variables:');
requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    // Show first 10 and last 5 characters for security
    const masked = value.length > 15 
      ? `${value.substring(0, 10)}...${value.substring(value.length - 5)}`
      : value.substring(0, 10) + '...';
    console.log(`✅ ${varName}: ${masked} (length: ${value.length})`);
  } else {
    console.log(`❌ ${varName}: NOT SET`);
  }
});

console.log('');
console.log('Optional Variables:');
const optionalVars = ['PORT', 'CORS_ORIGIN', 'DATABASE_URL'];
optionalVars.forEach(varName => {
  const value = process.env[varName];
  console.log(`${value ? '✅' : '⚠️'} ${varName}: ${value || 'not set'}`);
});

// Test Supabase URL format
console.log('');
console.log('URL Validation:');
const supabaseUrl = process.env.SUPABASE_URL;
if (supabaseUrl) {
  try {
    const url = new URL(supabaseUrl);
    console.log(`✅ SUPABASE_URL format: ${url.protocol}//${url.hostname}`);
  } catch (error) {
    console.log(`❌ SUPABASE_URL format invalid: ${error.message}`);
  }
} else {
  console.log('❌ SUPABASE_URL not set');
}

// Check .env file existence
const fs = require('fs');
const path = require('path');

console.log('');
console.log('File System Check:');
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const stats = fs.statSync(envPath);
  console.log(`✅ .env file exists (${stats.size} bytes, modified: ${stats.mtime})`);
} else {
  console.log('❌ .env file not found at:', envPath);
}

console.log('');
console.log('Recommendations:');
const missingVars = requiredVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.log('❌ Missing required variables:', missingVars.join(', '));
  console.log('📝 Create a .env file in your project root with:');
  missingVars.forEach(varName => {
    console.log(`   ${varName}=your_value_here`);
  });
} else {
  console.log('✅ All required environment variables are set');
  console.log('🚀 Ready to start the server');
}

console.log('');
console.log('Test Commands:');
console.log('node debug-env.js    - Run this debug script');
console.log('node server-new.js   - Start the server'); 
console.log('=====================================');