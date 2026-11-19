function requireAuthenticated(req, res, next) {
  if (!req.session.user?.id) {
    return res.status(401).json({ error: "Faça login para continuar." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.user?.role !== "admin") {
    return res.status(403).json({ error: "Acesso restrito à administração." });
  }
  next();
}

module.exports = { requireAuthenticated, requireAdmin };
