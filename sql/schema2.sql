CREATE DATABASE IF NOT EXISTS doorprize_db;
USE doorprize_db;

CREATE TABLE voting_candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  photo_name VARCHAR(150) NOT NULL,
  photo_url VARCHAR(255) NOT NULL,
  gender ENUM('M','F') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE voting_votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(128) NOT NULL,
  candidate_id INT NOT NULL,
  gender ENUM('M','F') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_session_gender (session_id, gender),
  CONSTRAINT fk_vote_candidate FOREIGN KEY (candidate_id)
    REFERENCES voting_candidates(id) ON DELETE CASCADE
);

