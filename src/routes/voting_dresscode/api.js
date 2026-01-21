const express = require("express");
const pool = require("../../db");
const { requireAdminApi } = require("../../middleware/auth");

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
router.get("/stream", requireAdminApi, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // kalau pakai nginx kadang perlu:
  res.setHeader("X-Accel-Buffering", "no");

  // Kirim hello
  res.write(`data: ${JSON.stringify({ type: "hello", ts: Date.now() })}\n\n`);

  sseClients.add(res);

  // optional: ping biar koneksi tidak mati (kadang hosting/proxy)
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

/* =========================
   GRID DRAW
========================= */

// Biar kalau kebuka via browser (GET) gak "Cannot GET", tapi jelas harus POST
router.get("/grid-draw", requireAdminApi, (req, res) => {
  res.status(405).json({ error: "Use POST /api/grid-draw" });
});

/**
 * POST /api/grid-draw
 * - pilih N pemenang unik dari peserta eligible (belum pernah menang)
 * - simpan draw + draw_winners (transaksi)
 * - return winners include department
 */
router.post("/grid-draw", requireAdminApi, async (req, res) => {
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

    // ambil random eligible ids (MySQL ORDER BY RAND)
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
      return res.status(500).json({ error: "Tidak ada pemenang terpilih (winnerIds kosong)." });
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

    // ambil detail pemenang (include department)
    // NOTE: tidak pakai ORDER BY FIELD karena tidak wajib,
    // tapi kalau mau urutan sesuai winnerIds, uncomment FIELD version di bawah.
    const [winnerRows] = await conn.query(
      `SELECT p.id, p.name, p.department
       FROM participants p
       WHERE p.id IN (?)`,
      [winnerIds]
    );

    // optional urut sesuai winnerIds:
    // const [winnerRows] = await conn.query(
    //   `SELECT p.id, p.name, p.department
    //    FROM participants p
    //    WHERE p.id IN (?)
    //    ORDER BY FIELD(p.id, ?)`,
    //   [winnerIds, winnerIds]
    // );

    // Mapping biar pasti ada department (null kalau kosong)
    const winners = winnerRows.map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department ?? null
    }));

    await conn.commit();

    // realtime SSE broadcast
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
    console.error("[grid-draw] ERROR:", e);

    return res.status(500).json({
      error: "Grid draw gagal.",
      detail: e?.message || String(e)
    });
  } finally {
    conn.release();
  }
});

/* =========================
   EXPORT CSV
========================= */

// Export CSV semua pemenang (semua draw)
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

  const header =
    "draw_id,prize_name,quota,draw_created_at,participant_id,participant_name,department,won_at\n";

  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

  const lines = rows
    .map((r) => {
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
    })
    .join("\n");

  res.send(header + lines + "\n");
});

// Export CSV pemenang untuk 1 draw
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

  const header =
    "draw_id,prize_name,quota,draw_created_at,participant_id,participant_name,department,won_at\n";

  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

  const lines = rows
    .map((r) => {
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
    })
    .join("\n");

  res.send(header + lines + "\n");
});

/* =========================
   SNAPSHOT
========================= */

router.get("/grid-draw", requireAdminApi, (req, res) => {
  res.status(405).json({ error: "Use POST /api/grid-draw" });
});


// Snapshot pemenang (untuk refresh state UI tanpa reload)
router.get("/winners-snapshot", requireAdminApi, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT participant_id
     FROM draw_winners`
  );

  res.json({
    wonIds: rows.map((r) => r.participant_id)
  });
});

module.exports = router;
