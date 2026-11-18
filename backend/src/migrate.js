require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { getPool, closePool } = require("./database");

const migrationsDirectory = path.resolve(__dirname, "../../database/migrations");
const migrationLockId = 714202611;

async function runMigrations() {
  const pool = getPool();
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs.readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const appliedResult = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`Já aplicada: ${filename}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDirectory, filename), "utf8");
      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`Migração aplicada: ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migração ${filename}: ${error.message}`);
      }
    }

    console.log("Migrações concluídas.");
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]).catch(() => {});
    }
    client.release();
    await closePool();
  }
}

runMigrations().catch(async (error) => {
  console.error(error.message);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
