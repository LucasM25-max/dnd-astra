const sharp = require('/home/user/dnd-astra/node_modules/sharp');
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const width = Number(process.argv[3] || 760);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png') && !f.startsWith('s-'));
(async () => {
  for (const f of files) {
    await sharp(path.join(dir, f)).resize(width).png({ compressionLevel: 8 }).toFile(path.join(dir, 's-' + f));
  }
  console.log('resized', files.length);
})();
