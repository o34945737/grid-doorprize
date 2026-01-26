const express = require("express");
const pool = require("../../db");

const router = express.Router();

router.get("/", async (req, res) => {
  // list candidates + vote_count
  const [rows] = await pool.query(
    `SELECT c.id, c.photo_name, c.photo_url, c.created_at,
            COUNT(v.id) AS vote_count
     FROM voting_candidates c
     LEFT JOIN voting_votes v ON v.candidate_id = c.id
     GROUP BY c.id
     ORDER BY c.id DESC`
  );

  res.render("voting_dresscode/index", {
    rows
  });
});

module.exports = router;
