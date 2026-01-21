const express = require("express");
const pool = require("../db");
const QRCode = require("qrcode");

const router = express.Router();

router.get("/", (req, res) => res.redirect("/register"));

router.get("/register", async (req, res) => {
  res.render("register", { error: null });
});

router.post("/register", async (req, res) => {
  const { name, department } = req.body;

  if (!name || name.trim().length < 2) {
    return res.render("register", { error: "Nama wajib diisi (min 2 karakter)." });
  }

  try {
    await pool.query(
      "INSERT INTO participants (name, department) VALUES (?, ?, ?)",
      [name.trim(), department?.trim() || null]
    );
    res.render("thanks");
  } catch (e) {
    console.error(e);
    res.render("register", { error: "Terjadi error. Coba lagi." });
  }
});

// QR untuk link form registrasi
router.get("/qr/register", async (req, res) => {
  const url = `${req.protocol}://${req.get("host")}/register`;
  const dataUrl = await QRCode.toDataURL(url);
  res.type("html").send(`<img src="${dataUrl}" alt="QR Register"/><p>${url}</p>`);
});

module.exports = router;
