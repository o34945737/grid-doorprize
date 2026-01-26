// src/routes/doorprize/api.js

const express = require("express");
const pool = require("../../db");
const { requireDoorprizeAdminApi } = require("../../middleware/auth");

const router = express.Router();

/* =========================
   SSE HUB
========================= */
const sseClients = new Set();

function sseSend(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch (_) {}
  }
}

// Realtime stream (SSE)
router.get("/stream", requireDoorprizeAdminApi, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.write(`data: ${JSON.stringify({ type: "hello", ts: Date.now() })}\n\n`);
  sseClients.add(res);

  const ping = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: "ping", ts: Date.now() })}\n\n`);
    } catch (_) {}
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// Optional: biar jelas kalau kebuka via GET
router.get("/grid-draw", requireDoorprizeAdminApi, (req, res) => {
  res.status(405).json({ error: "Use POST /doorprize/api/grid-draw" });
});

/**
 * POST /doorprize/api/grid-draw
 */
router.post("/grid-draw", requireDoorprizeAdminApi, async (req, res) => {
  const prize_name = String(req.body?.prize_name || "").trim();
  const quota = parseInt(req.body?.quota, 10);

  if (!prize_name) return res.status(400).json({ error: "Nama hadiah wajib diisi." });
  if (!Number.isFinite(quota) || quota < 1) return res.status(400).json({ error: "Kuota tidak valid." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

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

    const [drawIns] = await conn.query(
      `INSERT INTO draws (prize_name, quota) VALUES (?, ?)`,
      [prize_name, quota]
    );
    const drawId = drawIns.insertId;

    const winnerValues = winnerIds.map((pid) => [drawId, pid]);
    await conn.query(
      `INSERT INTO draw_winners (draw_id, participant_id) VALUES ?`,
      [winnerValues]
    );

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
    console.error("[doorprize/api grid-draw] ERROR:", e);
    return res.status(500).json({
      error: "Grid draw gagal.",
      detail: e?.message || String(e)
    });
  } finally {
    conn.release();
  }
});

/**
 * Snapshot pemenang
 */
router.get("/winners-snapshot", requireDoorprizeAdminApi, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT participant_id
     FROM draw_winners`
  );

  res.json({
    wonIds: rows.map((r) => r.participant_id)
  });
});

module.exports = router;
