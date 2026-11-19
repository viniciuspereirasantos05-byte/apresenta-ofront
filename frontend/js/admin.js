(() => {
  const config = window.KENNEDY_CONFIG || {};
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
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
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
  loadPending();
})();
