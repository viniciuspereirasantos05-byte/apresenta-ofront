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

function todayInSchoolTimezone() {
  const timeZone = process.env.SCHOOL_TIME_ZONE || "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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


router.get("/subjects", async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, name FROM subjects WHERE active = TRUE ORDER BY name");
    res.set("Cache-Control", "no-store");
    return res.json({ subjects: result.rows });
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
  const { date, spaceId, classGroupId } = req.query;
  if (!validDate(date) || !UUID_PATTERN.test(String(spaceId || "")) || !UUID_PATTERN.test(String(classGroupId || ""))) {
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
      "AND (cb.lesson_period_id IS NULL OR cb.lesson_period_id = p.id)) AS blocked, " +
      "EXISTS (SELECT 1 FROM teacher_timetable_entries tt WHERE tt.teacher_id = $3 AND tt.class_group_id = $4 " +
      "AND tt.lesson_period_id = p.id AND tt.weekday = EXTRACT(ISODOW FROM $2::date)::int AND tt.active = TRUE) AS teacher_eligible " +
      "FROM lesson_periods p WHERE p.active = TRUE " +
      "ORDER BY CASE p.shift WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END, p.period_number",
      [spaceId, date, req.session.user.id, classGroupId]
    );
    res.set("Cache-Control", "no-store");
    return res.json({
      date, spaceId,
      periods: result.rows.map((period) => ({ ...period, available: !period.reserved && !period.blocked && period.teacher_eligible }))
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

router.get("/notifications", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, title, message, read_at, created_at FROM notifications " +
      "WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30",
      [req.session.user.id]
    );
    res.set("Cache-Control", "no-store");
    return res.json({ notifications: result.rows });
  } catch (error) { next(error); }
});

router.post("/notifications/:notificationId/read", requireCsrf, async (req, res, next) => {
  const notificationId = String(req.params.notificationId || "");
  if (!UUID_PATTERN.test(notificationId)) {
    return res.status(400).json({ error: "Identificador de notificação inválido." });
  }
  try {
    const result = await pool.query(
      "UPDATE notifications SET read_at = COALESCE(read_at, NOW()) " +
      "WHERE id = $1 AND user_id = $2 RETURNING id, read_at",
      [notificationId, req.session.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Notificação não encontrada." });
    return res.json({ notification: result.rows[0] });
  } catch (error) { next(error); }
});


router.get("/timetable",async(req,res,next)=>{try{
 const r=await pool.query("SELECT t.id,t.weekday,cg.name AS class_group_name,s.name AS subject_name,p.period_number,p.shift,p.starts_at,p.ends_at FROM teacher_timetable_entries t JOIN class_groups cg ON cg.id=t.class_group_id JOIN subjects s ON s.id=t.subject_id JOIN lesson_periods p ON p.id=t.lesson_period_id WHERE t.teacher_id=$1 AND t.active=TRUE ORDER BY t.weekday,p.starts_at",[req.session.user.id]);
 return res.json({entries:r.rows});
}catch(e){next(e);}});
router.post("/timetable/change-requests",requireCsrf,async(req,res,next)=>{
 const entries=req.body?.entries,message=String(req.body?.message||"").trim();
 if(!Array.isArray(entries)||entries.length<1||entries.length>60||entries.some(x=>!x||typeof x!=="object"||!Number.isInteger(x.weekday)||x.weekday<1||x.weekday>5||!UUID_PATTERN.test(String(x.classGroupId||""))||!UUID_PATTERN.test(String(x.subjectId||""))||!UUID_PATTERN.test(String(x.lessonPeriodId||""))))return res.status(400).json({error:"Envie uma grade válida, com no máximo 60 aulas de segunda a sexta."});
 try{
  const pending=await pool.query("SELECT id FROM timetable_change_requests WHERE teacher_id=$1 AND status='pending' LIMIT 1",[req.session.user.id]);
  if(pending.rowCount)return res.status(409).json({error:"Você já possui uma solicitação aguardando análise da secretaria."});
  const r=await pool.query("INSERT INTO timetable_change_requests(teacher_id,proposed_entries,message) VALUES($1,$2::jsonb,$3) RETURNING id,created_at",[req.session.user.id,JSON.stringify(entries),message.slice(0,500)||null]);
  await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'timetable.change_requested','timetable_change_request',$2)",[req.session.user.id,r.rows[0].id]);
  return res.status(201).json({message:"Solicitação enviada à secretaria para aprovação.",request:r.rows[0]});
 }catch(e){if(e.code==="23505")return res.status(409).json({error:"Você já possui uma solicitação de alteração aguardando análise."});next(e);}
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

  const today = todayInSchoolTimezone();
  if (date < today) return res.status(400).json({ error: "Não é possível reservar uma data que já passou." });

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    // Serializa reservas e bloqueios da mesma data para evitar corrida entre as duas operações.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [date]);

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

    const timetable = await client.query(
      "SELECT COUNT(DISTINCT lesson_period_id)::int AS matched FROM teacher_timetable_entries " +
      "WHERE teacher_id = $1 AND class_group_id = $2 AND weekday = EXTRACT(ISODOW FROM $3::date)::int " +
      "AND lesson_period_id = ANY($4::uuid[]) AND active = TRUE",
      [req.session.user.id, classGroupId, date, periodIds]
    );
    if (timetable.rows[0].matched !== periodIds.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Sua grade oficial não confirma aula com essa turma em todos os períodos selecionados. Confira sua grade ou fale com a secretaria." });
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
