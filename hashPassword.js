// hashPassword.js
const bcrypt = require('bcrypt');

const password = '1234';

bcrypt.hash(password, 10)
  .then(hash => {
    console.log('\n=== COPY THIS HASH ===');
    console.log(hash);
    console.log('======================\n');
    console.log('Length:', hash.length);
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });