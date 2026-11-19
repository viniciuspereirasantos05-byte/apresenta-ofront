const { getPool } = require("../database");

function requireAuthenticated(req, res, next) {
  if (!req.session.user?.id) {
    return res.status(401).json({ error: "Faça login para continuar." });
  }
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const result = await getPool().query(
      `SELECT role, account_status
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.session.user.id]
    );
    const user = result.rows[0];
    if (!user || user.account_status !== "active") {
      return res.status(401).json({ error: "Sua sessão não está mais autorizada. Entre novamente." });
    }
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Acesso restrito à administração." });
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuthenticated, requireAdmin };
