function requireDoorprizeAdmin(req, res, next) {
  if (req.session?.doorprizeAdmin) return next();
  return res.redirect("/doorprize/admin/login");
}

function requireDoorprizeAdminApi(req, res, next) {
  if (req.session?.doorprizeAdmin) return next();
  return res.status(401).json({ error: "Unauthorized (doorprize admin)" });
}

function requireVotingAdmin(req, res, next) {
  if (req.session?.votingAdmin) return next();
  return res.redirect("/voting-dresscode/admin/login");
}

function requireVotingAdminApi(req, res, next) {
  if (req.session?.votingAdmin) return next();
  return res.status(401).json({ error: "Unauthorized (voting admin)" });
}

module.exports = {
  requireDoorprizeAdmin,
  requireDoorprizeAdminApi,
  requireVotingAdmin,
  requireVotingAdminApi
};
