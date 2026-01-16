// Quick debug server for /api/estimate uploads
// Usage:
//   npm install express multer sharp
//   node examples/estimate-debug.js
//
// Then post from the app or use curl (example below).

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const OUT_DIR = path.join(__dirname, 'debug_out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Helper: count approximate green / red pixels in RGBA raw buffer
function countRedGreenPixels(raw) {
  const { data, info } = raw;
  let redCount = 0, greenCount = 0, nonAlpha = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 30) continue; // mostly transparent => ignore
    nonAlpha++;
    // simple thresholds tuned for typical overlay colors used by the client
    if (g > 140 && g > r + 30 && g > b + 30) greenCount++;
    else if (r > 140 && r > g + 30 && r > b + 30) redCount++;
  }
  return { width: info.width, height: info.height, total, nonAlpha, redCount, greenCount };
}

app.post('/api/estimate', upload.fields([{ name: 'photos' }, { name: 'overlays' }]), async (req, res) => {
  try {
    const photos = req.files['photos'] || [];
    const overlays = req.files['overlays'] || [];

    console.log(`Received request: ${photos.length} photos, ${overlays.length} overlays`);
    const debugInfo = {
      photo_count: photos.length,
      overlay_count: overlays.length,
      photos: [],
      overlays: []
    };

    // Save and record the first photo and overlay for manual inspection
    if (photos[0]) {
      const p = photos[0];
      const outPath = path.join(OUT_DIR, `debug_photo_${Date.now()}_${p.originalname}`);
      fs.writeFileSync(outPath, p.buffer);
      debugInfo.photos.push({ name: p.originalname, size: p.size, saved_as: outPath });
      console.log('Saved photo to', outPath);
    }

    if (overlays[0]) {
      const o = overlays[0];
      const outPath = path.join(OUT_DIR, `debug_overlay_${Date.now()}_${o.originalname}`);
      fs.writeFileSync(outPath, o.buffer);
      debugInfo.overlays.push({ name: o.originalname, size: o.size, saved_as: outPath });
      console.log('Saved overlay to', outPath);

      // Use sharp to decode overlay to raw RGBA and run a quick color count
      try {
        const img = sharp(o.buffer).ensureAlpha().raw();
        const raw = await img.toBuffer({ resolveWithObject: true });
        const counts = countRedGreenPixels(raw);
        debugInfo.overlays[0].counts = counts;
        console.log('Overlay counts:', counts);
      } catch (e) {
        console.warn('Failed to analyze overlay with sharp:', e.message);
        debugInfo.overlays[0].counts_error = e.message;
      }
    }

    // If there are multiple overlays, optionally analyze all (fast path: only analyze first)
    // Reply with debug info so the client can show it
    return res.json({ ok: true, debug: debugInfo });
  } catch (err) {
    console.error('Estimate debug handler error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Debug estimate server listening on http://localhost:${PORT}`));