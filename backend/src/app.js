const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

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

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Ocorreu um erro interno." });
});

module.exports = app;
