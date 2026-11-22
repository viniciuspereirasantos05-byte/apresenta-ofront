const express = require("express");
const { getPool } = require("../database");
const { requireAuthenticated, requireAdmin } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");

const router = express.Router();
const pool = getPool();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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


router.get("/class-groups", async (_req, res, next) => {
  try { const r = await pool.query("SELECT id,name,shift FROM class_groups WHERE active=TRUE ORDER BY shift,name"); return res.json({classGroups:r.rows}); }
  catch(e){next(e);}
});
router.get("/subjects", async (_req, res, next) => {
  try { const r = await pool.query("SELECT id,name FROM subjects WHERE active=TRUE ORDER BY name"); return res.json({subjects:r.rows}); }
  catch(e){next(e);}
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

async function insertTimetableEntry(client, teacherId, entry) {
 const {classGroupId,subjectId,lessonPeriodId,weekday}=entry||{};
 if(!UUID.test(String(classGroupId||""))||!UUID.test(String(subjectId||""))||!UUID.test(String(lessonPeriodId||""))||!Number.isInteger(weekday)||weekday<1||weekday>5)
  throw Object.assign(new Error("Confira turma, matéria, período e dia da semana."),{status:400});
 const teacher=await client.query("SELECT id FROM users WHERE id=$1 AND role='teacher' AND account_status='active' FOR SHARE",[teacherId]);
 if(!teacher.rowCount) throw Object.assign(new Error("Professor não encontrado ou inativo."),{status:404});
 const [group,period,subject]=await Promise.all([
  client.query("SELECT id,shift FROM class_groups WHERE id=$1 AND active=TRUE",[classGroupId]),
  client.query("SELECT id,shift FROM lesson_periods WHERE id=$1 AND active=TRUE",[lessonPeriodId]),
  client.query("SELECT id FROM subjects WHERE id=$1 AND active=TRUE",[subjectId])
 ]);
 if(!group.rowCount||!period.rowCount||!subject.rowCount) throw Object.assign(new Error("Turma, matéria ou horário não encontrado/ativo."),{status:400});
 if(group.rows[0].shift!==period.rows[0].shift) throw Object.assign(new Error("O horário precisa pertencer ao mesmo turno da turma."),{status:400});
 await client.query("INSERT INTO teacher_assignments(teacher_id,subject_id,class_group_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[teacherId,subjectId,classGroupId]);
 const inserted=await client.query("INSERT INTO teacher_timetable_entries(teacher_id,class_group_id,subject_id,lesson_period_id,weekday) VALUES($1,$2,$3,$4,$5) RETURNING id",[teacherId,classGroupId,subjectId,lessonPeriodId,weekday]);
 return inserted.rows[0];
}
router.get("/teachers/active",async(_req,res,next)=>{try{
 const r=await pool.query("SELECT id,full_name,email FROM users WHERE role='teacher' AND account_status='active' ORDER BY full_name");
 return res.json({teachers:r.rows});
}catch(e){next(e);}});
router.get("/teachers/:teacherId/timetable",async(req,res,next)=>{try{
 const r=await pool.query("SELECT t.id,t.weekday,t.class_group_id,cg.name AS class_group_name,t.subject_id,s.name AS subject_name,t.lesson_period_id,p.shift,p.period_number,p.starts_at,p.ends_at FROM teacher_timetable_entries t JOIN class_groups cg ON cg.id=t.class_group_id JOIN subjects s ON s.id=t.subject_id JOIN lesson_periods p ON p.id=t.lesson_period_id WHERE t.teacher_id=$1 AND t.active=TRUE ORDER BY t.weekday,p.starts_at",[req.params.teacherId]);
 return res.json({entries:r.rows});
}catch(e){next(e);}});
router.post("/teachers/:teacherId/timetable",requireCsrf,async(req,res,next)=>{
 const teacherId=String(req.params.teacherId||""); if(!UUID.test(teacherId)) return res.status(400).json({error:"Professor inválido."});
 let client; try{client=await pool.connect();await client.query("BEGIN");
 const entry=await insertTimetableEntry(client,teacherId,req.body||{});
 await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'timetable.entry_created','user',$2,$3::jsonb)",[req.session.user.id,teacherId,JSON.stringify(req.body)]);
 await client.query("COMMIT");return res.status(201).json({message:"Aula adicionada à grade semanal.",entry});
 }catch(e){if(client)await client.query("ROLLBACK").catch(()=>{});if(e.code==="23505")return res.status(409).json({error:"Já existe uma aula nesse horário para esse professor ou turma."});if(e.status)return res.status(e.status).json({error:e.message});return next(e);}
 finally{if(client)client.release();}
});
router.delete("/teachers/:teacherId/timetable/:entryId",requireCsrf,async(req,res,next)=>{
 if(!UUID.test(String(req.params.teacherId||""))||!UUID.test(String(req.params.entryId||"")))return res.status(400).json({error:"Identificador inválido."});
 try{const r=await pool.query("DELETE FROM teacher_timetable_entries WHERE id=$1 AND teacher_id=$2 RETURNING id",[req.params.entryId,req.params.teacherId]);if(!r.rowCount)return res.status(404).json({error:"Aula não encontrada na grade."});
 await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'timetable.entry_deleted','user',$2)",[req.session.user.id,req.params.teacherId]);return res.json({message:"Aula removida da grade."});
 }catch(e){next(e);}
});
router.get("/timetable/change-requests",async(_req,res,next)=>{try{
 const r=await pool.query("SELECT q.id,q.teacher_id,u.full_name,q.proposed_entries,q.message,q.created_at FROM timetable_change_requests q JOIN users u ON u.id=q.teacher_id WHERE q.status='pending' ORDER BY q.created_at");
 return res.json({requests:r.rows});
}catch(e){next(e);}});
router.post("/timetable/change-requests/:requestId/:decision",requireCsrf,async(req,res,next)=>{
 const {requestId,decision}=req.params;if(!UUID.test(String(requestId))||!["approve","reject"].includes(decision))return res.status(400).json({error:"Solicitação ou decisão inválida."});
 let client;try{client=await pool.connect();await client.query("BEGIN");
 const found=await client.query("SELECT * FROM timetable_change_requests WHERE id=$1 AND status='pending' FOR UPDATE",[requestId]);
 if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Solicitação pendente não encontrada."});}
 const item=found.rows[0];
 if(decision==="approve"){
  if(!Array.isArray(item.proposed_entries)||item.proposed_entries.length>60)throw Object.assign(new Error("A grade enviada não é válida."),{status:400});
  await client.query("DELETE FROM teacher_timetable_entries WHERE teacher_id=$1",[item.teacher_id]);
  for(const entry of item.proposed_entries)await insertTimetableEntry(client,item.teacher_id,entry);
 }
 const status=decision==="approve"?"approved":"rejected";
 await client.query("UPDATE timetable_change_requests SET status=$1,reviewed_by=$2,reviewed_at=NOW(),review_message=$3 WHERE id=$4",[status,req.session.user.id,String(req.body?.message||"").trim().slice(0,500)||null,requestId]);
 await client.query("INSERT INTO notifications(user_id,title,message) VALUES($1,$2,$3)",[item.teacher_id,decision==="approve"?"Grade atualizada":"Alteração de grade não aprovada",decision==="approve"?"A secretaria aprovou sua solicitação e atualizou sua grade semanal.":"A secretaria não aprovou sua solicitação de alteração da grade. Consulte a secretaria para mais informações."]);
 await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,'timetable_change_request',$3,$4::jsonb)",[req.session.user.id,"timetable.request_"+status,requestId,JSON.stringify({teacherId:item.teacher_id})]);
 await client.query("COMMIT");return res.json({message:decision==="approve"?"Alteração aprovada e grade atualizada.":"Solicitação rejeitada."});
 }catch(e){if(client)await client.query("ROLLBACK").catch(()=>{});if(e.code==="23505")return res.status(409).json({error:"A grade entra em conflito com outra aula do professor ou da turma. A grade anterior foi mantida."});if(e.status)return res.status(e.status).json({error:e.message});return next(e);}
 finally{if(client)client.release();}
});
