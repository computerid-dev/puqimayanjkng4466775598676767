// Satu endpoint Vercel Function: POST /api/github  { action, token, ... }
// Token hanya diteruskan ke GitHub. Tidak disimpan dan TIDAK PERNAH di-log
// (tidak ada console.log di file ini, jangan menambahkannya).
const { withProxyGuard } = require("../github-uploader/proxy/proxy.js");

const GH = "https://api.github.com";
const RE_USER = /^[A-Za-z0-9-]{1,39}$/;
const RE_REPO = /^[A-Za-z0-9._-]{1,100}$/;

async function gh(token, method, path, body) {
  let r;
  try {
    r = await fetch(GH + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "github-uploader",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    return { status: 502, data: { message: "Server tidak bisa menjangkau api.github.com." } };
  }
  let data = null;
  try { data = await r.json(); } catch { /* body kosong */ }
  return { status: r.status, data };
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const repoSummary = (r) => ({
  name: r.name, private: r.private, archived: r.archived,
  default_branch: r.default_branch, html_url: r.html_url
});

async function handler(req, res) {
  const fail = (status, msg) => res.status(status).json({ error: msg });
  if (req.method !== "POST") return fail(405, "Gunakan metode POST.");

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== "object") return fail(400, "Body JSON tidak valid.");

  const { action, token, username, repo, branch } = b;
  if (!token || typeof token !== "string") return fail(401, "Token kosong.");
  if (!RE_USER.test(username || "")) return fail(400, "Username tidak valid.");

  try {
    if (action === "verify") {
      const u = await gh(token, "GET", "/user");
      if (u.status !== 200) return fail(u.status, u.data?.message || "Gagal verifikasi token.");
      if (u.data.login.toLowerCase() !== username.toLowerCase())
        return fail(403, `Token ini milik akun "${u.data.login}", bukan "${username}".`);
      const repos = [];
      for (let page = 1; page <= 50; page++) {
        const r = await gh(token, "GET", `/user/repos?per_page=100&page=${page}&affiliation=owner&sort=updated`);
        if (r.status !== 200) return fail(r.status, r.data?.message || "Gagal mengambil daftar repo.");
        repos.push(...r.data.map(repoSummary));
        if (r.data.length < 100) break;
      }
      return res.status(200).json({ login: u.data.login, repos });
    }

    if (action === "createRepo") {
      if (!RE_REPO.test(b.name || "")) return fail(400, "Nama repo tidak valid.");
      const r = await gh(token, "POST", "/user/repos", {
        name: b.name, description: String(b.description || "").slice(0, 350),
        private: !!b.private, auto_init: true
      });
      if (r.status !== 201) return fail(r.status, r.data?.errors?.[0]?.message || r.data?.message || "Gagal membuat repo.");
      return res.status(200).json({ repo: repoSummary(r.data) });
    }

    // Aksi di bawah butuh repo + branch valid
    if (!RE_REPO.test(repo || "")) return fail(400, "Nama repo tidak valid.");
    if (!branch || /\s/.test(branch)) return fail(400, "Nama branch tidak valid.");
    const base = `/repos/${username}/${repo}`;

    if (action === "checkRepo") {
      const r = await gh(token, "GET", base);
      if (r.status !== 200) return fail(r.status, r.data?.message || "Repo tidak bisa diakses.");
      const reasons = [];
      if (r.data.archived) reasons.push("Repo berstatus arsip (read-only).");
      if (!r.data.permissions?.push) reasons.push("Token tidak punya izin tulis ke repo ini.");
      const br = await gh(token, "GET", `${base}/branches/${encodeURIComponent(branch)}`);
      if (br.status === 404) reasons.push(`Branch "${branch}" tidak ditemukan.`);
      else if (br.status !== 200) reasons.push(br.data?.message || "Gagal memeriksa branch.");
      return res.status(200).json({ canWrite: reasons.length === 0, reasons, default_branch: r.data.default_branch });
    }

    if (typeof b.path !== "string" || !b.path || b.path.split("/").some((s) => s === ".." || s === ""))
      return fail(400, "Path file tidak valid.");

    if (action === "getFile") {
      const r = await gh(token, "GET", `${base}/contents/${encPath(b.path)}?ref=${encodeURIComponent(branch)}`);
      if (r.status === 404) return res.status(200).json({ exists: false });
      if (r.status !== 200 || Array.isArray(r.data)) return fail(r.status === 200 ? 409 : r.status, r.data?.message || "Path tujuan adalah folder.");
      return res.status(200).json({ exists: true, sha: r.data.sha });
    }

    if (action === "putFile") {
      if (typeof b.content !== "string") return fail(400, "Konten file kosong.");
      const r = await gh(token, "PUT", `${base}/contents/${encPath(b.path)}`, {
        message: String(b.message || "Upload " + b.path).slice(0, 500),
        content: b.content, branch, ...(b.sha ? { sha: b.sha } : {})
      });
      if (r.status !== 200 && r.status !== 201) return fail(r.status, r.data?.message || "Gagal mengunggah file.");
      return res.status(200).json({ ok: true });
    }

    return fail(400, "Aksi tidak dikenal.");
  } catch {
    return fail(500, "Kesalahan internal server.");
  }
}

module.exports = withProxyGuard(handler);
