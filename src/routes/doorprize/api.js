// src/routes/doorprize/api.js
const express = require("express");
const pool = require("../../db");
const {
  requireDoorprizeAdmin,
  requireDoorprizeAdminApi
} = require("../../middleware/auth");

const router = express.Router();

/* =========================
   SSE HUB
========================= */
const sseClients = new Set();

function sseSend(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (_) {}
  }
}

router.get("/stream", requireDoorprizeAdminApi, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.write(`data: ${JSON.stringify({ type: "hello", ts: Date.now() })}\n\n`);
  sseClients.add(res);

  const ping = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ type: "ping", ts: Date.now() })}\n\n`); } catch (_) {}
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

/* =========================
   GRID DRAW
========================= */

// kalau kebuka lewat browser GET, kasih 405
router.get("/grid-draw", requireDoorprizeAdminApi, (req, res) => {
  res.status(405).json({ error: "Use POST /doorprize/api/grid-draw" });
});

router.post("/grid-draw", requireDoorprizeAdminApi, async (req, res) => {
  const prize_name = String(req.body?.prize_name || "").trim();
  const quota = parseInt(req.body?.quota, 10);

  if (!prize_name) return res.status(400).json({ error: "Nama hadiah wajib diisi." });
  if (!Number.isFinite(quota) || quota < 1) return res.status(400).json({ error: "Kuota tidak valid." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // hitung eligible
    const [[eligibleRow]] = await conn.query(
      `SELECT COUNT(*) AS cnt
       FROM participants p
       LEFT JOIN draw_winners dw ON dw.participant_id = p.id
       WHERE dw.id IS NULL`
    );
    const eligibleCountBefore = eligibleRow.cnt;

    if (eligibleCountBefore < quota) {
      await conn.rollback();
      return res.status(400).json({
        error: `Peserta eligible tinggal ${eligibleCountBefore}, tidak cukup untuk kuota ${quota}.`
      });
    }

    // ambil random eligible ids
    const [pickRows] = await conn.query(
      `SELECT p.id
       FROM participants p
       LEFT JOIN draw_winners dw ON dw.participant_id = p.id
       WHERE dw.id IS NULL
       ORDER BY RAND()
       LIMIT ?`,
      [quota]
    );

    const winnerIds = pickRows.map((r) => r.id);
    if (!winnerIds.length) {
      await conn.rollback();
      return res.status(500).json({ error: "Tidak ada pemenang terpilih." });
    }

    // simpan draw
    const [drawIns] = await conn.query(
      `INSERT INTO draws (prize_name, quota) VALUES (?, ?)`,
      [prize_name, quota]
    );
    const drawId = drawIns.insertId;

    // simpan draw_winners
    const winnerValues = winnerIds.map((pid) => [drawId, pid]);
    await conn.query(
      `INSERT INTO draw_winners (draw_id, participant_id) VALUES ?`,
      [winnerValues]
    );

    // ambil detail pemenang
    const [winnerRows] = await conn.query(
      `SELECT p.id, p.name, p.department
       FROM participants p
       WHERE p.id IN (?)`,
      [winnerIds]
    );

    const winners = winnerRows.map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department ?? null
    }));

    await conn.commit();

    // SSE broadcast
    sseSend({
      type: "draw_completed",
      draw: { id: drawId, prize_name, quota },
      winners
    });

    return res.json({
      draw: { id: drawId, prize_name, quota },
      winners,
      eligibleCountBefore
    });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error("[doorprize grid-draw] ERROR:", e);
    return res.status(500).json({
      error: "Grid draw gagal.",
      detail: e?.message || String(e)
    });
  } finally {
    conn.release();
  }
});

/* =========================
   SNAPSHOT
========================= */
router.get("/winners-snapshot", requireDoorprizeAdminApi, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT participant_id
     FROM draw_winners`
  );
  res.json({ wonIds: rows.map((r) => r.participant_id) });
});

/* =========================
   EXPORT CSV - DRAW WINNERS
========================= */
router.get("/draw-winners.csv", requireDoorprizeAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         dw.id AS winner_id,
         dw.draw_id,
         d.prize_name,
         d.quota,
         d.created_at AS draw_created_at,
         dw.participant_id,
         p.name AS participant_name,
         p.department AS participant_department,
         dw.created_at AS won_at
       FROM draw_winners dw
       JOIN draws d ON d.id = dw.draw_id
       JOIN participants p ON p.id = dw.participant_id
       ORDER BY dw.id DESC`
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=draw_winners_all.csv");

    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const header =
      "winner_id,draw_id,prize_name,quota,draw_created_at,participant_id,participant_name,participant_department,won_at\n";

    const lines = rows.map((r) => {
      const drawCreated = r.draw_created_at ? new Date(r.draw_created_at).toISOString() : "";
      const wonAt = r.won_at ? new Date(r.won_at).toISOString() : "";
      return [
        r.winner_id,
        r.draw_id,
        esc(r.prize_name),
        r.quota,
        esc(drawCreated),
        r.participant_id,
        esc(r.participant_name),
        esc(r.participant_department),
        esc(wonAt)
      ].join(",");
    }).join("\n");

    return res.send("\uFEFF" + header + lines + "\n");
  } catch (e) {
    console.error("[doorprize] draw-winners.csv error:", e);
    return res.status(500).send("Server error");
  }
});

module.exports = router;
