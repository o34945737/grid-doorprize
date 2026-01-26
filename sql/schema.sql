CREATE DATABASE IF NOT EXISTS doorprize_db;
USE doorprize_db;

-- Peserta registrasi
CREATE TABLE IF NOT EXISTS participants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  department VARCHAR(150) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
);

-- Admin login
CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL
);

-- Sesi undian grid per hadiah
CREATE TABLE IF NOT EXISTS draws (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prize_name VARCHAR(200) NOT NULL,
  quota INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pemenang per draw
CREATE TABLE IF NOT EXISTS draw_winners (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  draw_id BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_draw_participant (draw_id, participant_id),
  CONSTRAINT fk_dw_draw FOREIGN KEY (draw_id) REFERENCES draws(id) ON DELETE CASCADE,
  CONSTRAINT fk_dw_participant FOREIGN KEY (participant_id) REFERENCES participants(id)
);


