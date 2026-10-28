let repos = [];
const F = KEYS.reduce((o, k) => (o[k] = $(k), o), {});

function read() {
  const s = Object.fromEntries(KEYS.map((k) => [k, F[k].value.trim()]));
  s.targetFolder = s.targetFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  s.branch = s.branch || "main";
  s.commitMessageTemplate = s.commitMessageTemplate || "Upload {filename}";
  return s;
}
function fill(s) { KEYS.forEach((k) => { F[k].value = s[k] || ""; }); renderRepos(); }
function persist() { const s = read(); Store.save(s); return s; }
function busy(btn, on) { btn.disabled = on; }

$("btnToggle").onclick = () => {
  const hide = F.token.type === "password";
  F.token.type = hide ? "text" : "password";
  $("btnToggle").textContent = hide ? "Sembunyi" : "Tampil";
};

$("btnSave").onclick = () => {
  const s = read();
  if (!s.username || !s.token) return msg($("setupMsg"), "Username dan token wajib diisi.", "err");
  Store.save(s);
  msg($("setupMsg"), isComplete(s) ? "Tersimpan di browser ini." : "Tersimpan, tetapi nama repo belum dipilih. Uji koneksi lalu pilih repo.", isComplete(s) ? "ok" : "info");
};

$("btnClear").onclick = () => {
  if (!confirm("Hapus semua data akun dari browser ini?")) return;
  Store.clear(); repos = []; fill({ branch: "main", commitMessageTemplate: "Upload {filename}" });
  msg($("setupMsg"), "Data akun dihapus.", "ok");
};

function renderRepos() {
  const box = $("repoList"); box.textContent = "";
  repos.forEach((r) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "repo-item" + (r.name === F.repo.value ? " sel" : "");
    const n = document.createElement("span"); n.className = "name"; n.textContent = r.name;
    const meta = document.createElement("span"); meta.className = "meta";
    const t = document.createElement("span"); t.className = "badge " + (r.private ? "private" : "public"); t.textContent = r.private ? "PRIVATE" : "PUBLIC";
    meta.append(t);
    if (r.archived) { const a = document.createElement("span"); a.className = "badge"; a.textContent = "ARSIP"; meta.append(a); }
    b.append(n, meta); b.onclick = () => selectRepo(r); box.append(b);
  });
}

function selectRepo(r) {
  F.repo.value = r.name; if (r.default_branch) F.branch.value = r.default_branch;
  persist(); renderRepos();
  msg($("repoMsg"), `Repo "${r.name}" dipilih (branch ${F.branch.value}) dan disimpan.`, "ok");
}

$("btnTest").onclick = async () => {
  const s = read();
  if (!s.username || !s.token) return msg($("setupMsg"), "Isi username dan token dulu.", "err");
  busy($("btnTest"), true); msg($("setupMsg"), "Menguji koneksi...", "info");
  try {
    const d = await api("verify", { token: s.token, username: s.username });
    repos = d.repos; renderRepos();
    msg($("setupMsg"), `Berhasil. Login sebagai ${d.login}. ${repos.length} repo ditemukan.`, "ok");
  } catch (e) { msg($("setupMsg"), errText(e), "err"); }
  finally { busy($("btnTest"), false); }
};

$("btnRepoTest").onclick = async () => {
  const s = read();
  if (!s.username || !s.token || !s.repo) return msg($("repoMsg"), "Isi username, token, dan pilih repo dulu.", "err");
  busy($("btnRepoTest"), true); msg($("repoMsg"), "Memeriksa repo...", "info");
  try {
    const d = await api("checkRepo", { token: s.token, username: s.username, repo: s.repo, branch: s.branch });
    msg($("repoMsg"), d.canWrite ? `Repo "${s.repo}" BISA diisi (izin tulis OK, branch ${s.branch} ada, tidak diarsip).`
      : `Repo "${s.repo}" TIDAK BISA diisi. Alasan: ` + d.reasons.join(" "), d.canWrite ? "ok" : "err");
  } catch (e) { msg($("repoMsg"), "Repo TIDAK BISA diisi. " + errText(e), "err"); }
  finally { busy($("btnRepoTest"), false); }
};

$("btnCreate").onclick = async () => {
  const s = read(), name = $("newName").value.trim();
  if (!s.username || !s.token) return msg($("createMsg"), "Isi username dan token dulu.", "err");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return msg($("createMsg"), "Nama repo hanya boleh huruf, angka, titik, minus, underscore.", "err");
  busy($("btnCreate"), true); msg($("createMsg"), "Membuat repo...", "info");
  try {
    const d = await api("createRepo", { token: s.token, username: s.username, name, description: $("newDesc").value.trim(), private: $("newVis").value === "private" });
    repos = [d.repo, ...repos.filter((r) => r.name !== d.repo.name)];
    selectRepo(d.repo); msg($("createMsg"), `Repo "${d.repo.name}" berhasil dibuat dan otomatis dipilih.`, "ok");
  } catch (e) { msg($("createMsg"), errText(e), "err"); }
  finally { busy($("btnCreate"), false); }
};

$("btnExport").onclick = () => {
  if (!confirm("File JSON akan berisi token GitHub Anda. Lanjut export?")) return;
  const blob = new Blob([JSON.stringify(read(), null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "github-uploader-setup.json";
  a.click(); URL.revokeObjectURL(a.href);
};

function importText(text) {
  try { const s = parseSetup(text); Store.save(s); fill(s); msg($("importMsg"), "Import berhasil dan data disimpan.", "ok"); }
  catch (e) { msg($("importMsg"), e.message, "err"); }
}
$("btnImportFile").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) importText(await f.text());
};
$("btnImportText").onclick = () => importText($("importText").value);

const saved = Store.load(); if (saved) fill(saved);
