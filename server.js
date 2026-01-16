import "dotenv/config";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import express from "express";
import session from "express-session";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { insertEstimate, listEstimates, getEstimate } from "./db.js";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.set("trust proxy", 1);

const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } });

const APP_PIN = process.env.APP_PIN;
const SESSION_SECRET = process.env.SESSION_SECRET || "jjva-secret";
const MODEL_NAME = process.env.MODEL_NAME || "claude-sonnet-4-20250514";
const PORT = process.env.PORT || 10000;

if (!APP_PIN) throw new Error("Missing APP_PIN");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

app.use(
  session({
    name: "jjva.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: true
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  res.status(401).json({ error: "Not authorized" });
}

app.post("/api/login", (req, res) => {
  const { pin } = req.body || {};
  if (String(pin).trim() === String(APP_PIN).trim()) {
    req.session.authed = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Invalid PIN" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const SYSTEM_PROMPT = `
You are the Jiffy Junk Volume Assistant. Your job is to estimate junk removal volume in cubic yards based on uploaded photos and notes.

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

SPATIAL DEPTH ANALYSIS FOR INTERIOR ROOMS (CRITICAL):
When analyzing interior spaces (offices, rooms, buildings) with items distributed throughout:
- AUTOMATICALLY analyze the full 3D spatial depth from foreground to background
- Identify items at ALL depths: near (foreground), middle, and far (back wall/rear of room)
- Use perspective cues to understand which items are closer vs farther away
- Account for the ENTIRE room depth when estimating - don't just focus on foreground items
- Consider floor space occupied across the full depth of the visible room
- Items near the back wall may appear smaller due to perspective but still occupy significant volume

For room cleanouts:
1) Scan the entire image depth systematically:
   - Foreground items (closest to camera)
   - Middle ground items (center of room)
   - Background items (far wall, back corners)

2) Use room dimensions and perspective:
   - Estimate room width (left to right)
   - Estimate room depth (front to back) using floor tiles, walls, or perspective lines
   - Estimate ceiling height using doors, windows, or standard 8-10 ft assumption
   - Account for items distributed across the full floor area

3) Identify ALL furniture and items regardless of position:
   - Large items: cabinets, desks, refrigerators, appliances, shelving
   - Medium items: chairs, tables, filing cabinets, carts
   - Small items: boxes, electronics, miscellaneous debris
   - Items against walls or in corners are just as important as central items

Photo volume estimation logic (use this method every time):
1) Identify the included debris region
- If overlay exists, use it.
- If no overlay and it's an interior room, assume ALL visible furniture/items are in scope
- If no overlay and it's exterior/pile, define the debris region as the main contiguous pile.

2) Choose scale references when visible
- Use common reference objects to anchor height and size when possible:
  - Standard door (7 ft height, 3 ft width)
  - Windows (typical 3-5 ft)
  - Ceiling height (8-10 ft typical)
  - Commercial appliances/refrigerators (known dimensions)
  - Desks (30 inches height typical)
  - Floor tiles (12 inch standard)
- If no reliable reference exists, use conservative assumptions and widen the range.

3) Estimate footprint (length x width x depth) of the included region
- For rooms: estimate total floor area covered by items across full room depth
- For exterior: estimate how far the pile runs along a wall/hedge and how far it extends outward
- Use perspective and visible floor space to judge depth accurately

4) Estimate average height (not peak height)
- Use reference objects to estimate peak height, then choose an average height lower than peak.
- Most piles have a few high spots with a lower average.
- For rooms with varied items, consider the height distribution of all items.

5) Apply a packing factor (void factor) to account for air gaps
- Mixed bulky junk and furniture: use 0.65 to 0.8
- Mostly boxes stacked neatly: use 0.8 to 0.95
- Loose bags and irregular debris: use 0.6 to 0.75
- Room cleanouts with large furniture: use 0.5 to 0.7 (more air gaps)

6) Convert to cubic yards and provide a range
- Provide a tight range if overlay is clear and scale references exist.
- Provide a wider range if scope or scale is unclear.

Job types:
- STANDARD: estimate all junk shown that is in scope.
- DUMPSTER_CLEANOUT: remove debris around, on top, and inside the dumpster. Do NOT count the dumpster itself.
- DUMPSTER_OVERFLOW: remove debris around and on top plus arms-length inside the dumpster so it is not overflowing. Do NOT count deeper contents beyond arms-length.
- CONTAINER_SERVICE: garbage carts only. Convert gallons to cubic yards when needed. Do not count the cart itself.

Output format (must follow exactly):
Estimated Volume: X–Y cubic yards
Confidence: Low | Medium | High
Notes: one short sentence or None
`;

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
      const notes = (req.body.notes || "").slice(0, 4000);
      const agent = (req.body.agent_label || "").slice(0, 80);

      const photos = req.files?.photos || [];
      const overlays = req.files?.overlays || [];

      if (!photos.length) return res.status(400).json({ error: "No photos uploaded" });

      const content = [
        {
          type: "text",
          text: `Job type: ${job_type}\nAgent: ${agent || "None"}\nNotes: ${notes || "None"}`
        }
      ];

      photos.forEach((p, i) => {
        content.push({ type: "text", text: `Photo ${i + 1}` });

        // Extract media type and base64 data
        const mediaType = p.mimetype.includes('jpeg') || p.mimetype.includes('jpg')
          ? 'image/jpeg'
          : p.mimetype.includes('png')
          ? 'image/png'
          : p.mimetype.includes('webp')
          ? 'image/webp'
          : 'image/gif';

        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: p.buffer.toString("base64")
          }
        });

        if (overlays[i]) {
          content.push({ type: "text", text: `Overlay for photo ${i + 1}` });

          const overlayMediaType = overlays[i].mimetype.includes('jpeg') || overlays[i].mimetype.includes('jpg')
            ? 'image/jpeg'
            : overlays[i].mimetype.includes('png')
            ? 'image/png'
            : overlays[i].mimetype.includes('webp')
            ? 'image/webp'
            : 'image/gif';

          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: overlayMediaType,
              data: overlays[i].buffer.toString("base64")
            }
          });
        }
      });

      const response = await anthropic.messages.create({
        model: MODEL_NAME,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: content
        }]
      });

      const text = response.content[0]?.text?.trim() || "";
      if (!text) return res.status(500).json({ error: "Empty response from model" });

      let saved = null;
      try {
        saved = await insertEstimate({
          agent_label: agent,
          job_type,
          notes,
          photo_count: photos.length,
          model_name: MODEL_NAME,
          result_text: text
        });
      } catch {}

      res.json({ ok: true, id: saved?.id, result: text });
    } catch (e) {
      console.error("Estimate error:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  }
);

app.get("/api/history", requireAuth, async (req, res) => {
  try {
    const rows = await listEstimates(100);
    res.json({ ok: true, rows });
  } catch {
    res.status(503).json({ error: "Database unavailable" });
  }
});

app.get("/api/estimate/:id", requireAuth, async (req, res) => {
  try {
    const row = await getEstimate(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, row });
  } catch {
    res.status(503).json({ error: "Database unavailable" });
  }
});

app.listen(PORT, () => console.log("Jiffy Volume App running on :" + PORT));
