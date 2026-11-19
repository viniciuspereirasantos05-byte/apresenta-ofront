const crypto = require("node:crypto");
const express = require("express");
const argon2 = require("argon2");
const { rateLimit } = require("express-rate-limit");
const { getPool } = require("../database");
const { requireCsrf } = require("../middleware/csrf");

const router = express.Router();
const pool = getPool();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }
});

function createCsrfToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function emailDomainAllowed(email) {
  const configured = (process.env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

  if (configured.length === 0) return true;
  const domain = email.split("@")[1];
  return configured.includes(domain);
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    accountStatus: user.account_status
  };
}

router.get("/csrf", (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = createCsrfToken();
  res.set("Cache-Control", "no-store");
  res.status(200).json({ csrfToken: req.session.csrfToken });
});

router.post("/register", authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const email = normalizeEmail(req.body.email);
    const recoveryEmail = normalizeEmail(req.body.recoveryEmail);
    const password = String(req.body.password || "");

    if (fullName.length < 3 || fullName.length > 140) {
      return res.status(400).json({ error: "Informe seu nome completo (de 3 a 140 caracteres)." });
    }
    if (!isValidEmail(email) || !emailDomainAllowed(email)) {
      return res.status(400).json({ error: "Informe um e-mail institucional válido." });
    }
    if (recoveryEmail && !isValidEmail(recoveryEmail)) {
      return res.status(400).json({ error: "O e-mail de recuperação não é válido." });
    }
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: "A senha deve ter entre 12 e 128 caracteres." });
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });

    const result = await pool.query(
      `INSERT INTO users (full_name, email, recovery_email, password_hash, role, account_status)
       VALUES ($1, $2, $3, $4, 'teacher', 'pending')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [fullName, email, recoveryEmail || null, passwordHash]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: "Não foi possível concluir o cadastro. Confira se o e-mail já está cadastrado." });
    }

    return res.status(201).json({
      message: "Cadastro recebido. Sua conta ficará aguardando a aprovação da secretaria.",
      accountStatus: "pending"
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!isValidEmail(email) || password.length === 0 || password.length > 128) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }

    const result = await pool.query(
      `SELECT id, full_name, email, password_hash, role, account_status
       FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }

    const passwordMatches = await argon2.verify(user.password_hash, password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }

    if (user.account_status !== "active") {
      return res.status(403).json({
        error: user.account_status === "pending"
          ? "Seu cadastro ainda está aguardando aprovação da secretaria."
          : "Esta conta não está liberada para acesso."
      });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });

    req.session.user = {
      id: user.id,
      role: user.role
    };
    req.session.csrfToken = createCsrfToken();

    await new Promise((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      message: "Login realizado.",
      user: publicUser(user),
      csrfToken: req.session.csrfToken
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", async (req, res, next) => {
  try {
    if (!req.session.user?.id) {
      return res.status(200).json({ authenticated: false });
    }

    const result = await pool.query(
      `SELECT id, full_name, email, role, account_status
       FROM users WHERE id = $1 LIMIT 1`,
      [req.session.user.id]
    );
    const user = result.rows[0];

    if (!user || user.account_status !== "active") {
      req.session.destroy(() => {});
      return res.status(200).json({ authenticated: false });
    }

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      authenticated: true,
      user: publicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("kennedy.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    });
    return res.status(200).json({ message: "Sessão encerrada." });
  });
});

module.exports = router;
