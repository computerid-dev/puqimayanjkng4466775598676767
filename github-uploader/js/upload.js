const MAX_BYTES = 3 * 1024 * 1024;   // batas efektif: body Vercel 4,5 MB (base64 +33%)
const WARN_BYTES = 1024 * 1024;
const STATUS = { waiting: "MENUNGGU", uploading: "MENGUNGGAH", success: "BERHASIL", failed: "GAGAL", skipped: "DILEWATI" };
const setup = Store.load();
if (!isComplete(setup)) { location.replace("setup.html"); }

let items = [], running = false, uid = 0;
$("hAcc").textContent = "Akun: " + (setup?.username || "-");
$("hRepo").textContent = "Repo: " + (setup?.repo || "-");
$("hBranch").textContent = "Branch: " + (setup?.branch || "-");

function toB64(bytes) {
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function cleanPath(p) {
  const parts = p.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  return parts.some((s) => s === "..") ? null : parts.join("/");
}

function addItems(list) {
  const notes = [];
  list.forEach(({ path, size, read }) => {
    const p = cleanPath(path);
    if (!p) return notes.push(`${path}: path tidak valid, ditolak.`);
    if (size > MAX_BYTES) return notes.push(`${p} (${fmtSize(size)}): DITOLAK, melebihi batas ${fmtSize(MAX_BYTES)} per file.`);
    if (size > WARN_BYTES) notes.push(`${p} (${fmtSize(size)}): file besar, upload bisa lambat.`);
    items = items.filter((i) => i.path !== p);
    items.push({ id: ++uid, path: p, size, read, status: "waiting", error: "" });
  });
  msg($("notice"), notes.join("\n"), notes.some((n) => n.includes("DITOLAK")) ? "err" : "info");
  $("notice").style.whiteSpace = "pre-line";
  render();
}

function render() {
  $("count").textContent = items.length;
  const ul = $("list"); ul.textContent = "";
  items.forEach((it) => {
    const li = document.createElement("li");
    const n = document.createElement("span"); n.className = "name"; n.textContent = `${it.path} (${fmtSize(it.size)})` + (it.error ? " - " + it.error : "");
    const meta = document.createElement("span"); meta.className = "meta";
    const b = document.createElement("span"); b.className = "badge " + it.status; b.textContent = STATUS[it.status];
    const del = document.createElement("button"); del.className = "btn sm bad"; del.textContent = "Hapus"; del.disabled = running;
    del.onclick = () => { items = items.filter((x) => x.id !== it.id); render(); };
    meta.append(b, del); li.append(n, meta); ul.append(li);
  });
  const done = items.filter((i) => ["success", "failed", "skipped"].includes(i.status)).length;
  $("barFill").style.width = items.length ? (done / items.length) * 100 + "%" : "0";
  $("btnUpload").disabled = running || !items.some((i) => i.status === "waiting");
  $("btnClear").disabled = running;
  $("btnRetry").classList.toggle("hidden", running || !items.some((i) => i.status === "failed"));
}

$("btnPick").onclick = () => $("fileInput").click();
$("fileInput").onchange = (e) => {
  const fs = [...e.target.files]; e.target.value = "";
  addItems(fs.map((f) => ({ path: f.name, size: f.size, read: async () => toB64(new Uint8Array(await f.arrayBuffer())) })));
};
$("btnPickZip").onclick = () => $("zipInput").click();
$("zipInput").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  msg($("notice"), "Mengekstrak ZIP...", "info");
  try {
    const zip = await JSZip.loadAsync(f), found = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || /(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(entry.name)) continue;
      const bytes = await entry.async("uint8array");
      found.push({ path: entry.name, size: bytes.length, read: async () => toB64(bytes) });
    }
    if (!found.length) return msg($("notice"), "ZIP kosong atau tidak berisi file.", "err");
    addItems(found);
  } catch { msg($("notice"), "Gagal membaca ZIP. Pastikan file valid dan tidak diproteksi password.", "err"); }
};

function selectTab(zip) {
  $("tabFiles").setAttribute("aria-selected", !zip); $("tabZip").setAttribute("aria-selected", zip);
  $("paneFiles").classList.toggle("hidden", zip); $("paneZip").classList.toggle("hidden", !zip);
}
$("tabFiles").onclick = () => selectTab(false);
$("tabZip").onclick = () => selectTab(true);

$("btnClear").onclick = () => { items = []; $("summary").textContent = ""; $("summary").className = "msg"; msg($("notice"), "", ""); msg($("progText"), "", ""); render(); };

function askConflict(path) {
  return new Promise((resolve) => {
    const dlg = $("dlg"); $("dlgText").textContent = `File "${path}" sudah ada di repo. Timpa atau lewati?`;
    $("dlgAll").checked = false; dlg.returnValue = "";
    dlg.addEventListener("close", () => resolve({ choice: dlg.returnValue === "overwrite" ? "overwrite" : "skip", all: $("dlgAll").checked }), { once: true });
    dlg.showModal();
  });
}

async function run(queue) {
  if (running || !queue.length) return;
  running = true; let decision = null; queue.forEach((i) => { i.status = "waiting"; i.error = ""; }); render();
  const base = { token: setup.token, username: setup.username, repo: setup.repo, branch: setup.branch };
  let n = 0;
  for (const it of queue) {   // berurutan, bukan paralel
    it.status = "uploading"; msg($("progText"), `Mengunggah ${++n} dari ${queue.length}: ${it.path}`, "info"); render();
    const dest = [setup.targetFolder, it.path].filter(Boolean).join("/");
    try {
      const f = await api("getFile", { ...base, path: dest });
      let sha;
      if (f.exists) {
        const d = decision || await askConflict(dest);
        if (d.all) decision = d;
        if (d.choice === "skip") { it.status = "skipped"; render(); continue; }
        sha = f.sha;
      }
      const name = it.path.split("/").pop();
      await api("putFile", { ...base, path: dest, sha, content: await it.read(), message: setup.commitMessageTemplate.replace(/{filename}/g, name) });
      it.status = "success";
    } catch (e) {
      it.status = "failed"; it.error = errText(e);
      if (e.status === 401) { render(); break; }
    }
    render();
  }
  running = false; render(); msg($("progText"), "Selesai.", "ok");
  const c = (s) => items.filter((i) => i.status === s).length;
  const link = `https://github.com/${setup.username}/${setup.repo}/tree/${setup.branch}`;
  const el = $("summary"); el.className = "msg " + (c("failed") ? "err" : "ok");
  el.textContent = `Berhasil: ${c("success")} | Gagal: ${c("failed")} | Dilewati: ${c("skipped")}  `;
  const a = document.createElement("a"); a.href = link; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Buka repo di GitHub"; el.append(a);
}

$("btnUpload").onclick = () => run(items.filter((i) => i.status === "waiting"));
$("btnRetry").onclick = () => run(items.filter((i) => i.status === "failed"));
render();
