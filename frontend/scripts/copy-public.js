const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'public');
const dest = path.join(__dirname, '..', '.next', 'standalone', 'public');

fs.cpSync(src, dest, { recursive: true });
console.log('✅ Copied public/ into standalone build');