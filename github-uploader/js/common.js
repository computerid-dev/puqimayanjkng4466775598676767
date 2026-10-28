const KEYS = ["token", "username", "repo", "branch", "targetFolder", "commitMessageTemplate"];
const $ = (id) => document.getElementById(id);

const Store = {
  key: "ghu_setup",
  load() { try { return JSON.parse(localStorage.getItem(this.key)); } catch { return null; } },
  save(d) { localStorage.setItem(this.key, JSON.stringify(d)); },
  clear() { localStorage.removeItem(this.key); }
};

function isComplete(s) {
  return !!(s && s.token && s.username && s.repo && s.branch && s.commitMessageTemplate);
}

function parseSetup(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error("JSON tidak valid: " + e.message); }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("Format salah: isi harus berupa objek JSON { ... }.");
  const missing = KEYS.filter((k) => !(k in o));
  if (missing.length) throw new Error("Key wajib tidak ditemukan: " + missing.join(", ") + ".");
  const bad = KEYS.filter((k) => typeof o[k] !== "string");
  if (bad.length) throw new Error("Nilai harus berupa teks (string) untuk key: " + bad.join(", ") + ".");
  return Object.fromEntries(KEYS.map((k) => [k, o[k]]));
}

async function api(action, payload) {
  let r;
  try {
    r = await fetch("/api/github", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload })
    });
  } catch { throw { status: 0, message: "" }; }
  let d = {};
  try { d = await r.json(); } catch { /* bukan JSON */ }
  if (!r.ok) throw { status: r.status, message: d.error || "" };
  return d;
}

function errText(e) {
  const detail = e.message ? " Detail: " + e.message : "";
  if (e.status === 0) return "Error jaringan: tidak bisa menghubungi server. Periksa koneksi internet Anda.";
  if (e.status === 401) return "401: Token tidak valid, salah, atau sudah kedaluwarsa." + detail;
  if (e.status === 403) return "403: Akses ditolak. Izin token kurang, rate limit GitHub tercapai, atau username tidak cocok dengan token." + detail;
  if (e.status === 404) return "404: Tidak ditemukan. Periksa username, nama repo, dan branch." + detail;
  return "Error " + e.status + ": " + (e.message || "terjadi kesalahan.");
}

function msg(el, text, type) { el.textContent = text; el.className = "msg " + (type || ""); }
function fmtSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB"; }
