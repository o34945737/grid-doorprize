CREATE DATABASE IF NOT EXISTS doorprize_db;
USE doorprize_db;

CREATE TABLE IF NOT EXISTS voting_candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  photo_name VARCHAR(150) NOT NULL,
  photo_url VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voting_votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  stars INT NOT NULL,
  voter_ip VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_voting_votes_candidate
    FOREIGN KEY (candidate_id) REFERENCES voting_candidates(id)
    ON DELETE CASCADE
);

-- OPTIONAL: kalau mau batasi 1 IP hanya boleh vote 1x per kandidat:
-- ALTER TABLE voting_votes ADD UNIQUE KEY uq_vote_once (candidate_id, voter_ip);

