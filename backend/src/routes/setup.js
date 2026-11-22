const crypto = require("node:crypto");
const express = require("express");
const argon2 = require("argon2");
const { rateLimit } = require("express-rate-limit");
const { getPool } = require("../database");
const { requireCsrf } = require("../middleware/csrf");

const router = express.Router();
const pool = getPool();
const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de configuração. Aguarde e tente novamente." }
});

function secretMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post("/first-admin", setupLimiter, requireCsrf, async (req, res, next) => {
  const setupSecret = process.env.ADMIN_SETUP_SECRET;
  if (!setupSecret || setupSecret.length < 32) {
    return res.status(404).json({ error: "Configuração inicial indisponível." });
  }

  const providedSecret = String(req.body.setupSecret || "");
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!secretMatches(providedSecret, setupSecret)) {
    return res.status(403).json({ error: "Código de configuração inválido." });
  }
  if (fullName.length < 3 || fullName.length > 140) {
    return res.status(400).json({ error: "Informe o nome completo." });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Informe um e-mail válido." });
  }
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: "A senha deve ter entre 12 e 128 caracteres." });
  }

  let client;
  try {
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [74192831]);

    const setting = await client.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'initial_admin_created' FOR UPDATE"
    );
    const admins = await client.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
    if (setting.rowCount > 0 || admins.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "A configuração do primeiro administrador já foi concluída." });
    }

    const inserted = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, account_status)
       VALUES ($1, $2, $3, 'admin', 'active')
       RETURNING id, full_name, email`,
      [fullName, email, passwordHash]
    );

    await client.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('initial_admin_created', jsonb_build_object('createdAt', NOW()))`
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'system.first_admin_created', 'user', $1, '{}'::jsonb)`,
      [inserted.rows[0].id]
    );
    await client.query("COMMIT");

    return res.status(201).json({
      message: "Primeiro administrador criado. Remova ADMIN_SETUP_SECRET das variáveis de ambiente agora.",
      admin: {
        id: inserted.rows[0].id,
        fullName: inserted.rows[0].full_name,
        email: inserted.rows[0].email
      }
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return res.status(409).json({ error: "Este e-mail já está cadastrado." });
    }
    return next(error);
  } finally {
    if (client) client.release();
  }
});

// Recuperação temporária da senha de um administrador.
// Só fica disponível enquanto ADMIN_PASSWORD_RESET_SECRET estiver configurado no servidor.
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de recuperação. Aguarde e tente novamente." }
});

router.post("/reset-admin-password", resetLimiter, requireCsrf, async (req, res, next) => {
  const resetSecret = process.env.ADMIN_PASSWORD_RESET_SECRET;
  if (!resetSecret || resetSecret.length < 32) {
    return res.status(404).json({ error: "Recuperação temporária indisponível." });
  }

  const providedSecret = String(req.body.resetSecret || "");
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!secretMatches(providedSecret, resetSecret)) {
    return res.status(403).json({ error: "Código de recuperação inválido." });
  }
  if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Informe um e-mail válido." });
  }
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: "A nova senha deve ter entre 12 e 128 caracteres." });
  }

  let client;
  try {
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });

    client = await pool.connect();
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE users
       SET password_hash = $1
       WHERE LOWER(email) = $2 AND role = 'admin'
       RETURNING id, email`,
      [passwordHash, email]
    );

    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Não foi encontrada uma conta administrativa com esse e-mail." });
    }

    await client.query("COMMIT");
    return res.status(200).json({
      message: "Senha administrativa redefinida. Remova ADMIN_PASSWORD_RESET_SECRET do Render agora.",
      email: updated.rows[0].email
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    if (client) client.release();
  }
});


module.exports = router;
