// test-api.js - Test script to verify all API endpoints
const axios = require('axios');

const BASE_URL = 'http://10.151.5.198:3000'; // Replace with your actual API URL
let authToken = null;

// Test functions
async function testHealthCheck() {
  console.log('🔍 Testing Health Check...');
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health Check:', response.data);
    return response.data.status === 'healthy';
  } catch (error) {
    console.error('❌ Health Check Failed:', error.message);
    return false;
  }
}

async function testLogin() {
  console.log('\n🔐 Testing Login...');
  try {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin@techcorp.com',
      password: 'password123'
    });
    
    authToken = response.data.token;
    console.log('✅ Login Successful:');
    console.log('   User:', response.data.user.name);
    console.log('   Role:', response.data.user.role);
    console.log('   Email:', response.data.user.email);
    console.log('   Token:', authToken.substring(0, 50) + '...');
    return true;
  } catch (error) {
    console.error('❌ Login Failed:', error.response?.data || error.message);
    return false;
  }
}

async function testGetProfile() {
  console.log('\n👤 Testing Get Profile...');
  try {
    const response = await axios.get(`${BASE_URL}/auth/profile`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Profile Retrieved:');
    console.log('   Name:', response.data.user.name);
    console.log('   Email:', response.data.user.email);
    console.log('   Role:', response.data.user.role);
    console.log('   Created:', response.data.user.created_at);
    return true;
  } catch (error) {
    console.error('❌ Get Profile Failed:', error.response?.data || error.message);
    return false;
  }
}

async function testGetUsers() {
  console.log('\n👥 Testing Get Users (Admin Only)...');
  try {
    const response = await axios.get(`${BASE_URL}/users`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Users Retrieved:');
    console.log('   Total Users:', response.data.total);
    response.data.users.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.name} (${user.email}) - ${user.role}`);
    });
    return true;
  } catch (error) {
    console.error('❌ Get Users Failed:', error.response?.data || error.message);
    return false;
  }
}

async function testGetProducts() {
  console.log('\n🛍️  Testing Get Products...');
  try {
    const response = await axios.get(`${BASE_URL}/products`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Products Retrieved:');
    console.log('   Total Products:', response.data.total);
    response.data.products.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} - $${product.price} (Stock: ${product.stock_quantity})`);
    });
    return true;
  } catch (error) {
    console.error('❌ Get Products Failed:', error.response?.data || error.message);
    return false;
  }
}

async function testGetCategories() {
  console.log('\n📂 Testing Get Categories...');
  try {
    const response = await axios.get(`${BASE_URL}/categories`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Categories Retrieved:');
    console.log('   Total Categories:', response.data.total);
    response.data.categories.forEach((category, index) => {
      console.log(`   ${index + 1}. ${category.name} - ${category.description}`);
    });
    return true;
  } catch (error) {
    console.error('❌ Get Categories Failed:', error.response?.data || error.message);
    return false;
  }
}

async function testRegistration() {
  console.log('\n📝 Testing User Registration...');
  try {
    const response = await axios.post(`${BASE_URL}/auth/register`, {
      email: `test.user.${Date.now()}@example.com`,
      password: 'testpassword123',
      name: 'Test User',
      role: 'cashier'
    });
    
    console.log('✅ Registration Successful:');
    console.log('   User:', response.data.user.name);
    console.log('   Email:', response.data.user.email);
    console.log('   Role:', response.data.user.role);
    return true;
  } catch (error) {
    console.error('❌ Registration Failed:', error.response?.data || error.message);
    return false;
  }
}

async function testInvalidLogin() {
  console.log('\n🚫 Testing Invalid Login...');
  try {
    await axios.post(`${BASE_URL}/auth/login`, {
      email: 'invalid@test.com',
      password: 'wrongpassword'
    });
    console.error('❌ Invalid login should have failed!');
    return false;
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Invalid Login Properly Rejected:', error.response.data.error);
      return true;
    } else {
      console.error('❌ Unexpected error:', error.message);
      return false;
    }
  }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting API Tests for POS System Backend\n');
  console.log('=' .repeat(60));
  
  const tests = [
    { name: 'Health Check', func: testHealthCheck },
    { name: 'Login', func: testLogin },
    { name: 'Get Profile', func: testGetProfile },
    { name: 'Get Users', func: testGetUsers },
    { name: 'Get Products', func: testGetProducts },
    { name: 'Get Categories', func: testGetCategories },
    { name: 'Registration', func: testRegistration },
    { name: 'Invalid Login', func: testInvalidLogin }
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const result = await test.func();
      results.push({ name: test.name, success: result });
    } catch (error) {
      console.error(`❌ ${test.name} threw unexpected error:`, error.message);
      results.push({ name: test.name, success: false });
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  let passed = 0;
  results.forEach(result => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${result.name}`);
    if (result.success) passed++;
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`📈 Tests Passed: ${passed}/${results.length}`);
  
  if (passed === results.length) {
    console.log('🎉 ALL TESTS PASSED! Your API is working correctly!');
    console.log('✅ Node.js server is connected to Supabase');
    console.log('✅ Authentication is working');
    console.log('✅ Database queries are successful');
    console.log('✅ Your React Native app can now connect to this API');
  } else {
    console.log('⚠️  Some tests failed. Check the errors above.');
  }
  
  console.log('='.repeat(60));
}

// Run tests
runAllTests().catch(console.error);