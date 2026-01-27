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
   DASHBOARD
   GET /voting-dresscode/admin/
====================== */
router.get("/", requireVotingAdmin, async (req, res) => {
  const [[cCount]] = await pool.query(`SELECT COUNT(*) AS cnt FROM voting_candidates`);
  const [[vCount]] = await pool.query(`SELECT COUNT(*) AS cnt FROM voting_votes`);

  const [topMale] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, c.gender, COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     WHERE c.gender='M'
     GROUP BY c.id
     ORDER BY vote_count DESC, c.id ASC
     LIMIT 5`
  );

  const [topFemale] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, c.gender, COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     WHERE c.gender='F'
     GROUP BY c.id
     ORDER BY vote_count DESC, c.id ASC
     LIMIT 5`
  );

  res.render("voting_dresscode/admin_dashboard", {
    admin: req.session.votingAdmin,
    stats: { candidates: cCount.cnt, votes: vCount.cnt },
    topMale,
    topFemale
  });
});

/* ======================
   CANDIDATES PAGE (CRUD + DT)
====================== */
router.get("/candidates", requireVotingAdmin, async (req, res) => {
  res.render("voting_dresscode/admin_candidates", { admin: req.session.votingAdmin });
});

/* JSON untuk DataTables */
router.get("/candidates.json", requireVotingAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, c.gender, c.created_at,
            COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     GROUP BY c.id
     ORDER BY c.id DESC`
  );
  res.json({ data: rows });
});

/* CREATE (upload multi) */
router.post("/upload", requireVotingAdmin, upload.array("photos", 30), async (req, res) => {
  try {
    const gender = String(req.body.gender || "").trim().toUpperCase(); // "M" / "F"
    const photo_name = String(req.body.photo_name || "").trim();

    if (!["M", "F"].includes(gender)) {
      return res.status(400).json({ ok: false, error: "Gender wajib M atau F." });
    }
    if (!req.files || !req.files.length) {
      return res.status(400).json({ ok: false, error: "Minimal upload 1 foto." });
    }

    const values = req.files.map((f) => {
      const url = "/public/uploads/voting/" + f.filename;
      const name = photo_name ? photo_name : (path.parse(f.originalname).name || "Candidate");
      return [name, url, gender];
    });

    await pool.query(
      `INSERT INTO voting_candidates (photo_name, photo_url, gender)
       VALUES ?`,
      [values]
    );

    return res.json({ ok: true, inserted: values.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Upload gagal (server error).", detail: e?.message || String(e) });
  }
});

/* UPDATE name */
router.post("/candidates/:id/update", requireVotingAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const photo_name = String(req.body.photo_name || "").trim();

  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Invalid ID" });
  if (!photo_name) return res.status(400).json({ ok: false, error: "Nama photo wajib diisi" });

  const [r] = await pool.query(
    `UPDATE voting_candidates SET photo_name = ? WHERE id = ?`,
    [photo_name, id]
  );

  res.json({ ok: true, affected: r.affectedRows });
});

/* DELETE candidate + votes + file */
router.post("/candidates/:id/delete", requireVotingAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Invalid ID" });

  const [[row]] = await pool.query(`SELECT photo_url FROM voting_candidates WHERE id = ?`, [id]);

  await pool.query(`DELETE FROM voting_candidates WHERE id = ?`, [id]);

  if (row?.photo_url) {
    const filePath = path.join(__dirname, "../../", row.photo_url.replace("/public/", "public/"));
    try { fs.unlinkSync(filePath); } catch (_) {}
  }

  res.json({ ok: true });
});

/* ======================
   RESULTS PAGE
====================== */
router.get("/results", requireVotingAdmin, async (req, res) => {
  const [maleRows] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     WHERE c.gender='M'
     GROUP BY c.id
     ORDER BY vote_count DESC, c.id ASC`
  );
  const [femaleRows] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     WHERE c.gender='F'
     GROUP BY c.id
     ORDER BY vote_count DESC, c.id ASC`
  );

  res.render("voting_dresscode/admin_results", {
    admin: req.session.votingAdmin,
    maleRows,
    femaleRows
  });
});

module.exports = router;
