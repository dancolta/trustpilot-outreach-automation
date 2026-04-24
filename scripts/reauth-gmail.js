#!/usr/bin/env node
import 'dotenv/config';
import { getMyEmail } from './src/gmail.js';

console.log('\n🔐 Gmail Re-Authentication\n');
console.log('This will refresh your Gmail access token...\n');

try {
  // This will trigger re-auth if token is invalid
  const email = await getMyEmail();
  console.log(`✅ Successfully authenticated as: ${email}\n`);
} catch (error) {
  console.error('❌ Authentication failed:', error.message);
  process.exit(1);
}
