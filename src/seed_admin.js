const bcrypt = require("bcrypt");
const pool = require("./db");

(async () => {
  const username = process.argv[2] || "admin";
  const password = process.argv[3] || "admin123";

  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    "INSERT INTO admins (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)",
    [username, hash]
  );

  console.log("Admin ready:", { username, password });
  process.exit(0);
})();
