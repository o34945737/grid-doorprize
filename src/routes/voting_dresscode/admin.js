// src/routes/voting_dresscode/admin.js
const express = require("express");
const pool = require("../../db");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const { requireVotingAdmin } = require("../../middleware/auth");

const router = express.Router();

/** upload folder: src/public/uploads/voting */
const uploadDir = path.join(__dirname, "../../public/uploads/voting");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safe = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error("File harus gambar (png/jpg/webp/gif)"), ok);
  }
});

/* ======================
   AUTH (pakai table admins yang sama)
====================== */
router.get("/login", (req, res) => {
  res.render("voting_dresscode/admin_login", { error: null });
});

router.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();

  const [rows] = await pool.query("SELECT * FROM admins WHERE username = ?", [username]);
  if (!rows.length) return res.render("voting_dresscode/admin_login", { error: "Login gagal." });

  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return res.render("voting_dresscode/admin_login", { error: "Login gagal." });

  req.session.votingAdmin = { id: rows[0].id, username: rows[0].username };
  return res.redirect("/voting-dresscode/admin");
});

router.get("/logout", (req, res) => {
  delete req.session.votingAdmin;
  return res.redirect("/voting-dresscode/admin/login");
});

/* ======================
   DASHBOARD (stats + top5 by votes)
   GET /voting-dresscode/admin/
====================== */
router.get("/", requireVotingAdmin, async (req, res) => {
  const [[cCount]] = await pool.query(`SELECT COUNT(*) AS cnt FROM voting_candidates`);
  const [[vCount]] = await pool.query(`SELECT COUNT(*) AS cnt FROM voting_votes`);

  const [topRows] = await pool.query(`
    SELECT c.id, c.photo_name, c.photo_url,
           COUNT(v.id) AS vote_count
    FROM voting_candidates c
    LEFT JOIN voting_votes v ON v.candidate_id = c.id
    GROUP BY c.id
    ORDER BY vote_count DESC, c.id ASC
    LIMIT 5
  `);

  res.render("voting_dresscode/admin_dashboard", {
    admin: req.session.votingAdmin,
    stats: { candidates: cCount.cnt, votes: vCount.cnt },
    topRows
  });
});

/* ======================
   RESULTS / RANKING PAGE (FULL) by votes
   GET /voting-dresscode/admin/results
====================== */
router.get("/results", requireVotingAdmin, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT c.id, c.photo_name, c.photo_url, c.created_at,
           COUNT(v.id) AS vote_count
    FROM voting_candidates c
    LEFT JOIN voting_votes v ON v.candidate_id = c.id
    GROUP BY c.id
    ORDER BY vote_count DESC, c.id ASC
  `);

  const [[totVotes]] = await pool.query(`SELECT COUNT(*) AS cnt FROM voting_votes`);
  const [[totCandidates]] = await pool.query(`SELECT COUNT(*) AS cnt FROM voting_candidates`);

  res.render("voting_dresscode/admin_results", {
    admin: req.session.votingAdmin,
    rows,
    totals: { votes: totVotes.cnt, candidates: totCandidates.cnt }
  });
});

/* Export CSV ranking */
router.get("/results.csv", requireVotingAdmin, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT c.id, c.photo_name, c.photo_url, c.created_at,
           COUNT(v.id) AS vote_count
    FROM voting_candidates c
    LEFT JOIN voting_votes v ON v.candidate_id = c.id
    GROUP BY c.id
    ORDER BY vote_count DESC, c.id ASC
  `);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=voting_results.csv");

  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const header = "rank,id,photo_name,photo_url,vote_count,created_at\n";

  const lines = rows
    .map((r, idx) => {
      const created = r.created_at ? new Date(r.created_at).toISOString() : "";
      return [
        idx + 1,
        r.id,
        esc(r.photo_name),
        esc(r.photo_url),
        r.vote_count,
        esc(created)
      ].join(",");
    })
    .join("\n");

  res.send("\uFEFF" + header + lines + "\n");
});

/* ======================
   CANDIDATES PAGE (CRUD + DT)
   GET /voting-dresscode/admin/candidates
====================== */
router.get("/candidates", requireVotingAdmin, async (req, res) => {
  res.render("voting_dresscode/admin_candidates", {
    admin: req.session.votingAdmin
  });
});

/* JSON untuk DataTables */
router.get("/candidates.json", requireVotingAdmin, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT c.id, c.photo_name, c.photo_url, c.created_at,
           COUNT(v.id) AS vote_count
    FROM voting_candidates c
    LEFT JOIN voting_votes v ON v.candidate_id = c.id
    GROUP BY c.id
    ORDER BY c.id DESC
  `);

  res.json({ data: rows });
});

/* CREATE (upload) */
router.post("/upload", requireVotingAdmin, upload.single("photo"), async (req, res) => {
  try {
    const photo_name = String(req.body.photo_name || "").trim();

    if (!photo_name) return res.status(400).json({ ok: false, error: "Nama photo wajib diisi." });
    if (!req.file) return res.status(400).json({ ok: false, error: "Photo wajib diupload." });

    const photo_url = "/public/uploads/voting/" + req.file.filename;

    await pool.query(
      `INSERT INTO voting_candidates (photo_name, photo_url)
       VALUES (?, ?)`,
      [photo_name, photo_url]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("[voting admin upload] error:", e);
    res.status(500).json({ ok: false, error: "Server error", detail: e?.message || String(e) });
  }
});

/* UPDATE name */
router.post("/candidates/:id/update", requireVotingAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const photo_name = String(req.body.photo_name || "").trim();

    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Invalid ID" });
    if (!photo_name) return res.status(400).json({ ok: false, error: "Nama photo wajib diisi" });

    const [r] = await pool.query(
      `UPDATE voting_candidates SET photo_name = ? WHERE id = ?`,
      [photo_name, id]
    );

    res.json({ ok: true, affected: r.affectedRows });
  } catch (e) {
    console.error("[voting admin update] error:", e);
    res.status(500).json({ ok: false, error: "Server error", detail: e?.message || String(e) });
  }
});

/* DELETE candidate (+ votes ikut terhapus) */
router.post("/candidates/:id/delete", requireVotingAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Invalid ID" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ambil photo_url untuk hapus file
    const [[row]] = await conn.query(`SELECT photo_url FROM voting_candidates WHERE id = ?`, [id]);

    // hapus votes manual (biar aman walau belum FK cascade)
    await conn.query(`DELETE FROM voting_votes WHERE candidate_id = ?`, [id]);

    // hapus candidate
    const [del] = await conn.query(`DELETE FROM voting_candidates WHERE id = ?`, [id]);

    await conn.commit();

    // hapus file fisik (best-effort)
    if (row?.photo_url) {
      const filePath = path.join(__dirname, "../../", row.photo_url.replace("/public/", "public/"));
      try { fs.unlinkSync(filePath); } catch (_) {}
    }

    res.json({ ok: true, deleted: del.affectedRows });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error("[voting admin delete] error:", e);
    res.status(500).json({ ok: false, error: "Server error", detail: e?.message || String(e) });
  } finally {
    conn.release();
  }
});

module.exports = router;
