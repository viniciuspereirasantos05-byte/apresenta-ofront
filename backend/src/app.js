const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { getPool } = require("./database");
const authRouter = require("./routes/auth");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProduction) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origem não permitida pelo CORS."));
  },
  credentials: true
}));
app.use(express.json({ limit: "20kb" }));

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
}

const sessionMaxAgeHours = Math.min(
  Math.max(Number(process.env.SESSION_MAX_AGE_HOURS) || 8, 1),
  24
);

app.use(session({
  name: "kennedy.sid",
  store: new PgSession({
    pool: getPool(),
    tableName: "user_sessions",
    createTableIfMissing: false
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: sessionMaxAgeHours * 60 * 60 * 1000
  }
}));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "kennedy-labs-api"
  });
});

app.get("/api/health/database", async (_req, res, next) => {
  try {
    const result = await getPool().query("SELECT NOW() AS database_time");
    res.status(200).json({
      status: "ok",
      database: "connected",
      checkedAt: result.rows[0].database_time
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.use((err, _req, res, _next) => {
  console.error("Erro na API:", err.message);
  if (err.message === "Origem não permitida pelo CORS.") {
    return res.status(403).json({ error: "Origem não permitida." });
  }
  res.status(500).json({ error: "Ocorreu um erro interno." });
});

module.exports = app;
