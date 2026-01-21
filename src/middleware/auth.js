function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin/login");
  next();
}

function requireAdminApi(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ error: "Unauthorized" });
  next();
}

module.exports = { requireAdmin, requireAdminApi };
