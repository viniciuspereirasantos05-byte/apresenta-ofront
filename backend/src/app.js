const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { getPool } = require("./database");

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
    : false
}));
app.use(express.json({ limit: "20kb" }));

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

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.use((err, _req, res, _next) => {
  console.error("Erro na API:", err.message);
  res.status(500).json({ error: "Ocorreu um erro interno." });
});

module.exports = app;
