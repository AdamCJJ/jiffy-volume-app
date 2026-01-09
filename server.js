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
const MODEL_NAME = process.env.MODEL_NAME || "gpt-5";
const PORT = process.env.PORT || 3000;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY env var");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
You are the Jiffy Junk Volume Assistant. Your job is to estimate junk removal volume in cubic yards based on uploaded photos and notes.

Core rules:
- Always estimate cubic yards.
- Never mention price. Only estimate volume.
- Keep answers short, professional, friendly, and efficient.
- Do not double-count the same item across multiple photos.

Job types:
- STANDARD: estimate all junk shown that is in scope.
- DUMPSTER_CLEANOUT: estimate total volume being removed INCLUDING debris around the dumpster, overflow on top, and contents removed from inside the dumpster. The dumpster container stays onsite and must NEVER be counted.
- DUMPSTER_OVERFLOW: estimate volume being removed INCLUDING debris around the dumpster and overflow on top, plus removal "arms-length into the dumpster" so the dumpster is not overflowing afterward. Do NOT count deeper contents beyond arms-length. The dumpster container stays onsite and must NEVER be counted.

Dumpster size:
- If job_type is DUMPSTER_CLEANOUT or DUMPSTER_OVERFLOW and dumpster_size is UNKNOWN, ask exactly one question:
  "What size dumpster is it (2, 4, 6, 8, or 10 yard)?"
  and do not provide an estimate until answered.

Output format (must follow exactly):
Estimated Volume: X–Y cubic yards
Confidence: Low | Medium | High
Notes: one short sentence or None
`.trim();

function parseConfidence(resultText) {
  const m = resultText.match(/Confidence:\s*(Low|Medium|High)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

app.post("/api/estimate", requireAuth, upload.array("photos", 12), async (req, res) => {
  try {
    const job_type = (req.body.job_type || "STANDARD").toUpperCase();
    const dumpster_size_raw = (req.body.dumpster_size || "").trim();
    const dumpster_size =
      dumpster_size_raw === "" || dumpster_size_raw.toUpperCase() === "UNKNOWN"
        ? null
        : Number(dumpster_size_raw);

    const agent_label = (req.body.agent_label || "").trim().slice(0, 80) || null;
    const notes = (req.body.notes || "").trim().slice(0, 4000) || null;

    const files = req.files || [];
    if (!files.length) {
      res.status(400).json({ error: "Please upload at least 1 photo." });
      return;
    }

    // Build multimodal input
    const inputParts = [];
    inputParts.push({
      type: "input_text",
      text:
        `Job type: ${job_type}\n` +
        `Dumpster size: ${dumpster_size ? dumpster_size + " yard" : "UNKNOWN"}\n` +
        `Agent label: ${agent_label || "None"}\n` +
        `Notes: ${notes || "None"}`
    });

    for (const f of files) {
      inputParts.push({
        type: "input_image",
        image_url: `data:${f.mimetype};base64,${f.buffer.toString("base64")}`
      });
    }

    const response = await client.responses.create({
      model: MODEL_NAME,
      instructions: SYSTEM_PROMPT,
      input: [{ role: "user", content: inputParts }],
      max_output_tokens: 160
    });

    const resultText = (response.output_text || "").trim();
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
        photo_count: files.length,
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
});

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
