require("dotenv").config();

const app = require("./app");
const { closePool } = require("./database");

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Kennedy Labs API disponível na porta ${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando a API...`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
