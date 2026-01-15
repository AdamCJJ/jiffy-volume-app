import "dotenv/config";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import express from "express";
import session from "express-session";
import multer from "multer";
import OpenAI from "openai";
import { insertEstimate, listEstimates, getEstimate } from "./db.js";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB per image

const APP_PIN = process.env.APP_PIN;
if (!APP_PIN) throw new Error("Missing APP_PIN env var");

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o";
const PORT = process.env.PORT || 3000;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY env var");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Trust Railway's proxy for secure cookies
app.set('trust proxy', 1);

app.use(
  session({
    name: "jjva.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // On Render, HTTPS is used at the public URL, but setting secure cookies can be finicky during debugging.
      // Leave this false unless you are 100% sure cookies are being set correctly.
      secure: String(process.env.COOKIE_SECURE || "false") === "true"
    }
  })
);

app.use(express.json());

// Serve static assets from /public
app.use(express.static(path.join(__dirname, "public")));

// Force / to serve index.html (prevents "Cannot GET /" confusion)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  res.status(401).json({ error: "Not authorized" });
}

app.post("/api/login", (req, res) => {
  const { pin } = req.body || {};
  if (pin && String(pin).trim() === String(APP_PIN).trim()) {
    req.session.authed = true;
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ error: "Invalid PIN" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const SYSTEM_PROMPT = `
You are the Jiffy Junk Volume Estimator. Your job is to estimate junk removal volume in cubic yards based on uploaded photos and notes.

Core rules:
- Always estimate cubic yards.
- Never mention price. Only estimate volume.
- Keep answers short, professional, friendly, and efficient.
- Do not double-count the same item across multiple photos.

Scope selection rules (most important):
- If an overlay image is provided after a photo:
  - Green marks mean INCLUDE in the estimate (count/remove).
  - Red marks mean EXCLUDE from the estimate (stays/ignore).
  - If there is no green in the overlay, assume everything is in scope except red-marked areas.
- If there is no overlay, estimate based on what is most likely intended for removal (the main pile), but keep the estimate conservative and include a wider range.

Do NOT count containers themselves:
- The dumpster container, carts, and rolltainers themselves are NEVER counted as junk volume. Only the debris inside/around them.

Special container debris heuristics:
- If a rolltainer is visible and appears full of debris, estimate debris as about 2 cubic yards per full rolltainer (scale down if not full). Rolltainer stays.
- If a shopping cart is visible and appears full of debris, estimate debris as about 0.25 cubic yards per full cart (scale down if not full). Cart stays unless explicitly requested.

Photo volume estimation logic (use this method every time):
1) Identify the included debris region
- If overlay exists, use it.
- If no overlay, define the debris region as the main contiguous pile.

2) Choose scale references when visible
- Use common reference objects to anchor height and size when possible:
  - Standard door and door hardware (doors typically 80" tall, 36" wide)
  - Dumpster dimensions (2-yard: 4'×3'×3', 4-yard: 6'×4'×4', 6-yard: 6'×5'×5', 8-yard: 6'×6'×6')
  - Barstool or chair (seat height ~18", back ~36")
  - Curb height (typically 6")
  - Fence height (typically 6' residential)
  - Appliances or common furniture dimensions
- If no reliable reference exists, use conservative assumptions and widen the range.

3) Estimate footprint (length x depth) of the included region
- Estimate how far the pile runs along a wall/hedge/fence line and how far it extends outward toward curb/sidewalk.
- For scattered debris: mentally draw a bounding box around the main concentration, excluding isolated outliers.
- If perspective makes depth hard, assume a smaller depth and widen the range.

4) Estimate average height (not peak height)
- Use reference objects to estimate peak height, then choose an average height lower than peak.
- Most piles have a few high spots with a lower average.
- For bagged debris: typical 13-gallon kitchen bag is ~24" tall when full; 33-gallon contractor bag is ~30" tall.
- For ground-level piles: average height is often 1-2 feet even if some items reach 3-4 feet.

5) Apply a packing factor (void factor) to account for air gaps
- Mixed bulky junk and furniture: use 0.65 to 0.75
- Mostly boxes stacked neatly: use 0.8 to 0.9
- Loose bags (full garbage bags): use 0.7 to 0.8
- Very loose scattered debris and partially full bags: use 0.5 to 0.65
- Dense packed items (magazines, books, dirt): use 0.85 to 0.95

6) Special estimation techniques for common scenarios
- Multiple scattered piles: estimate each pile separately, then sum them.
- Debris around dumpster: estimate the footprint of the debris zone, not including the dumpster itself.
- Bagged debris piles: count visible bags and estimate volume per bag (13-gal bag ≈ 0.05 cubic yards, 33-gal bag ≈ 0.12 cubic yards), or use dimensional approach with lower packing factor.
- Items piled against fence/wall: use the fence/wall as a backdrop to judge depth and height more accurately.

7) Convert to cubic yards and provide a range
- Formula: (Length × Width × Average Height × Packing Factor) ÷ 27 = cubic yards
- Provide a tight range (e.g., 5-6 yards) if overlay is clear and scale references exist.
- Provide a wider range (e.g., 4-7 yards) if scope or scale is unclear.
- Round to nearest 0.5 cubic yard for volumes under 5 yards, nearest 1 yard for larger volumes.

Job types:
- STANDARD: estimate all junk shown that is in scope.
- DUMPSTER_CLEANOUT: remove debris around, on top, and inside the dumpster. Do NOT count the dumpster itself.
- DUMPSTER_OVERFLOW: remove debris around and on top plus arms-length inside the dumpster so it is not overflowing. Do NOT count deeper contents beyond arms-length.
- CONTAINER_SERVICE: garbage carts only. Convert gallons to cubic yards when needed. Do not count the cart itself.

Output format (must follow exactly):
Estimated Volume: X–Y cubic yards
Confidence: Low | Medium | High
Notes: one short sentence or None
`.trim();

function parseConfidence(resultText) {
  const m = resultText.match(/Confidence:\s*(Low|Medium|High)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

app.post(
  "/api/estimate",
  requireAuth,
  upload.fields([
    { name: "photos", maxCount: 12 },
    { name: "overlays", maxCount: 12 }
  ]),
  async (req, res) => {
    try {
      const job_type = (req.body.job_type || "STANDARD").toUpperCase();
      const dumpster_size_raw = (req.body.dumpster_size || "").trim();
      const dumpster_size =
        dumpster_size_raw === "" || dumpster_size_raw.toUpperCase() === "UNKNOWN"
          ? null
          : Number(dumpster_size_raw);

      const agent_label = (req.body.agent_label || "").trim().slice(0, 80) || null;
      const notes = (req.body.notes || "").trim().slice(0, 4000) || null;

      const photos = req.files?.photos || [];
      const overlays = req.files?.overlays || [];

      if (!photos.length) {
        res.status(400).json({ error: "Please upload at least 1 photo." });
        return;
      }

      // Build multimodal input
      const inputParts = [];

      inputParts.push({
        type: "text",
        text:
          `Job type: ${job_type}\n` +
          `Dumpster size: ${dumpster_size ? dumpster_size + " yard" : "UNKNOWN"}\n` +
          `Agent label: ${agent_label || "None"}\n` +
          `Notes: ${notes || "None"}\n\n` +
          `Overlay rules (if provided after a photo):\n` +
          `- Green marks = INCLUDE in estimate (count/remove)\n` +
          `- Red marks = EXCLUDE from estimate (stays/ignore)\n` +
          `- If a photo has no green marks, assume everything is in-scope EXCEPT red-marked areas.\n` +
          `- The dumpster container itself should NEVER be counted as junk volume.\n`
      });

      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];

        // The original photo
        inputParts.push({
          type: "text",
          text: `Photo ${i + 1} (original)`
        });

        inputParts.push({
          type: "image_url",
          image_url: {
            url: `data:${p.mimetype};base64,${p.buffer.toString("base64")}`
          }
        });

        // Matching overlay, if present
        const ov = overlays[i];
        if (ov) {
          inputParts.push({
            type: "text",
            text: `Photo ${i + 1} overlay: Green = include/count. Red = exclude/ignore.`
          });

          inputParts.push({
            type: "image_url",
            image_url: {
              url: `data:${ov.mimetype};base64,${ov.buffer.toString("base64")}`
            }
          });
        }
      }

      const response = await client.chat.completions.create({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: inputParts }
        ],
        max_tokens: 220
      });

      const resultText = (response.choices[0]?.message?.content || "").trim();
      if (!resultText) {
        res.status(500).json({ error: "Empty response from model." });
        return;
      }

      const confidence = parseConfidence(resultText);

      // Save to DB (but do NOT crash the app if DB is temporarily unavailable)
      let saved = null;
      try {
        saved = await insertEstimate({
          user_id: null,
          agent_label,
          job_type,
          dumpster_size,
          notes,
          photo_count: photos.length,
          model_name: MODEL_NAME,
          result_text: resultText,
          confidence
        });
      } catch {
        // If DB is down, we still return the estimate; history logging can recover later.
        saved = { id: null, created_at: null };
      }

      res.json({
        ok: true,
        id: saved?.id,
        created_at: saved?.created_at,
        result: resultText
      });
    } catch (e) {
      res.status(500).json({ error: e?.message || "Server error" });
    }
  }
);

app.get("/api/history", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 300);
    const rows = await listEstimates(limit);
    res.json({ ok: true, rows });
  } catch {
    res.status(503).json({ error: "Database not reachable. Try again in a moment." });
  }
});

app.get("/api/estimate/:id", requireAuth, async (req, res) => {
  try {
    const row = await getEstimate(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, row });
  } catch {
    res.status(503).json({ error: "Database not reachable. Try again in a moment." });
  }
});

// Lightweight endpoint for future use (optional)
app.get("/api/ping", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Jiffy Volume App running on :${PORT}`));
