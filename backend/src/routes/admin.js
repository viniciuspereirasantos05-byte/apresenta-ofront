const express = require("express");
const { getPool } = require("../database");
const { requireAuthenticated, requireAdmin } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");

const router = express.Router();
const pool = getPool();

router.use(requireAuthenticated, requireAdmin);

router.get("/teachers/pending", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, recovery_email, created_at
       FROM users
       WHERE role = 'teacher' AND account_status = 'pending'
       ORDER BY created_at ASC`
    );
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ teachers: result.rows });
  } catch (error) {
    next(error);
  }
});

async function updateTeacherStatus(req, res, next, nextStatus) {
  const teacherId = String(req.params.teacherId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teacherId)) {
    return res.status(400).json({ error: "Identificador de professor inválido." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE users
       SET account_status = $1, updated_at = NOW()
       WHERE id = $2 AND role = 'teacher' AND account_status = 'pending'
       RETURNING id, full_name, email`,
      [nextStatus, teacherId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cadastro pendente não encontrado." });
    }

    const teacher = result.rows[0];
    await client.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [
        teacher.id,
        nextStatus === "active" ? "Cadastro aprovado" : "Cadastro não aprovado",
        nextStatus === "active"
          ? "Seu cadastro foi aprovado. Você já pode entrar no Kennedy Labs."
          : "Seu cadastro não foi aprovado. Procure a secretaria para mais informações."
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user', $3, $4::jsonb)`,
      [
        req.session.user.id,
        nextStatus === "active" ? "teacher.approved" : "teacher.rejected",
        teacher.id,
        JSON.stringify({ accountStatus: nextStatus })
      ]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      message: nextStatus === "active" ? "Professor aprovado." : "Cadastro rejeitado.",
      teacher: { id: teacher.id, fullName: teacher.full_name, email: teacher.email, accountStatus: nextStatus }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

router.post("/teachers/:teacherId/approve", requireCsrf, (req, res, next) =>
  updateTeacherStatus(req, res, next, "active")
);

router.post("/teachers/:teacherId/reject", requireCsrf, (req, res, next) =>
  updateTeacherStatus(req, res, next, "rejected")
);

module.exports = router;
