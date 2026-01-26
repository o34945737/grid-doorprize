// src/routes/voting_dresscode/api.js
const express = require("express");
const pool = require("../../db");

const router = express.Router();

/**
 * PUBLIC API
 * POST /voting-dresscode/api/vote
 * body: { candidate_id: number }
 */
router.post("/vote", async (req, res) => {
  const candidate_id = parseInt(req.body?.candidate_id, 10);

  if (!Number.isFinite(candidate_id)) {
    return res.status(400).json({ ok: false, error: "candidate_id tidak valid" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // pastikan candidate ada
    const [[cand]] = await conn.query(
      `SELECT id FROM voting_candidates WHERE id = ? LIMIT 1`,
      [candidate_id]
    );
    if (!cand) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Candidate tidak ditemukan" });
    }

    // insert vote (simple: setiap klik = 1 vote)
    await conn.query(
      `INSERT INTO voting_votes (candidate_id, created_at)
       VALUES (?, NOW())`,
      [candidate_id]
    );

    // hitung total vote terbaru
    const [[cnt]] = await conn.query(
      `SELECT COUNT(*) AS vote_count
       FROM voting_votes
       WHERE candidate_id = ?`,
      [candidate_id]
    );

    await conn.commit();

    return res.json({
      ok: true,
      candidate_id,
      vote_count: cnt.vote_count
    });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error("[VOTE API] ERROR:", e);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: e?.message || String(e)
    });
  } finally {
    conn.release();
  }
});

/**
 * OPTIONAL: list candidates + vote_count (kalau kamu butuh di user page via ajax)
 */
router.get("/candidates.json", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.photo_name, c.photo_url, c.created_at,
              COUNT(v.id) AS vote_count
       FROM voting_candidates c
       LEFT JOIN voting_votes v ON v.candidate_id = c.id
       GROUP BY c.id
       ORDER BY c.id DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error("[candidates.json] ERROR:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
