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
        type: "input_text",
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
          type: "input_text",
          text: `Photo ${i + 1} (original)`
        });

        inputParts.push({
          type: "input_image",
          image_url: `data:${p.mimetype};base64,${p.buffer.toString("base64")}`
        });

        // Matching overlay, if present
        const ov = overlays[i];
        if (ov) {
          inputParts.push({
            type: "input_text",
            text: `Photo ${i + 1} overlay: Green = include/count. Red = exclude/ignore.`
          });

          inputParts.push({
            type: "input_image",
            image_url: `data:${ov.mimetype};base64,${ov.buffer.toString("base64")}`
          });
        }
      }

      const response = await client.responses.create({
        model: MODEL_NAME,
        instructions: SYSTEM_PROMPT,
        input: [{ role: "user", content: inputParts }],
        max_output_tokens: 220
      });

      const resultText = (response.output_text || "").trim();
      if (!resultText) {
        res.status(500).json({ error: "Empty response from model." });
        return;
      }

      const confidence = parseConfidence(resultText);

      // Save to DB (do not crash if DB is unavailable)
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
