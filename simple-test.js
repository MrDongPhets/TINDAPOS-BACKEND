// simple-test.js - Simple connection test
const axios = require('axios');

const SERVER_URL = 'http://10.151.5.198:3000';

async function testConnection() {
  console.log('🔍 Testing connection to:', SERVER_URL);
  console.log('='.repeat(50));
  
  try {
    // Test 1: Basic server connection
    console.log('1. Testing basic server connection...');
    const response = await axios.get(`${SERVER_URL}/`, { timeout: 5000 });
    console.log('✅ Server is running:', response.data.message);
    
    // Test 2: Health check
    console.log('\n2. Testing health endpoint...');
    const healthResponse = await axios.get(`${SERVER_URL}/health`, { timeout: 5000 });
    console.log('✅ Health check result:');
    console.log(`   Status: ${healthResponse.data.status}`);
    console.log(`   Database: ${healthResponse.data.database}`);
    console.log(`   User Count: ${healthResponse.data.user_count}`);
    
    // Test 3: Login test
    console.log('\n3. Testing login...');
    const loginResponse = await axios.post(`${SERVER_URL}/auth/login`, {
      email: 'admin@techcorp.com',
      password: 'password123'
    }, { timeout: 5000 });
    
    console.log('✅ Login successful:');
    console.log(`   User: ${loginResponse.data.user.name}`);
    console.log(`   Role: ${loginResponse.data.user.role}`);
    console.log(`   Source: ${loginResponse.data.source}`);
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 ALL TESTS PASSED!');
    console.log('✅ Your React Native app can now connect to this server');
    console.log('✅ Make sure your React Native authService uses: http://10.151.5.198:3000');
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('\n❌ Connection test failed:');
    
    if (error.code === 'ECONNREFUSED') {
      console.error('   - Server is not running or not accessible');
      console.error('   - Make sure your server is started with: node server.js');
      console.error('   - Check if port 3000 is not blocked by firewall');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('   - Request timed out');
      console.error('   - Check network connection');
      console.error('   - Verify IP address is correct');
    } else {
      console.error('   - Error:', error.message);
      if (error.response) {
        console.error('   - Status:', error.response.status);
        console.error('   - Data:', error.response.data);
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🔧 TROUBLESHOOTING STEPS:');
    console.log('1. Make sure server is running: node server.js');
    console.log('2. Check server logs for any errors');
    console.log('3. Verify .env file has correct Supabase credentials');
    console.log('4. Try accessing http://10.151.5.198:3000/health in browser');
    console.log('5. Check Windows Firewall settings for port 3000');
    console.log('='.repeat(50));
  }
}

// Run the test
testConnection();