const loginCard = document.getElementById("loginCard");
const appCard = document.getElementById("appCard");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const pin = document.getElementById("pin");
const loginErr = document.getElementById("loginErr");

const out = document.getElementById("out");
const copyBtn = document.getElementById("copyBtn");
const savedMsg = document.getElementById("savedMsg");
const hint = document.getElementById("hint");

const estimateBtn = document.getElementById("estimateBtn");
const photos = document.getElementById("photos");
const notes = document.getElementById("notes");
const agentLabel = document.getElementById("agentLabel");

const dumpsterBox = document.getElementById("dumpsterBox");
const dumpsterSize = document.getElementById("dumpsterSize");

function getJobType() {
  const r = document.querySelector("input[name='jobType']:checked");
  return r ? r.value : "STANDARD";
}

function updateDumpsterUI() {
  const jt = getJobType();
  dumpsterBox.classList.toggle("hidden", jt === "STANDARD");

  const count = (photos.files || []).length;
  if (count === 1) {
    hint.textContent = "Tip: 2+ angles improves accuracy.";
  } else {
    hint.textContent = "";
  }
}

document.querySelectorAll("input[name='jobType']").forEach(el => {
  el.addEventListener("change", updateDumpsterUI);
});
photos.addEventListener("change", updateDumpsterUI);

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function checkAuth() {
  // If /api/history returns 401, we assume locked
  try {
    await api("/api/history?limit=1", { method: "GET" });
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
    await checkAuth();
  } catch (e) {
    loginErr.textContent = e.message;
  }
};

logoutBtn.onclick = async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  await checkAuth();
};

estimateBtn.onclick = async () => {
  savedMsg.textContent = "";
  const files = photos.files;
  if (!files || !files.length) {
    out.textContent = "Please upload at least 1 photo.";
    return;
  }

  out.textContent = "Estimating…";

  const jt = getJobType();
  const form = new FormData();
  form.append("job_type", jt);
  form.append("dumpster_size", jt === "STANDARD" ? "" : dumpsterSize.value);
  form.append("notes", notes.value || "");
  form.append("agent_label", agentLabel.value || "");

  for (const f of files) form.append("photos", f);

  try {
    const data = await api("/api/estimate", { method: "POST", body: form });
    out.textContent = data.result;
    savedMsg.textContent = `Saved (#${data.id})`;
  } catch (e) {
    out.textContent = `Error: ${e.message}`;
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
