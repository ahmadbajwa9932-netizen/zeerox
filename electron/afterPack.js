const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  const copies = [
    {
      src: path.join(__dirname, '..', 'frontend', '.next', 'standalone', 'node_modules'),
      dest: path.join(context.appOutDir, 'resources', 'frontend', '.next', 'standalone', 'node_modules'),
    },
    {
      src: path.join(__dirname, '..', 'backend', 'node_modules'),
      dest: path.join(context.appOutDir, 'resources', 'backend', 'node_modules'),
    },
  ];

  for (const { src, dest } of copies) {
    if (!fs.existsSync(src)) {
      console.warn('[afterPack] not found, skipping:', src);
      continue;
    }
    console.log('[afterPack] copying', src, '->', dest);
    fs.cpSync(src, dest, { recursive: true, dereference: true });
  }

  console.log('[afterPack] done.');
};