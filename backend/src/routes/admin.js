const express = require("express");
const { getPool } = require("../database");
const { requireAuthenticated, requireAdmin } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");

const router = express.Router();
const pool = getPool();

router.use(requireAuthenticated, requireAdmin);


router.get("/spaces", async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, name FROM spaces WHERE active = TRUE ORDER BY name");
    return res.json({ spaces: result.rows });
  } catch (error) { next(error); }
});

router.get("/periods", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, shift, period_number FROM lesson_periods WHERE active = TRUE " +
      "ORDER BY CASE shift WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END, period_number"
    );
    return res.json({ periods: result.rows });
  } catch (error) { next(error); }
});

router.get("/teachers/pending", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, created_at
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

  let client;
  try {
    client = await pool.connect();
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
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    if (client) client.release();
  }
}

router.post("/teachers/:teacherId/approve", requireCsrf, (req, res, next) =>
  updateTeacherStatus(req, res, next, "active")
);

router.post("/teachers/:teacherId/reject", requireCsrf, (req, res, next) =>
  updateTeacherStatus(req, res, next, "rejected")
);


router.get("/calendar-blocks", async (req, res, next) => {
  const from = req.query.from;
  const to = req.query.to;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !datePattern.test(String(from))) || (to && !datePattern.test(String(to)))) {
    return res.status(400).json({ error: "Informe um intervalo de datas válido." });
  }
  try {
    const result = await pool.query(
      "SELECT cb.id, cb.block_date, cb.space_id, s.name AS space_name, " +
      "cb.lesson_period_id, p.period_number, p.shift, cb.reason, cb.created_at " +
      "FROM calendar_blocks cb LEFT JOIN spaces s ON s.id = cb.space_id " +
      "LEFT JOIN lesson_periods p ON p.id = cb.lesson_period_id " +
      "WHERE ($1::date IS NULL OR cb.block_date >= $1::date) " +
      "AND ($2::date IS NULL OR cb.block_date <= $2::date) " +
      "ORDER BY cb.block_date, s.name NULLS FIRST, p.period_number NULLS FIRST",
      [from || null, to || null]
    );
    res.set("Cache-Control", "no-store");
    return res.json({ blocks: result.rows });
  } catch (error) { next(error); }
});

router.post("/calendar-blocks", requireCsrf, async (req, res, next) => {
  const date = String(req.body.date || "");
  const spaceId = req.body.spaceId || null;
  const periodId = req.body.periodId || null;
  const reason = String(req.body.reason || "").trim();
  const confirmExistingReservations = req.body.confirmExistingReservations === true;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!datePattern.test(date) ||
      (spaceId !== null && !uuidPattern.test(String(spaceId))) ||
      (periodId !== null && !uuidPattern.test(String(periodId))) ||
      reason.length < 3 || reason.length > 240) {
    return res.status(400).json({ error: "Confira a data, o espaço, o período e o motivo do bloqueio." });
  }
  const parsed = new Date(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ error: "A data informada não existe." });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    // Usa o mesmo bloqueio consultivo da criação de reservas para a data.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [date]);
    if (spaceId) {
      const space = await client.query("SELECT id FROM spaces WHERE id = $1 FOR SHARE", [spaceId]);
      if (!space.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Espaço não encontrado." });
      }
    }
    if (periodId) {
      const period = await client.query("SELECT id FROM lesson_periods WHERE id = $1 FOR SHARE", [periodId]);
      if (!period.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Período não encontrado." });
      }
    }
    const affected = await client.query(
      "SELECT DISTINCT r.teacher_id FROM reservation_slots rs " +
      "JOIN reservations r ON r.id = rs.reservation_id " +
      "WHERE rs.reservation_date = $1 AND rs.is_active = TRUE AND r.status = 'confirmed' " +
      "AND ($2::uuid IS NULL OR rs.space_id = $2) " +
      "AND ($3::uuid IS NULL OR rs.lesson_period_id = $3)",
      [date, spaceId, periodId]
    );
    if (affected.rowCount > 0 && !confirmExistingReservations) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Este bloqueio afeta reservas já confirmadas.",
        warning: true,
        affectedTeachers: affected.rowCount,
        message: "Confirme novamente para criar o bloqueio e avisar os professores afetados."
      });
    }

    const inserted = await client.query(
      "INSERT INTO calendar_blocks (created_by, space_id, block_date, lesson_period_id, reason) " +
      "VALUES ($1, $2, $3, $4, $5) RETURNING id, block_date, space_id, lesson_period_id, reason",
      [req.session.user.id, spaceId, date, periodId, reason]
    );
    for (const affectedTeacher of affected.rows) {
      await client.query(
        "INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)",
        [affectedTeacher.teacher_id, "Reserva afetada por bloqueio", 
          "A secretaria criou um bloqueio que pode afetar uma de suas reservas em " + date + ". Entre em contato com a secretaria para combinar os próximos passos."]
      );
    }
    await client.query(
      "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) " +
      "VALUES ($1, 'calendar_block.created', 'calendar_block', $2, $3::jsonb)",
      [req.session.user.id, inserted.rows[0].id, JSON.stringify({ date, spaceId, periodId, reason, affectedTeachers: affected.rowCount })]
    );
    await client.query("COMMIT");
    return res.status(201).json({ message: affected.rowCount > 0 ? "Bloqueio criado. Os professores afetados receberam um aviso interno." : "Bloqueio criado.", block: inserted.rows[0], affectedTeachers: affected.rowCount });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { if (client) client.release(); }
});

router.delete("/calendar-blocks/:blockId", requireCsrf, async (req, res, next) => {
  const blockId = String(req.params.blockId || "");
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(blockId)) return res.status(400).json({ error: "Identificador de bloqueio inválido." });
  try {
    const result = await pool.query(
      "DELETE FROM calendar_blocks WHERE id = $1 RETURNING id, block_date",
      [blockId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Bloqueio não encontrado." });
    await pool.query(
      "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) " +
      "VALUES ($1, 'calendar_block.deleted', 'calendar_block', $2, $3::jsonb)",
      [req.session.user.id, blockId, JSON.stringify({ date: result.rows[0].block_date })]
    );
    return res.json({ message: "Bloqueio removido." });
  } catch (error) { next(error); }
});

module.exports = router;
