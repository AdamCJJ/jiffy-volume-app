const tblBody = document.querySelector("#tbl tbody");
const detail = document.getElementById("detail");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

async function load() {
  status.textContent = "Loading…";
  tblBody.innerHTML = "";
  detail.textContent = "Click a row to view full result…";

  const { rows } = await api("/api/history?limit=150", { method: "GET" });
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${fmtTime(r.created_at)}</td>
      <td>${r.agent_label || ""}</td>
      <td>${r.job_type}</td>
      <td>${r.dumpster_size ? r.dumpster_size + "y" : ""}</td>
      <td>${r.photo_count}</td>
      <td>${r.confidence || ""}</td>
      <td>${(r.result_preview || "").replaceAll("<","&lt;")}</td>
    `;
    tr.onclick = async () => {
      const data = await api(`/api/estimate/${r.id}`, { method: "GET" });
      detail.textContent = data.row.result_text;
    };
    tblBody.appendChild(tr);
  }

  status.textContent = `Loaded ${rows.length}`;
}

refreshBtn.onclick = load;
load().catch(e => (status.textContent = "Error: " + e.message));
