#!/usr/bin/env node
import { createUserSync } from './auth.js';

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'changeme';
const role = process.argv[4] || 'admin';

try {
  const u = createUserSync({ username, password, role });
  console.log('Created user:', u);
} catch (e) {
  console.error('Error creating user:', e.message);
  process.exit(1);
}

