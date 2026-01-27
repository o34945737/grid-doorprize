const express = require("express");
const session = require("express-session");
require("dotenv").config();

const app = express();

// ===== basic config =====
app.set("view engine", "ejs");
app.set("views", __dirname + "/views");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(__dirname + "/public"));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false
  })
);

/**
 * DOORPRIZE
 */
const doorprizeAdminRoutes = require("./routes/doorprize/admin");
const doorprizePublicRoutes = require("./routes/doorprize/public");
const doorprizeApiRoutes = require("./routes/doorprize/api");

app.use("/doorprize/admin", doorprizeAdminRoutes);
app.use("/doorprize", doorprizePublicRoutes);
app.use("/doorprize/api", doorprizeApiRoutes);

/**
 * VOTING DRESSCODE
 */
const votingAdminRoutes = require("./routes/voting_dresscode/admin");
const votingPublicRoutes = require("./routes/voting_dresscode/public");
const votingApiRoutes = require("./routes/voting_dresscode/api");

app.use("/voting-dresscode/admin", votingAdminRoutes);
app.use("/voting-dresscode", votingPublicRoutes);
app.use("/voting-dresscode/api", votingApiRoutes);

// home
app.get("/", (req, res) => {
  res.send(`
    <h3>OK Server Running</h3>
    <ul>
      <li><a href="/doorprize/register">Doorprize Register</a></li>
      <li><a href="/doorprize/admin/">Doorprize Admin</a></li>
      <li><a href="/voting-dresscode/">Voting Dresscode</a></li>
      <li><a href="/voting-dresscode/admin/">Voting Dresscode Admin</a></li>
    </ul>
  `);
});

// error handler
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).send(`<pre>${err.stack || err}</pre>`);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port", process.env.PORT || 3000);
});


module.exports = app; 