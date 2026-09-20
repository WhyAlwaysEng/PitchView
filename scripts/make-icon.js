// สคริปต์สร้างโลโก้ PitchView (build utility)
// ใช้: node scripts/make-icon.js
// สร้าง: assets/icon.svg (source), assets/icon.png (512), assets/icon.ico (multi-size)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const _pngToIco = require('png-to-ico');
const pngToIco = typeof _pngToIco === 'function' ? _pngToIco : (_pngToIco.default || _pngToIco.imagesToIco);

// โลโก้ minimal: กริด 2x2 บนพื้นเข้มโค้งมน — สามช่องสีเขียวสนาม หนึ่งช่องสีขาว
// (สื่อการดูบอลหลายจอ โดยจอขาวคือจอที่กำลังฟังเสียง)
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="32" y="32" width="448" height="448" rx="112" fill="#101312"/>
  <g>
    <rect x="96"  y="96"  width="150" height="150" rx="36" fill="#30D158"/>
    <rect x="266" y="96"  width="150" height="150" rx="36" fill="#30D158"/>
    <rect x="96"  y="266" width="150" height="150" rx="36" fill="#30D158"/>
    <rect x="266" y="266" width="150" height="150" rx="36" fill="#F5F7F5"/>
  </g>
</svg>
`;

const assetsDir = path.join(__dirname, '..', 'assets');
const svgPath = path.join(assetsDir, 'icon.svg');
const pngPath = path.join(assetsDir, 'icon.png');
const icoPath = path.join(assetsDir, 'icon.ico');

async function main() {
  fs.writeFileSync(svgPath, SVG.trim() + '\n');
  console.log('✔ wrote', svgPath);

  await sharp(Buffer.from(SVG)).resize(512, 512).png().toFile(pngPath);
  console.log('✔ wrote', pngPath, '(512x512)');

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = [];
  for (const size of sizes) {
    const buf = await sharp(Buffer.from(SVG)).resize(size, size).png().toBuffer();
    pngBuffers.push(buf);
  }
  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(icoPath, ico);
  console.log('✔ wrote', icoPath, '(sizes:', sizes.join(', ') + ')');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
