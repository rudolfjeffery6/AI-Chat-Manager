const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

// Claude orange color: #D97757
const CLAUDE_ORANGE = '#D97757'
const BACKGROUND = '#FAF9F7'

// Generate SVG icon with chat bubble design
function generateSVG(size) {
  const padding = Math.floor(size * 0.1)
  const iconSize = size - padding * 2

  // Chat bubble with "C" for ChatGPT/Claude
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="${BACKGROUND}"/>
  <g transform="translate(${padding}, ${padding})">
    <!-- Chat bubble background -->
    <rect x="${iconSize * 0.1}" y="${iconSize * 0.15}" width="${iconSize * 0.8}" height="${iconSize * 0.6}" rx="${iconSize * 0.15}" fill="${CLAUDE_ORANGE}"/>
    <!-- Chat bubble tail -->
    <path d="M${iconSize * 0.25} ${iconSize * 0.75} L${iconSize * 0.15} ${iconSize * 0.85} L${iconSize * 0.35} ${iconSize * 0.75}" fill="${CLAUDE_ORANGE}"/>
    <!-- Letter C for ChatGPT -->
    <text x="${iconSize * 0.5}" y="${iconSize * 0.55}" font-family="Georgia, serif" font-size="${iconSize * 0.35}" font-weight="600" fill="white" text-anchor="middle" dominant-baseline="middle">C</text>
  </g>
</svg>`
}

async function generateIcons() {
  const sizes = [16, 48, 128]
  const outputDir = path.join(__dirname, '..', 'src', 'icons')

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  for (const size of sizes) {
    const svg = generateSVG(size)
    const outputPath = path.join(outputDir, `icon-${size}.png`)

    await sharp(Buffer.from(svg))
      .png()
      .toFile(outputPath)

    console.log(`Generated: icon-${size}.png`)
  }

  console.log('All icons generated successfully!')
}

generateIcons().catch(console.error)
