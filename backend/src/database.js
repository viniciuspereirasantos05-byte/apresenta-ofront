const { Pool } = require("pg");

let pool;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não foi configurada no ambiente.");
  }

  if (!pool) {
    const useSsl = process.env.DB_SSL === "true";
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl
        ? {
            rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
          }
        : undefined,
      max: Number(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });

    pool.on("error", (error) => {
      console.error("Erro inesperado em uma conexão ociosa do PostgreSQL:", error.message);
    });
  }

  return pool;
}

async function closePool() {
  if (pool) {
    const currentPool = pool;
    pool = undefined;
    await currentPool.end();
  }
}

module.exports = { getPool, closePool };
