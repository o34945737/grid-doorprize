// src/routes/voting_dresscode/api.js
const express = require("express");
const pool = require("../../db");
const crypto = require("crypto");

const router = express.Router();

// ===== SSE =====
const clients = new Set();
function sendToAll(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (_) {}
  }
}

// ===== session helpers (cookie-based, no extra package) =====
function parseCookies(cookieHeader) {
  const out = {};
  const s = String(cookieHeader || "");
  s.split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function getOrCreateVotingSessionId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = String(cookies.voting_sid || "").trim();

  // basic validate
  if (!sid || sid.length < 16 || sid.length > 80) {
    sid = crypto.randomBytes(16).toString("hex"); // 32 chars
    // cookie 7 days
    res.setHeader("Set-Cookie", `voting_sid=${encodeURIComponent(sid)}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax`);
  }
  return sid;
}

// ===== results snapshot =====
async function getResults() {
  const [maleRows] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     WHERE c.gender = 'M'
     GROUP BY c.id
     ORDER BY vote_count DESC, c.id ASC`
  );

  const [femaleRows] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     WHERE c.gender = 'F'
     GROUP BY c.id
     ORDER BY vote_count DESC, c.id ASC`
  );

  return { maleRows, femaleRows };
}

/**
 * POST /voting-dresscode/api/vote
 * body: { candidate_id }
 * Rules:
 * - 1 browser session can vote 1x for Male and 1x for Female
 * - gender taken from candidate.gender
 */
router.post("/vote", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const candidate_id = parseInt(req.body?.candidate_id, 10);
    if (!Number.isFinite(candidate_id) || candidate_id < 1) {
      return res.status(400).json({ ok: false, error: "Invalid candidate_id" });
    }

    const session_id = getOrCreateVotingSessionId(req, res);

    await conn.beginTransaction();

    // get candidate + gender
    const [[cand]] = await conn.query(
      `SELECT id, gender FROM voting_candidates WHERE id=? LIMIT 1`,
      [candidate_id]
    );
    if (!cand) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Candidate not found" });
    }

    const gender = cand.gender; // 'M' or 'F'
    if (gender !== "M" && gender !== "F") {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Candidate gender invalid" });
    }

    // check already voted this gender
    const [[exists]] = await conn.query(
      `SELECT id FROM voting_votes WHERE session_id=? AND gender=? LIMIT 1`,
      [session_id, gender]
    );
    if (exists) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: gender === "M" ? "You already voted for Male." : "You already voted for Female."
      });
    }

    // insert vote (includes session_id + gender)
    await conn.query(
      `INSERT INTO voting_votes (session_id, candidate_id, gender) VALUES (?, ?, ?)`,
      [session_id, candidate_id, gender]
    );

    await conn.commit();

    // notify SSE listeners
    sendToAll({ type: "results_updated", at: Date.now() });

    return res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error("[vote] error:", e);
    return res.status(500).json({ ok: false, error: "Server error", detail: e?.message || String(e) });
  } finally {
    conn.release();
  }
});

// snapshot
router.get("/results.json", async (req, res) => {
  try {
    const data = await getResults();
    return res.json({ ok: true, ...data });
  } catch (e) {
    console.error("[results.json] error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// SSE stream
router.get("/results/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  clients.add(res);

  res.write(`data: ${JSON.stringify({ type: "connected", at: Date.now() })}\n\n`);

  const t = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: "ping", at: Date.now() })}\n\n`);
    } catch (_) {}
  }, 25000);

  req.on("close", () => {
    clearInterval(t);
    clients.delete(res);
  });
});

module.exports = router;
