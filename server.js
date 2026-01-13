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
app.set("trust proxy", 1);

const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } });

const APP_PIN = process.env.APP_PIN;
const SESSION_SECRET = process.env.SESSION_SECRET || "jjva-secret";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4.1-mini";
const PORT = process.env.PORT || 10000;

if (!APP_PIN) throw new Error("Missing APP_PIN");
if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

Overlay rules:
- Green marks = INCLUDE in the estimate (count/remove).
- Red marks = EXCLUDE from the estimate (stays/ignore).
- If no green marks exist, assume everything is in scope except red.
- The dumpster container, carts, and rolltainers themselves are NEVER counted.

Special containers:
- A full rolltainer = about 2 cubic yards of debris.
- A full shopping cart = about 0.25 cubic yards of debris.
- Scale down if not full.
- These containers stay onsite unless explicitly requested.

Job types:
STANDARD: estimate all visible junk.
DUMPSTER_CLEANOUT: remove debris around, on top, and inside the dumpster. Do NOT count the dumpster itself.
DUMPSTER_OVERFLOW: remove debris around and on top plus arms-length inside the dumpster.
CONTAINER_SERVICE: garbage carts only. Convert gallons to cubic yards.

If dumpster size is unknown and unclear from photo, ask:
"What size dumpster is it (e.g., 3 yd front-load or 20 yd roll-off)?"

Output format:
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
          type: "input_text",
          text: `Job type: ${job_type}\nAgent: ${agent || "None"}\nNotes: ${notes || "None"}`
        }
      ];

      photos.forEach((p, i) => {
        content.push({ type: "input_text", text: `Photo ${i + 1}` });
        content.push({
          type: "input_image",
          image_url: `data:${p.mimetype};base64,${p.buffer.toString("base64")}`
        });

        if (overlays[i]) {
          content.push({ type: "input_text", text: `Overlay for photo ${i + 1}` });
          content.push({
            type: "input_image",
            image_url: `data:${overlays[i].mimetype};base64,${overlays[i].buffer.toString("base64")}`
          });
        }
      });

      const response = await openai.responses.create({
        model: MODEL_NAME,
        instructions: SYSTEM_PROMPT,
        input: [{ role: "user", content }],
        max_output_tokens: 250
      });

      const text = (response.output_text || "").trim();
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
