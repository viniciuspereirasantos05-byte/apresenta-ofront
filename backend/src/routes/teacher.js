const express = require("express");
const { getPool } = require("../database");
const { requireAuthenticated } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");

const router = express.Router();
const pool = getPool();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function requireTeacher(req, res, next) {
  try {
    const result = await pool.query(
      "SELECT role, account_status FROM users WHERE id = $1 LIMIT 1",
      [req.session.user.id]
    );
    const user = result.rows[0];
    if (!user || user.account_status !== "active") {
      return res.status(401).json({ error: "Sua sessão não está mais autorizada. Entre novamente." });
    }
    if (user.role !== "teacher") {
      return res.status(403).json({ error: "Esta área é exclusiva para professores." });
    }
    next();
  } catch (error) { next(error); }
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.use(requireAuthenticated, requireTeacher);

router.get("/spaces", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, description FROM spaces WHERE active = TRUE ORDER BY name"
    );
    res.set("Cache-Control", "no-store");
    return res.json({ spaces: result.rows });
  } catch (error) { next(error); }
});

router.get("/class-groups", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, shift, school_year FROM class_groups WHERE active = TRUE ORDER BY shift, name"
    );
    res.set("Cache-Control", "no-store");
    return res.json({ classGroups: result.rows });
  } catch (error) { next(error); }
});

router.get("/periods", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, shift, period_number, starts_at, ends_at FROM lesson_periods WHERE active = TRUE ORDER BY CASE shift WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END, period_number"
    );
    res.set("Cache-Control", "no-store");
    return res.json({ periods: result.rows });
  } catch (error) { next(error); }
});

router.get("/availability", async (req, res, next) => {
  const { date, spaceId } = req.query;
  if (!validDate(date) || !UUID_PATTERN.test(String(spaceId || ""))) {
    return res.status(400).json({ error: "Informe uma data e um espaço válidos." });
  }
  try {
    const space = await pool.query(
      "SELECT id FROM spaces WHERE id = $1 AND active = TRUE",
      [spaceId]
    );
    if (!space.rowCount) return res.status(404).json({ error: "Espaço não encontrado ou inativo." });

    const result = await pool.query(
      "SELECT p.id, p.shift, p.period_number, p.starts_at, p.ends_at, " +
      "EXISTS (SELECT 1 FROM reservation_slots rs JOIN reservations r ON r.id = rs.reservation_id " +
      "WHERE rs.space_id = $1 AND rs.reservation_date = $2 AND rs.lesson_period_id = p.id " +
      "AND rs.is_active = TRUE AND r.status = 'confirmed') AS reserved, " +
      "EXISTS (SELECT 1 FROM calendar_blocks cb WHERE cb.block_date = $2 " +
      "AND (cb.space_id IS NULL OR cb.space_id = $1) " +
      "AND (cb.lesson_period_id IS NULL OR cb.lesson_period_id = p.id)) AS blocked " +
      "FROM lesson_periods p WHERE p.active = TRUE " +
      "ORDER BY CASE p.shift WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END, p.period_number",
      [spaceId, date]
    );
    res.set("Cache-Control", "no-store");
    return res.json({
      date, spaceId,
      periods: result.rows.map((period) => ({ ...period, available: !period.reserved && !period.blocked }))
    });
  } catch (error) { next(error); }
});

router.get("/reservations/mine", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT r.id, r.purpose, r.status, r.created_at, r.cancelled_at, " +
      "cg.name AS class_group_name, s.name AS space_name, rs.reservation_date, " +
      "p.id AS period_id, p.period_number, p.shift, p.starts_at, p.ends_at " +
      "FROM reservations r JOIN class_groups cg ON cg.id = r.class_group_id " +
      "JOIN reservation_slots rs ON rs.reservation_id = r.id " +
      "JOIN spaces s ON s.id = rs.space_id JOIN lesson_periods p ON p.id = rs.lesson_period_id " +
      "WHERE r.teacher_id = $1 ORDER BY rs.reservation_date DESC, p.period_number",
      [req.session.user.id]
    );
    const grouped = new Map();
    for (const row of result.rows) {
      if (!grouped.has(row.id)) grouped.set(row.id, {
        id: row.id, purpose: row.purpose, status: row.status,
        createdAt: row.created_at, cancelledAt: row.cancelled_at,
        classGroup: row.class_group_name, space: row.space_name,
        date: row.reservation_date, periods: []
      });
      grouped.get(row.id).periods.push({
        id: row.period_id, number: row.period_number, shift: row.shift,
        startsAt: row.starts_at, endsAt: row.ends_at
      });
    }
    res.set("Cache-Control", "no-store");
    return res.json({ reservations: [...grouped.values()] });
  } catch (error) { next(error); }
});

router.post("/reservations", requireCsrf, async (req, res, next) => {
  const spaceId = String(req.body.spaceId || "");
  const classGroupId = String(req.body.classGroupId || "");
  const date = req.body.date;
  const purpose = String(req.body.purpose || "").trim();
  const periodIds = req.body.periodIds;

  if (!UUID_PATTERN.test(spaceId) || !UUID_PATTERN.test(classGroupId) ||
      !validDate(date) || !Array.isArray(periodIds) || periodIds.length < 1 ||
      periodIds.length > 10 ||
      periodIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id)) ||
      new Set(periodIds).size !== periodIds.length ||
      purpose.length < 3 || purpose.length > 500) {
    return res.status(400).json({ error: "Confira espaço, turma, data, finalidade e períodos selecionados." });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return res.status(400).json({ error: "Não é possível reservar uma data que já passou." });

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const space = await client.query(
      "SELECT id FROM spaces WHERE id = $1 AND active = TRUE FOR SHARE",
      [spaceId]
    );
    if (!space.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "O espaço selecionado não está disponível para reservas." });
    }

    const classGroup = await client.query(
      "SELECT id, shift FROM class_groups WHERE id = $1 AND active = TRUE FOR SHARE",
      [classGroupId]
    );
    if (!classGroup.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "A turma selecionada não está ativa." });
    }

    const periods = await client.query(
      "SELECT id, shift FROM lesson_periods WHERE id = ANY($1::uuid[]) AND active = TRUE",
      [periodIds]
    );
    if (periods.rowCount !== periodIds.length ||
        periods.rows.some((period) => period.shift !== classGroup.rows[0].shift)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Os períodos precisam estar ativos e pertencer ao turno da turma." });
    }

    const blocks = await client.query(
      "SELECT 1 FROM calendar_blocks WHERE block_date = $1 " +
      "AND (space_id IS NULL OR space_id = $2) " +
      "AND (lesson_period_id IS NULL OR lesson_period_id = ANY($3::uuid[])) LIMIT 1",
      [date, spaceId, periodIds]
    );
    if (blocks.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Um ou mais períodos estão bloqueados pela administração." });
    }

    const reservation = await client.query(
      "INSERT INTO reservations (teacher_id, class_group_id, purpose, status) " +
      "VALUES ($1, $2, $3, 'confirmed') RETURNING id, created_at",
      [req.session.user.id, classGroupId, purpose]
    );

    for (const periodId of periodIds) {
      await client.query(
        "INSERT INTO reservation_slots (reservation_id, space_id, reservation_date, lesson_period_id, is_active) " +
        "VALUES ($1, $2, $3, $4, TRUE)",
        [reservation.rows[0].id, spaceId, date, periodId]
      );
    }

    await client.query(
      "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) " +
      "VALUES ($1, 'reservation.created', 'reservation', $2, $3::jsonb)",
      [req.session.user.id, reservation.rows[0].id, JSON.stringify({ date, spaceId, classGroupId, periodIds })]
    );

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Reserva confirmada.",
      reservation: {
        id: reservation.rows[0].id, date, spaceId, classGroupId,
        periodIds, status: "confirmed", createdAt: reservation.rows[0].created_at
      }
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Pelo menos um dos períodos acabou de ser reservado por outra pessoa. Atualize a disponibilidade e tente novamente."
      });
    }
    return next(error);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
