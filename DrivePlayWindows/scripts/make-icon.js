'use strict';

const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const sizes = [16, 32, 64, 128, 256];
const assets = path.join(__dirname, '..', 'assets');

(async () => {
  const files = sizes.map((size) => path.join(assets, `icon_${size}.png`));
  const buffer = await pngToIco(files);
  fs.writeFileSync(path.join(assets, 'icon.ico'), buffer);
  console.log(`icon.ico gerado (${sizes.join(', ')} px)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
