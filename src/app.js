const express = require("express");
const session = require("express-session");
require("dotenv").config();

const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");
const apiRoutes = require("./routes/api");

const app = express();
app.set("view engine", "ejs");
app.set("views", __dirname + "/views");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(__dirname + "/public"));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

app.use("/", publicRoutes);
app.use("/admin", adminRoutes);
app.use("/api", apiRoutes);

// biar kalau error tidak blank
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).send(`<pre>${err.stack || err}</pre>`);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port", process.env.PORT || 3000);
});
