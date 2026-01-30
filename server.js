const express = require('express');
const path = require('path');
const serveIndex = require('serve-index');
const argv = require('yargs/yargs')(process.argv.slice(2)).argv;
const chalk = require('chalk');
const fs = require('fs');
const sharp = require('sharp');
const axios = require('axios');

const app = express();
const host = argv.host || 'localhost';
const port = argv.port || 7000;

// Redirect root to /play-now
app.get('/', (req, res) => res.redirect('/play-now'));

// ========== Fancy Logger ==========
function gradientText(text, colorA, colorB) {
  const len = text.length;
  const [r1, g1, b1] = colorA;
  const [r2, g2, b2] = colorB;
  return text.split('').map((char, i) => {
    const r = Math.round(r1 + ((r2 - r1) * i) / (len - 1));
    const g = Math.round(g1 + ((g2 - g1) * i) / (len - 1));
    const b = Math.round(b1 + ((b2 - b1) * i) / (len - 1));
    return chalk.rgb(r, g, b).bold(char);
  }).join('');
}

function hsvToRgb(h, s, v) {
  let c = v * s;
  let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const method = gradientText(` ${req.method} `, [0, 255, 200], [0, 200, 255]);
    const pathC = chalk.inverse.bold(gradientText(` ${req.path} `, [255, 0, 0], [0, 0, 255]));
    const ua = chalk.rgb(57, 255, 20).bold.italic(req.headers['user-agent'] || 'unknown');

    let statusColored;
    switch (res.statusCode) {
      case 200: statusColored = chalk.rgb(0, 255, 85).bgBlack.bold(` ${res.statusCode} `); break;
      case 404: statusColored = chalk.rgb(255, 40, 40).bgBlack.bold(` ${res.statusCode} `); break;
      case 500: statusColored = chalk.rgb(255, 0, 200).bgBlack.bold(` ${res.statusCode} `); break;
      default: statusColored = chalk.rgb(255, 255, 85).bgBlack.bold(` ${res.statusCode} `);
    }

    const ipColored = ip.split('').map((c, i) => {
      const r = 255;
      const g = Math.round(140 + (115 * i) / ip.length);
      return chalk.rgb(r, g, 0).bgBlack.bold(c);
    }).join('');

    const timestampStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const timestamp = gradientText(timestampStr, [255, 255, 255], [100, 180, 255]);
    const durationColored = chalk.rgb(0, 255, 255).bold(`${duration}ms`);
    console.log(`${timestamp} ${method} ${pathC} ${statusColored} IP:${ipColored} UA:${ua} - ${durationColored}`);
  });
  next();
});

// ========== Image Resizing ==========
app.get('/image', async (req, res) => {
  const { image, width, height } = req.query;
  if (!image || !width || !height) {
    return res.status(400).send('Missing image, width, or height');
  }

  const parsedWidth = parseInt(width);
  const parsedHeight = parseInt(height);
  if (isNaN(parsedWidth) || isNaN(parsedHeight)) {
    return res.status(400).send('Invalid width or height');
  }

  try {
    let buffer;
    if (/^https?:\/\//i.test(image)) {
      const response = await axios.get(image, { responseType: 'arraybuffer' });
      buffer = Buffer.from(response.data, 'binary');
    } else {
      const localPath = path.join(__dirname, image);
      if (!fs.existsSync(localPath)) return res.status(404).send('Local image not found');
      buffer = fs.readFileSync(localPath);
    }

    const resized = await sharp(buffer)
      .resize(parsedWidth, parsedHeight, { fit: 'fill' })
      .toFormat('webp')
      .toBuffer();

    res.set('Content-Type', 'image/webp');
    res.send(resized);
  } catch (e) {
    console.error(e.message);
    res.status(500).send('Failed to resize image');
  }
});

// ========== Routes ==========
app.get('/play-now', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  fs.access(indexPath, fs.constants.F_OK, (err) => {
    if (err) res.status(500).send('index.html not found');
    else res.sendFile(indexPath);
  });
});

app.get('/faq', (req, res) => res.sendFile(path.join(__dirname, 'other-pages', 'faq.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'other-pages', 'tos.html')));
app.get('/privacy-policy', (req, res) => res.sendFile(path.join(__dirname, 'other-pages', 'privacy.html')));

// ========== Static Folders ==========
app.use('/games', express.static(path.join(__dirname, 'games')), serveIndex(path.join(__dirname, 'games'), { icons: true }));
app.use('/stable', express.static(path.join(__dirname, 'stable')), serveIndex(path.join(__dirname, 'stable'), { icons: true }));
app.use('/other-pages', express.static(path.join(__dirname, 'other-pages')), serveIndex(path.join(__dirname, 'other-pages'), { icons: true }));

// ========== 404 ==========
app.use((req, res) => {
  if (req.path === '/other-pages/404.html') {
    return res.status(404).sendFile(path.join(__dirname, 'other-pages', '404.html'));
  }
  res.status(404).sendFile(path.join(__dirname, 'other-pages', '404.html'));
});

// ========== Fancy Startup Box ==========
function drawBox(lines, padding = 3) {
  const maxLength = Math.max(...lines.map(line => line.length));
  const totalWidth = maxLength + padding * 2 + 2;
  const rainbow = (len) => [...Array(len)].map((_, i) => chalk.rgb(...hsvToRgb((i * 360) / len, 1, 1))('═')).join('');
  const top = '╔' + rainbow(totalWidth - 2) + '╗';
  const bottom = '╚' + rainbow(totalWidth - 2) + '╝';
  console.log(top);
  lines.forEach(line => {
    const padded = line + ' '.repeat(maxLength - line.length);
    const colored = gradientText(padded, [0, 200, 255], [180, 0, 255]);
    console.log(chalk.rgb(255, 140, 0)('║') + ' '.repeat(padding) + colored + ' '.repeat(padding) + chalk.rgb(255, 140, 0)('║'));
  });
  console.log(bottom);
}

app.listen(port, host, () => {
  drawBox([
    'Server running!',
    '',
    `Website:         http://${host}:${port}/play-now`,
    `Games:           http://${host}:${port}/games/`,
    `Important filez: http://${host}:${port}/stable/`,
    `Other Pages:     http://${host}:${port}/other-pages/`,
    `FAQ:             http://${host}:${port}/faq`,
    `Terms:           http://${host}:${port}/terms`,
    `Privacy Policy:  http://${host}:${port}/privacy-policy`,
    '',
    `Image Resizer:   http://${host}:${port}/image?image=...&width=...&height=...`,
  ]);
});
