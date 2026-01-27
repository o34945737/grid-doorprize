const express = require("express");
const pool = require("../../db");

const router = express.Router();

router.post("/vote", async (req, res) => {
  const candidate_id = parseInt(req.body?.candidate_id, 10);
  if (!Number.isFinite(candidate_id) || candidate_id < 1) {
    return res.status(400).json({ ok: false, error: "Candidate tidak valid." });
  }

  const sessionId = String(req.sessionID || "").slice(0, 128);
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: "Session tidak tersedia." });
  }

  let cand = null;

  try {
    const [[c]] = await pool.query(
      `SELECT id, gender FROM voting_candidates WHERE id=? LIMIT 1`,
      [candidate_id]
    );
    cand = c;

    if (!cand) return res.status(400).json({ ok: false, error: "Candidate tidak ditemukan." });

    await pool.query(
      `INSERT INTO voting_votes (session_id, candidate_id, gender)
       VALUES (?, ?, ?)`,
      [sessionId, cand.id, cand.gender]
    );

    return res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        ok: false,
        error: (cand?.gender === "M")
          ? "Kamu sudah vote kandidat laki-laki."
          : "Kamu sudah vote kandidat perempuan."
      });
    }

    console.error("[vote] error:", e);
    return res.status(500).json({ ok: false, error: "Server error", detail: e?.message || String(e) });
  }
});

module.exports = router;
