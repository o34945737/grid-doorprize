const express = require("express");
const pool = require("../../db");
const QRCode = require("qrcode");

const router = express.Router();

router.get("/", (req, res) => res.redirect("/doorprize/register"));

router.get("/register", (req, res) => {
  res.render("doorprize/register", {
    error: null,
    success: null
  });
});

router.post("/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const department = String(req.body.department || "").trim();

  if (!name || !department) {
    return res.render("doorprize/register", {
      error: "Nama dan department wajib diisi.",
      success: null
    });
  }

  try {
    await pool.query(
      `INSERT INTO participants (name, department) VALUES (?, ?)`,
      [name, department]
    );

    return res.render("doorprize/register", {
      error: null,
      success: "Pendaftaran berhasil! Terima kasih 🙌"
    });
  } catch (e) {
    console.error(e);
    return res.render("doorprize/register", {
      error: "Terjadi kesalahan server.",
      success: null
    });
  }
});

// QR untuk link form registrasi
router.get("/qr/register", async (req, res) => {
  const url = `${req.protocol}://${req.get("host")}/doorprize/register`;
  const dataUrl = await QRCode.toDataURL(url);
  res.type("html").send(`<img src="${dataUrl}" alt="QR Register"/><p>${url}</p>`);
});

module.exports = router;
