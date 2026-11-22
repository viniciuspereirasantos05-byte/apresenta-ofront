(() => {
  const config = window.KENNEDY_CONFIG || {};
  const $ = (selector) => document.querySelector(selector);
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const list = document.querySelector("#pending-list");
  const notice = document.querySelector("#dashboard-notice");
  const count = document.querySelector("#pending-count");
  let csrfToken = "";

  async function request(path, options = {}) {
    const response = await fetch(apiBase + path, {
      credentials: "include", ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || "Não foi possível concluir a operação."); error.data = data; throw error; }
    return data;
  }
  async function refreshCsrf() { csrfToken = (await request("/api/auth/csrf")).csrfToken; }
  function message(value, error = false) {
    notice.textContent = value; notice.classList.toggle("error", error); notice.hidden = !value;
  }
  function makeCard(teacher) {
    const card = document.createElement("article"); card.className = "teacher-card";
    const details = document.createElement("div"); details.className = "teacher-details";
    const name = document.createElement("h3"); name.textContent = teacher.full_name;
    const email = document.createElement("p"); email.textContent = teacher.email;
    const date = document.createElement("small"); date.textContent = "Solicitação recebida: " + new Date(teacher.created_at).toLocaleString("pt-BR");
    details.append(name, email, date);
    const actions = document.createElement("div"); actions.className = "teacher-actions";
    const approve = document.createElement("button"); approve.className = "primary-button"; approve.type = "button"; approve.textContent = "Aprovar";
    const reject = document.createElement("button"); reject.className = "secondary-button"; reject.type = "button"; reject.textContent = "Rejeitar";
    approve.addEventListener("click", () => decide(teacher.id, "approve", approve, reject));
    reject.addEventListener("click", () => decide(teacher.id, "reject", approve, reject));
    actions.append(approve, reject); card.append(details, actions); return card;
  }
  async function loadPending() {
    list.replaceChildren();
    const loading = document.createElement("p"); loading.className = "form-help"; loading.textContent = "Carregando...";
    list.append(loading);
    try {
      const data = await request("/api/admin/teachers/pending");
      count.textContent = String(data.teachers.length);
      list.replaceChildren();
      if (!data.teachers.length) {
        const empty = document.createElement("p"); empty.className = "form-help"; empty.textContent = "Nenhum cadastro aguardando aprovação."; list.append(empty); return;
      }
      data.teachers.forEach((teacher) => list.append(makeCard(teacher)));
    } catch (error) {
      list.replaceChildren(); message(error.message, true);
      if (/login|sessão|autorização/i.test(error.message)) window.location.href = "./";
    }
  }
  async function decide(id, action, approve, reject) {
    approve.disabled = true; reject.disabled = true; message("");
    try {
      await refreshCsrf();
      const data = await request("/api/admin/teachers/" + encodeURIComponent(id) + "/" + action, {
        method: "POST", headers: { "x-csrf-token": csrfToken }, body: JSON.stringify({})
      });
      message(data.message); await loadPending();
    } catch (error) { message(error.message, true); }
    finally { approve.disabled = false; reject.disabled = false; }
  }
  document.querySelector("#refresh").addEventListener("click", loadPending);
  document.querySelector("#logout").addEventListener("click", async () => {
    try { await refreshCsrf(); await request("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": csrfToken }, body: JSON.stringify({}) }); }
    finally { window.location.href = "./"; }
  });

  function addSelectOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  async function loadBlockOptions() {
    const [spaceData, periodData] = await Promise.all([
      request("/api/admin/spaces").catch(() => ({ spaces: [] })),
      request("/api/admin/periods").catch(() => ({ periods: [] }))
    ]);
    const spaces = $("#block-space");
    const periods = $("#block-period");
    spaces.replaceChildren();
    periods.replaceChildren();
    addSelectOption(spaces, "", "Todos os espaços");
    addSelectOption(periods, "", "Dia inteiro");
    spaceData.spaces.forEach((space) => addSelectOption(spaces, space.id, space.name));
    periodData.periods.forEach((period) => addSelectOption(
      periods, period.id,
      (period.shift === "morning" ? "Manhã" : period.shift === "afternoon" ? "Tarde" : "Noite") +
      " · " + period.period_number + "ª aula"
    ));
  }
  async function loadBlocks() {
    const container = $("#block-list");
    if (!container) return;
    container.textContent = "Carregando bloqueios...";
    try {
      const data = await request("/api/admin/calendar-blocks");
      container.replaceChildren();
      if (!data.blocks.length) {
        const empty = document.createElement("p");
        empty.className = "form-help";
        empty.textContent = "Nenhum bloqueio cadastrado.";
        container.append(empty);
        return;
      }
      data.blocks.forEach((block) => {
        const card = document.createElement("article");
        card.className = "block-card";
        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = new Date(block.block_date + "T12:00:00").toLocaleDateString("pt-BR") +
          " · " + (block.space_name || "Todos os espaços");
        const detail = document.createElement("p");
        detail.textContent = (block.period_number ? block.period_number + "ª aula" : "Dia inteiro") + " · " + block.reason;
        info.append(title, detail);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-button";
        remove.textContent = "Remover";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await refreshCsrf();
            const result = await request("/api/admin/calendar-blocks/" + encodeURIComponent(block.id), {
              method: "DELETE", headers: { "x-csrf-token": csrfToken }
            });
            message(result.message);
            await loadBlocks();
          } catch (error) { message(error.message, true); }
          finally { remove.disabled = false; }
        });
        card.append(info, remove);
        container.append(card);
      });
    } catch (error) {
      container.textContent = error.message;
    }
  }
  const blockForm = $("#block-form");
  if (blockForm) {
    blockForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = blockForm.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await refreshCsrf();
        const result = await request("/api/admin/calendar-blocks", {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify({
            date: $("#block-date").value,
            spaceId: $("#block-space").value || null,
            periodId: $("#block-period").value || null,
            reason: $("#block-reason").value
          })
        });
        message(result.message);
        $("#block-reason").value = "";
        await loadBlocks();
      } catch (error) {
        if (error.data?.warning && window.confirm(
          error.message + " Quantidade de professores afetados: " + error.data.affectedTeachers +
          ". Deseja criar o bloqueio e enviar avisos internos?"
        )) {
          try {
            await refreshCsrf();
            const confirmed = await request("/api/admin/calendar-blocks", {
              method: "POST",
              headers: { "x-csrf-token": csrfToken },
              body: JSON.stringify({
                date: $("#block-date").value,
                spaceId: $("#block-space").value || null,
                periodId: $("#block-period").value || null,
                reason: $("#block-reason").value,
                confirmExistingReservations: true
              })
            });
            message(confirmed.message);
            $("#block-reason").value = "";
            await loadBlocks();
          } catch (confirmError) { message(confirmError.message, true); }
        } else {
          message(error.message, true);
        }
      }
      finally { button.disabled = false; }
    });
    $("#refresh-blocks").addEventListener("click", loadBlocks);
    loadBlockOptions().then(loadBlocks).catch((error) => message(error.message, true));
  }


  async function fillOptions(selector, items, label) {
    const el=$(selector); el.replaceChildren(); addSelectOption(el,"","Selecione");
    items.forEach(item=>addSelectOption(el,item.id,label(item)));
  }
  async function loadTimetableOptions(){
    const [teachers,classes,subjects,periods]=await Promise.all([
      request("/api/admin/teachers/active"),request("/api/admin/class-groups"),
      request("/api/admin/subjects"),request("/api/admin/periods")
    ]);
    await fillOptions("#timetable-teacher",teachers.teachers,t=>t.full_name);
    await fillOptions("#timetable-class",classes.classGroups,c=>c.name);
    await fillOptions("#timetable-subject",subjects.subjects,s=>s.name);
    await fillOptions("#timetable-period",periods.periods,p=>(p.shift==="morning"?"Manhã":p.shift==="afternoon"?"Tarde":"Noite")+" · "+p.period_number+"ª aula");
  }
  async function loadTeacherTimetable(){
    const teacherId=$("#timetable-teacher").value, container=$("#timetable-current");
    if(!teacherId){container.textContent="Selecione um professor para visualizar a grade.";return;}
    container.textContent="Carregando grade...";
    try{
      const data=await request("/api/admin/teachers/"+encodeURIComponent(teacherId)+"/timetable");
      container.replaceChildren();
      if(!data.entries.length){container.textContent="Nenhuma aula cadastrada para este professor.";return;}
      const days=["","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira"];
      data.entries.forEach(entry=>{
        const row=document.createElement("article");row.className="block-card";
        const info=document.createElement("div"),title=document.createElement("strong"),detail=document.createElement("p");
        title.textContent=days[entry.weekday]+" · "+entry.period_number+"ª aula";
        detail.textContent=entry.class_group_name+" · "+entry.subject_name+" · "+entry.starts_at.slice(0,5)+"–"+entry.ends_at.slice(0,5);
        info.append(title,detail);
        const remove=document.createElement("button");remove.className="secondary-button";remove.type="button";remove.textContent="Remover";
        remove.addEventListener("click",async()=>{try{await refreshCsrf();await request("/api/admin/teachers/"+encodeURIComponent(teacherId)+"/timetable/"+encodeURIComponent(entry.id),{method:"DELETE",headers:{"x-csrf-token":csrfToken}});await loadTeacherTimetable();}catch(e){message(e.message,true);}});
        row.append(info,remove);container.append(row);
      });
    }catch(e){container.textContent=e.message;}
  }
  $("#timetable-teacher").addEventListener("change",loadTeacherTimetable);
  $("#timetable-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;
    try{
      await refreshCsrf();
      const teacherId=$("#timetable-teacher").value;
      const data=await request("/api/admin/teachers/"+encodeURIComponent(teacherId)+"/timetable",{method:"POST",headers:{"x-csrf-token":csrfToken},body:JSON.stringify({weekday:Number($("#timetable-day").value),classGroupId:$("#timetable-class").value,subjectId:$("#timetable-subject").value,lessonPeriodId:$("#timetable-period").value})});
      message(data.message);await loadTeacherTimetable();
    }catch(e){message(e.message,true);}finally{button.disabled=false;}
  });

  loadPending();
  loadTimetableOptions().catch(error=>message(error.message,true));
})();
