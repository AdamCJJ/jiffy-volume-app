const loginCard = document.getElementById("loginCard");
const appCard = document.getElementById("appCard");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const pin = document.getElementById("pin");
const loginErr = document.getElementById("loginErr");

const out = document.getElementById("out");
const copyBtn = document.getElementById("copyBtn");
const savedMsg = document.getElementById("savedMsg");

const estimateBtn = document.getElementById("estimateBtn");
const photosInput = document.getElementById("photos");
const notes = document.getElementById("notes");
const agentLabel = document.getElementById("agentLabel");

const dumpsterBox = document.getElementById("dumpsterBox");
const dumpsterSize = document.getElementById("dumpsterSize");

const markups = document.getElementById("markups");

let editors = []; // { file, imgEl, canvas, ctx, mode, drawing, lastX, lastY }

function getJobType() {
  const r = document.querySelector("input[name='jobType']:checked");
  return r ? r.value : "STANDARD";
}

function updateDumpsterUI() {
  const jt = getJobType();
  dumpsterBox.classList.toggle("hidden", jt === "STANDARD");
}
document.querySelectorAll("input[name='jobType']").forEach(el => el.addEventListener("change", updateDumpsterUI));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function checkAuth() {
  try {
    await api("/api/ping", { method: "GET" });
    const r = await fetch("/api/history?limit=1");
    if (r.status === 401) throw new Error("Not authed");
    loginCard.classList.add("hidden");
    appCard.classList.remove("hidden");
  } catch {
    loginCard.classList.remove("hidden");
    appCard.classList.add("hidden");
  }
}

loginBtn.onclick = async () => {
  loginErr.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pin.value })
    });
    pin.value = "";
    loginCard.classList.add("hidden");
    appCard.classList.remove("hidden");
  } catch (e) {
    loginErr.textContent = e.message;
  }
};

logoutBtn.onclick = async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  await checkAuth();
};

function makeEditor(file, index) {
  const card = document.createElement("div");
  card.className = "markupCard";

  const top = document.createElement("div");
  top.className = "markupTop";

  const title = document.createElement("div");
  title.innerHTML = `<b>Photo ${index + 1}</b> <span class="small">${file.name || ""}</span>`;

  const btns = document.createElement("div");
  btns.className = "modeBtns";

  const greenBtn = document.createElement("button");
  greenBtn.type = "button";
  greenBtn.className = "mode green active";
  greenBtn.textContent = "Include (green)";

  const redBtn = document.createElement("button");
  redBtn.type = "button";
  redBtn.className = "mode red";
  redBtn.textContent = "Exclude (red)";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "mode";
  clearBtn.textContent = "Clear marks";

  btns.appendChild(greenBtn);
  btns.appendChild(redBtn);
  btns.appendChild(clearBtn);

  top.appendChild(title);
  top.appendChild(btns);

  const wrap = document.createElement("div");
  wrap.className = "canvasWrap";

  const img = document.createElement("img");
  img.alt = "uploaded photo";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  wrap.appendChild(img);
  wrap.appendChild(canvas);

  card.appendChild(top);
  card.appendChild(wrap);
  markups.appendChild(card);

  const editor = {
    file,
    imgEl: img,
    canvas,
    ctx,
    mode: "include", // include=green, exclude=red
    drawing: false,
    lastX: 0,
    lastY: 0
  };

  function setMode(m) {
    editor.mode = m;
    if (m === "include") {
      greenBtn.classList.add("active");
      redBtn.classList.remove("active");
    } else {
      redBtn.classList.add("active");
      greenBtn.classList.remove("active");
    }
  }

  greenBtn.onclick = () => setMode("include");
  redBtn.onclick = () => setMode("exclude");
  clearBtn.onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  function resizeCanvasToImage() {
    // Use natural image size for crisp overlays
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
  }

  img.onload = () => {
    resizeCanvasToImage();
  };

  // load image from file
  const url = URL.createObjectURL(file);
  img.src = url;

  function getXY(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
  }

  function start(ev) {
    editor.drawing = true;
    const { x, y } = getXY(ev);
    editor.lastX = x;
    editor.lastY = y;
  }

  function move(ev) {
    if (!editor.drawing) return;
    const { x, y } = getXY(ev);

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 18;

    if (editor.mode === "include") {
      ctx.strokeStyle = "rgba(0, 180, 0, 0.75)";
    } else {
      ctx.strokeStyle = "rgba(220, 0, 0, 0.75)";
    }

    ctx.beginPath();
    ctx.moveTo(editor.lastX, editor.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    editor.lastX = x;
    editor.lastY = y;
  }

  function end() {
    editor.drawing = false;
  }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);

  // touch support
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    start({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    move({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    end();
  }, { passive: false });

  return editor;
}

photosInput.addEventListener("change", () => {
  markups.innerHTML = "";
  editors = [];
  const files = photosInput.files ? Array.from(photosInput.files) : [];
  files.forEach((f, i) => editors.push(makeEditor(f, i)));
});

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

estimateBtn.onclick = async () => {
  savedMsg.textContent = "";
  const files = photosInput.files ? Array.from(photosInput.files) : [];
  if (!files.length) {
    out.textContent = "Please upload at least 1 photo.";
    return;
  }

  out.textContent = "Analyzing images and estimating volume...";
  estimateBtn.disabled = true;
  estimateBtn.classList.add("loading");

  const jt = getJobType();
  const form = new FormData();
  form.append("job_type", jt);
  form.append("dumpster_size", jt === "STANDARD" ? "" : dumpsterSize.value);
  form.append("notes", notes.value || "");
  form.append("agent_label", agentLabel.value || "");

  // Attach original photos
  for (const f of files) form.append("photos", f);

  // Attach overlays in same order
  for (let i = 0; i < editors.length; i++) {
    const ed = editors[i];
    const blob = await canvasToPngBlob(ed.canvas);
    // Always send overlay even if empty; backend can decide
    form.append("overlays", blob, `overlay_${i + 1}.png`);
  }

  try {
    const data = await api("/api/estimate", { method: "POST", body: form });
    out.textContent = data.result;
    savedMsg.textContent = data.id ? `✓ Saved (#${data.id})` : "✓ Saved";
    savedMsg.className = "hint saved-msg";
  } catch (e) {
    out.textContent = `Error: ${e.message}`;
  } finally {
    estimateBtn.disabled = false;
    estimateBtn.classList.remove("loading");
  }
};

copyBtn.onclick = async () => {
  const text = out.textContent || "";
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  savedMsg.textContent = "Copied";
};

updateDumpsterUI();
checkAuth();
