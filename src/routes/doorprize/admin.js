// src/routes/doorprize/admin.js
const express = require("express");
const pool = require("../../db");
const bcrypt = require("bcrypt");
const { requireDoorprizeAdmin } = require("../../middleware/auth");
const multer = require("multer");
const XLSX = require("xlsx");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

/* =========================
   AUTH
========================= */
router.get("/login", (req, res) => {
  res.render("doorprize/admin_login", { error: null });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const [rows] = await pool.query("SELECT * FROM admins WHERE username = ?", [username]);
  if (!rows.length) return res.render("doorprize/admin_login", { error: "Login gagal." });

  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return res.render("doorprize/admin_login", { error: "Login gagal." });

  // ✅ SESSION KHUSUS DOORPRIZE
  req.session.doorprizeAdmin = { id: rows[0].id, username: rows[0].username };
  return res.redirect("/doorprize/admin");
});

router.get("/logout", (req, res) => {
  delete req.session.doorprizeAdmin;
  return res.redirect("/doorprize/admin/login");
});

/* =========================
   DASHBOARD
========================= */
router.get("/", requireDoorprizeAdmin, async (req, res) => {
  const [[pCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM participants");
  const [[drawCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM draws");
  const [[winnerCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM draw_winners");

  const [[eligibleRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM participants p
     LEFT JOIN draw_winners dw ON dw.participant_id = p.id
     WHERE dw.id IS NULL`
  );

  res.render("doorprize/admin_dashboard", {
    pCount: pCount.cnt,
    drawCount: drawCount.cnt,
    winnerCount: winnerCount.cnt,
    eligibleCount: eligibleRow.cnt
  });
});

/* =========================
   GRID DRAW PAGE
========================= */
router.get("/grid-draw", requireDoorprizeAdmin, async (req, res) => {
  const [participants] = await pool.query(
    `SELECT p.id, p.name, p.department,
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

  res.render("doorprize/admin_grid_draw", {
    participants,
    eligibleCount: eligibleRow.cnt
  });
});

/* =========================
   LIST DRAWS
========================= */
router.get("/draws", requireDoorprizeAdmin, async (req, res) => {
  const [draws] = await pool.query(
    `SELECT d.*,
      (SELECT COUNT(*) FROM draw_winners dw WHERE dw.draw_id=d.id) AS winner_count
     FROM draws d
     ORDER BY d.id DESC`
  );

  res.render("doorprize/admin_draws", { draws });
});

/* =========================
   IMPORT EXCEL PARTICIPANTS
========================= */
router.get("/import", requireDoorprizeAdmin, async (req, res) => {
  res.render("doorprize/admin_import", { msg: null, ok: true, summary: null });
});

router.get("/import/template", requireDoorprizeAdmin, async (req, res) => {
  const data = [
    { name: "John Doe", department: "IT" },
    { name: "Jane Doe", department: "Human Resource" }
  ];

  const ws = XLSX.utils.json_to_sheet(data, { header: ["name", "department"] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "participants");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=template_participants.xlsx");
  res.send(buf);
});

router.post("/import", requireDoorprizeAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.render("doorprize/admin_import", { msg: "File tidak ditemukan.", ok: false, summary: null });
    }

    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) {
      return res.render("doorprize/admin_import", { msg: "Excel tidak punya sheet.", ok: false, summary: null });
    }

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (!rows.length) {
      return res.render("doorprize/admin_import", { msg: "Sheet kosong (tidak ada data).", ok: false, summary: null });
    }

    function pick(obj, keys) {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
      }
      return "";
    }

    let skippedEmptyName = 0;
    const values = [];

    for (const r of rows) {
      const name = String(pick(r, ["name", "Name", "nama", "Nama", "NAMA"])).trim();
      const department = String(pick(r, ["department", "Department", "departemen", "Departemen", "DEPARTMENT"])).trim();

      if (!name) {
        skippedEmptyName++;
        continue;
      }
      values.push([name, department || null]);
    }

    if (!values.length) {
      return res.render("doorprize/admin_import", {
        msg: "Semua baris di-skip karena nama kosong.",
        ok: false,
        summary: { totalRows: rows.length, inserted: 0, skippedEmptyName }
      });
    }

    await pool.query(
      `INSERT INTO participants (name, department)
       VALUES ?`,
      [values]
    );

    return res.render("doorprize/admin_import", {
      msg: "Import berhasil.",
      ok: true,
      summary: { totalRows: rows.length, inserted: values.length, skippedEmptyName }
    });
  } catch (e) {
    console.error(e);
    return res.render("doorprize/admin_import", {
      msg: "Import gagal (cek format file).",
      ok: false,
      summary: null
    });
  }
});

/* =========================
   PARTICIPANTS (DATATABLES)
========================= */
router.get("/participants", requireDoorprizeAdmin, async (req, res) => {
  res.render("doorprize/admin_participants");
});

router.get("/participants.json", requireDoorprizeAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, department, created_at
     FROM participants
     ORDER BY id DESC`
  );
  res.json({ data: rows });
});

router.get("/participants.csv", requireDoorprizeAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, department, created_at
     FROM participants
     ORDER BY id ASC`
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=participants_all.csv");

  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const header = "id,name,department,created_at\n";
  const lines = rows.map((r) => {
    const dt = r.created_at ? new Date(r.created_at).toISOString() : "";
    return [r.id, esc(r.name), esc(r.department), esc(dt)].join(",");
  }).join("\n");

  res.send("\uFEFF" + header + lines + "\n");
});

router.post("/participants/:id/delete", requireDoorprizeAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Invalid ID" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query("DELETE FROM draw_winners WHERE participant_id = ?", [id]);
    const [del] = await conn.query("DELETE FROM participants WHERE id = ?", [id]);

    await conn.commit();
    return res.json({ ok: true, deleted: del.affectedRows });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error(e);
    return res.status(500).json({ ok: false, error: "Gagal menghapus participant" });
  } finally {
    conn.release();
  }
});

module.exports = router;
