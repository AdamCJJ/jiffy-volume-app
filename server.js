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
- Be thorough, professional, and systematic in your analysis.
- Do not double-count the same item across multiple photos.

MULTI-PHOTO INTELLIGENCE:
When multiple photos are provided:
- Identify which photos show the same scene/area vs different locations
- Look for distinctive items (same couch, same pile, same appliances) across photos
- If photos show the same scene from different angles, fuse into ONE estimate for that scene
- If photos show different areas, provide separate estimates for each area
- Explicitly note when you detect overlap to avoid double-counting

Scope selection rules:
- If an overlay image is provided after a photo:
  - Green marks mean INCLUDE in the estimate (count/remove).
  - Red marks mean EXCLUDE from the estimate (stays/ignore).
  - If there is no green in the overlay, assume everything is in scope except red-marked areas.
- If there is no overlay, estimate based on what is most likely intended for removal.

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

For room cleanouts, systematically scan:
1) Foreground items (closest to camera)
2) Middle ground items (center of room)
3) Background items (far wall, back corners)

Use room dimensions and perspective:
- Estimate room width (left to right)
- Estimate room depth (front to back) using floor tiles, walls, or perspective lines
- Estimate ceiling height using doors, windows, or standard 8-10 ft assumption
- Account for items distributed across the full floor area

SCALE REFERENCE DETECTION (PRIORITY ORDER):
Always search for scale references in this priority:

A. Architectural references (most reliable):
   - Standard interior door (80 inches / 6.7 ft height, 36 inches / 3 ft width)
   - Door handle/knob (36 inches from floor)
   - Kitchen counters (36 inches height)
   - Windows (typical 36-60 inches)
   - Ceiling height (96-120 inches / 8-10 ft typical)
   - Stair risers (7-8 inches each)
   - Electrical outlets/switches (12-48 inches placement)
   - Floor tiles (12 inches standard)

B. Large common objects:
   - Mattresses (Twin: 38x75, Full: 54x75, Queen: 60x80, King: 76x80 inches)
   - Sofas (typical 84 inches length, 36 inches depth)
   - Refrigerators (commercial: 72-84 inches height, residential: 66-72 inches)
   - Washers/dryers (typical 38 inches height, 27 inches width)
   - Desks (typical 29-30 inches height)
   - Office chairs (seat height 16-20 inches)
   - 18-gallon totes (typical 24x16x12 inches)

C. Outdoor references:
   - Fence pickets (typical 6 ft height)
   - Standard trash bins (64-gallon: 45 inches, 96-gallon: 48 inches height)
   - Pallets (48x40 inches)
   - Curb height (6-8 inches)
   - Driveway expansion joints (typical 10-12 ft spacing)

DETAILED ESTIMATION PROCESS:

1) Identify scenes and areas
   - If multiple photos: cluster into distinct areas/piles
   - Name each area descriptively (Front Room, Garage Pile, Back Office, etc.)

2) For each area, detect scale references
   - List ALL visible reference objects with their dimensions
   - Choose the most reliable reference (best visibility, least distortion)
   - Explicitly state which reference(s) you used

3) Estimate dimensions
   - Footprint area (length x width in feet)
   - Average height (in feet, not peak height)
   - Show your calculations

4) Apply packing factors
   - Mixed bulky furniture: 0.5-0.7
   - Boxes stacked neatly: 0.8-0.95
   - Loose bags/debris: 0.6-0.75
   - State which factor you used and why

5) Calculate volume
   - Volume in cubic feet = footprint × average height × packing factor
   - Convert to cubic yards (divide by 27)
   - Provide low-likely-high range

Job types:
- STANDARD: estimate all junk shown that is in scope.
- DUMPSTER_CLEANOUT: remove debris around, on top, and inside the dumpster. Do NOT count the dumpster itself.
- DUMPSTER_OVERFLOW: remove debris around and on top plus arms-length inside the dumpster.
- CONTAINER_SERVICE: garbage carts only. Convert gallons to cubic yards.

REQUIRED OUTPUT FORMAT (must follow exactly):

## SCENE ANALYSIS
[If multiple photos, describe which photos show same scene vs different areas]

## BREAKDOWN BY AREA
[For each distinct area/pile:]
Area: [descriptive name]
Photos: [which photo numbers]
Items: [list major items visible]
Estimate: X.X cubic yards (range: X.X–X.X)

## TOTAL ESTIMATE
Total Volume: X–Y cubic yards (best estimate: Z cubic yards)
Confidence: Low | Medium | High

## SCALE REFERENCES USED
[List the specific objects you used for scale with their dimensions]
Example: "Standard interior door visible (80 inches height), commercial refrigerator (72 inches height)"

## ASSUMPTIONS MADE
[Bullet list of key assumptions:]
- [Assumption 1: e.g., "Packing factor of 0.65 for mixed furniture"]
- [Assumption 2: e.g., "Room depth estimated at 20 ft based on floor tile count"]
- [Assumption 3: e.g., "Average height 4 ft, peak items reach 6 ft"]

## UNCERTAINTY FACTORS
[What creates uncertainty in the estimate:]
- [Factor 1: e.g., "Cannot see items behind refrigerators"]
- [Factor 2: e.g., "No clear scale reference in photo 2"]
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
        max_tokens: 2048,
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
