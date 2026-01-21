const express = require("express");
const pool = require("../db");
const bcrypt = require("bcrypt");
const { requireAdmin } = require("../middleware/auth");
const multer = require("multer");
const XLSX = require("xlsx");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});


// ---------- Auth ----------
router.get("/login", (req, res) => {
  res.render("admin_login", { error: null });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const [rows] = await pool.query("SELECT * FROM admins WHERE username = ?", [username]);
  if (!rows.length) return res.render("admin_login", { error: "Login gagal." });

  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return res.render("admin_login", { error: "Login gagal." });

  req.session.admin = { id: rows[0].id, username: rows[0].username };
  res.redirect("/admin");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

// ---------- Dashboard ----------
router.get("/", requireAdmin, async (req, res) => {
  const [[pCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM participants");
  const [[drawCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM draws");
  const [[winnerCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM draw_winners");

  // eligible = peserta yang belum pernah menang (di draw_winners)
  const [[eligibleRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM participants p
     LEFT JOIN draw_winners dw ON dw.participant_id = p.id
     WHERE dw.id IS NULL`
  );

  res.render("admin_dashboard", {
    pCount: pCount.cnt,
    drawCount: drawCount.cnt,
    winnerCount: winnerCount.cnt,
    eligibleCount: eligibleRow.cnt
  });
});

// ---------- Grid Draw page ----------
router.get("/grid-draw", requireAdmin, async (req, res) => {
  const [participants] = await pool.query(
    `SELECT p.id, p.name,
      CASE WHEN dw.id IS NOT NULL THEN 1 ELSE 0 END AS has_won
     FROM participants p
     LEFT JOIN draw_winners dw ON dw.participant_id = p.id
     ORDER BY p.id ASC`
  );

  const [[eligibleRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM participants p
     LEFT JOIN draw_winners dw ON dw.participant_id = p.id
     WHERE dw.id IS NULL`
  );

  res.render("admin_grid_draw", {
    participants,
    eligibleCount: eligibleRow.cnt
  });
});

// ---------- List draws ----------
router.get("/draws", requireAdmin, async (req, res) => {
  const [draws] = await pool.query(
    `SELECT d.*,
      (SELECT COUNT(*) FROM draw_winners dw WHERE dw.draw_id=d.id) AS winner_count
     FROM draws d
     ORDER BY d.id DESC`
  );
  res.render("admin_draws", { draws });
});

// ---------- Import Excel Peserta ----------
router.get("/import", requireAdmin, async (req, res) => {
  res.render("admin_import", { msg: null, ok: true, summary: null });
});

// Download template Excel
router.get("/import/template", requireAdmin, async (req, res) => {
  const data = [
    { name: "John Doe", department: "IT" },
    { name: "Jane Doe", department: "HR" }
  ];

  const ws = XLSX.utils.json_to_sheet(data, { header: ["name", "department"] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "participants");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=template_participants.xlsx");
  res.send(buf);
});

// Upload & import
router.post("/import", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.render("admin_import", { msg: "File tidak ditemukan.", ok: false, summary: null });
    }

    // baca workbook
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) {
      return res.render("admin_import", { msg: "Excel tidak punya sheet.", ok: false, summary: null });
    }

    const ws = wb.Sheets[sheetName];

    // json array; defval "" biar kosong jadi string kosong
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (!rows.length) {
      return res.render("admin_import", { msg: "Sheet kosong (tidak ada data).", ok: false, summary: null });
    }

    // Normalisasi header: dukung variasi "Nama", "Name", dll
    function pick(obj, keys) {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
      }
      return "";
    }

    let skippedEmptyName = 0;
    const values = [];

    for (const r of rows) {
      const name = String(
        pick(r, ["name", "Name", "nama", "Nama", "NAMA"])
      ).trim();

      const department = String(
        pick(r, ["department", "Department", "departemen", "Departemen", "DEPARTMENT"])
      ).trim();

      if (!name) {
        skippedEmptyName++;
        continue;
      }

      values.push([name, department || null]);
    }

    if (!values.length) {
      return res.render("admin_import", {
        msg: "Semua baris di-skip karena nama kosong.",
        ok: false,
        summary: { totalRows: rows.length, upserted: 0, skippedEmptyName }
      });
    }

    // bulk upsert:
    // - kalau email sama => update name & phone
    // - kalau email null => insert normal (MySQL membolehkan multiple NULL untuk UNIQUE)
   const [result] = await pool.query(
      `INSERT INTO participants (name, department)
      VALUES ?`,
      [values]
    );
    
    // result.affectedRows di MySQL: insert=1, update=2 (kadang), jadi ini hanya estimasi
    const upserted = values.length;

    return res.render("admin_import", {
      msg: "Import berhasil.",
      ok: true,
      summary: { totalRows: rows.length, upserted, skippedEmptyName }
    });
  } catch (e) {
    console.error(e);
    return res.render("admin_import", { msg: "Import gagal (cek format file).", ok: false, summary: null });
  }
});

module.exports = router;
