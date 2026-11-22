require("dotenv").config();

const app = require("./app");
const { getPool, closePool } = require("./database");

const port = Number(process.env.PORT) || 3000;
let server;

async function start() {
  // Ensure the PostgreSQL session table exists before accepting requests.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `);
  await getPool().query(
    "CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire)"
  );

  server = app.listen(port, "0.0.0.0", () => {
    console.log(`Kennedy Labs API disponível na porta ${port}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando a API...`);
  if (!server) {
    await closePool();
    process.exit(0);
    return;
  }
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch(async (error) => {
  console.error("Falha ao preparar o banco de dados:", error.message);
  await closePool().catch(() => {});
  process.exit(1);
});
