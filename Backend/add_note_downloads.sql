CREATE TABLE IF NOT EXISTS note_downloads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  note_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_note_downloads_note_id (note_id)
);
