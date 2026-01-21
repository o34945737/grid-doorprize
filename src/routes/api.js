const express = require("express");
const pool = require("../db");
const { requireAdminApi } = require("../middleware/auth");
const sseClients = new Set();

function sseSend(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (_) {}
  }
}

const router = express.Router();

/**
 * GRID DRAW
 * - pilih N pemenang unik dari peserta eligible (belum pernah menang)
 * - simpan draw + draw_winners (transaksi)
 */

// Realtime stream (SSE)
router.get("/stream", requireAdminApi, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // kalau pakai nginx kadang perlu:
  res.setHeader("X-Accel-Buffering", "no");

  res.write(`data: ${JSON.stringify({ type: "hello", ts: Date.now() })}\n\n`);

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});


router.post("/grid-draw", requireAdminApi, async (req, res) => {
  const prize_name = String(req.body.prize_name || "").trim();
  const quota = parseInt(req.body.quota, 10);

  if (!prize_name) return res.status(400).json({ error: "prize_name wajib diisi." });
  if (!Number.isFinite(quota) || quota < 1) return res.status(400).json({ error: "quota harus angka >= 1." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[eligibleRow]] = await conn.query(
      `SELECT COUNT(*) AS cnt
       FROM participants p
       LEFT JOIN draw_winners dw ON dw.participant_id = p.id
       WHERE dw.id IS NULL`
    );
    const eligibleCount = eligibleRow.cnt;

    if (eligibleCount === 0) {
      await conn.rollback();
      return res.status(400).json({ error: "Tidak ada peserta eligible (semua sudah menang)." });
    }
    if (quota > eligibleCount) {
      await conn.rollback();
      return res.status(400).json({
        error: `Kuota melebihi peserta eligible. Eligible: ${eligibleCount}, quota: ${quota}.`
      });
    }

    // create draw
    const [drawIns] = await conn.query(
      "INSERT INTO draws (prize_name, quota) VALUES (?, ?)",
      [prize_name, quota]
    );
    const drawId = drawIns.insertId;

    // ambil random N peserta eligible (untuk ratusan aman)
    const [winnerRows] = await conn.query(
      `SELECT p.id, p.name
       FROM participants p
       LEFT JOIN draw_winners dw ON dw.participant_id = p.id
       WHERE dw.id IS NULL
       ORDER BY RAND()
       LIMIT ?`,
      [quota]
    );

    const values = winnerRows.map(r => [drawId, r.id]);
    await conn.query("INSERT INTO draw_winners (draw_id, participant_id) VALUES ?", [values]);

    await conn.commit();

    // Kirim realtime update
    sseSend({
      type: "draw_completed",
      draw: { id: drawId, prize_name, quota },
      winners: winnerRows.map(r => ({ id: r.id, name: r.name }))
    });

    res.json({
      draw: { id: drawId, prize_name, quota },
      winners: winnerRows,
      eligibleCountBefore: eligibleCount
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: "Grid draw gagal." });
  } finally {
    conn.release();
  }
});

/**
 * Export CSV semua pemenang (semua draw)
 */
router.get("/draw-winners.csv", requireAdminApi, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.id AS draw_id, d.prize_name, d.quota, d.created_at AS draw_created_at,
            p.id AS participant_id, p.name AS participant_name, p.department, 
            dw.created_at AS won_at
     FROM draw_winners dw
     JOIN draws d ON d.id = dw.draw_id
     JOIN participants p ON p.id = dw.participant_id
     ORDER BY d.id DESC, dw.id ASC`
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=draw_winners_all.csv");

  const header = "draw_id,prize_name,quota,draw_created_at,participant_id,participant_name,department,won_at\n";
  const lines = rows.map(r => {
    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    return [
      r.draw_id,
      esc(r.prize_name),
      r.quota,
      esc(new Date(r.draw_created_at).toISOString()),
      r.participant_id,
      esc(r.participant_name),
      esc(r.department),
      esc(new Date(r.won_at).toISOString())
    ].join(",");
  }).join("\n");

  res.send(header + lines + "\n");
});

/**
 * Export CSV pemenang untuk 1 draw
 */
router.get("/draws/:id/winners.csv", requireAdminApi, async (req, res) => {
  const drawId = parseInt(req.params.id, 10);
  if (!Number.isFinite(drawId)) return res.status(400).send("Invalid draw id");

  const [rows] = await pool.query(
    `SELECT d.id AS draw_id, d.prize_name, d.quota, d.created_at AS draw_created_at,
            p.id AS participant_id, p.name AS participant_name, p.department,
            dw.created_at AS won_at
     FROM draw_winners dw
     JOIN draws d ON d.id = dw.draw_id
     JOIN participants p ON p.id = dw.participant_id
     WHERE d.id = ?
     ORDER BY dw.id ASC`,
    [drawId]
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=draw_${drawId}_winners.csv`);

  const header = "draw_id,prize_name,quota,draw_created_at,participant_id,participant_name,department,won_at\n";
  const lines = rows.map(r => {
    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    return [
      r.draw_id,
      esc(r.prize_name),
      r.quota,
      esc(new Date(r.draw_created_at).toISOString()),
      r.participant_id,
      esc(r.participant_name),
      esc(r.department),
      esc(new Date(r.won_at).toISOString())
    ].join(",");
  }).join("\n");

  res.send(header + lines + "\n");
});

// Snapshot pemenang (untuk refresh state UI tanpa reload)
router.get("/winners-snapshot", requireAdminApi, async (req, res) => {
  // semua participant_id yang sudah menang
  const [rows] = await pool.query(
    `SELECT DISTINCT participant_id
     FROM draw_winners`
  );

  res.json({
    wonIds: rows.map(r => r.participant_id)
  });
});


module.exports = router;
