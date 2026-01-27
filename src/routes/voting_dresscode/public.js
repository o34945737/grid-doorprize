const express = require("express");
const pool = require("../../db");

const router = express.Router();

/**
 * USER PAGE
 * GET /voting-dresscode/
 */
router.get("/", async (req, res) => {
  try {
    const [maleRows] = await pool.query(
      `SELECT id, photo_name, photo_url, gender
       FROM voting_candidates
       WHERE gender='M'
       ORDER BY id DESC`
    );

    const [femaleRows] = await pool.query(
      `SELECT id, photo_name, photo_url, gender
       FROM voting_candidates
       WHERE gender='F'
       ORDER BY id DESC`
    );

    return res.render("voting_dresscode/index", {
      maleRows: maleRows || [],
      femaleRows: femaleRows || [],
      error: null,
      success: null
    });
  } catch (e) {
    console.error("[voting public /] error:", e);
    return res.render("voting_dresscode/index", {
      maleRows: [],
      femaleRows: [],
      error: "Server error, coba lagi.",
      success: null
    });
  }
});

/**
 * PUBLIC RESULTS (optional)
 * GET /voting-dresscode/results
 */
router.get("/results", async (req, res) => {
  try {
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

    return res.render("voting_dresscode/results", {
      maleRows: maleRows || [],
      femaleRows: femaleRows || []
    });
  } catch (e) {
    console.error("[voting public /results] error:", e);
    return res.render("voting_dresscode/results", { maleRows: [], femaleRows: [] });
  }
});

module.exports = router;
