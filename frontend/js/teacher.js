(() => {
  const config = window.KENNEDY_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const $ = (selector) => document.querySelector(selector);
  const form = $("#reservation-form");
  const notice = $("#teacher-notice");
  const periodList = $("#period-list");
  const reservationList = $("#reservation-list");
  let csrfToken = "";
  let periods = [];

  async function request(path, options = {}) {
    const response = await fetch(apiBase + path, {
      credentials: "include",
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }

  function showNotice(value, error = false) {
    notice.textContent = value;
    notice.classList.toggle("error", error);
    notice.hidden = !value;
  }

  async function refreshCsrf() {
    csrfToken = (await request("/api/auth/csrf")).csrfToken;
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function formatTime(value) {
    return String(value || "").slice(0, 5);
  }

  function renderPeriods(items) {
    periodList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "form-help";
      empty.textContent = "Não há períodos cadastrados para este turno. A secretaria precisa configurar os horários oficiais.";
      periodList.append(empty);
      return;
    }

    const shifts = { morning: "Manhã", afternoon: "Tarde", evening: "Noite" };
    for (const shift of ["morning", "afternoon", "evening"]) {
      const shiftItems = items.filter((item) => item.shift === shift);
      if (!shiftItems.length) continue;
      const group = document.createElement("div");
      group.className = "period-group";
      const heading = document.createElement("h4");
      heading.textContent = shifts[shift];
      group.append(heading);
      const grid = document.createElement("div");
      grid.className = "period-options";
      shiftItems.forEach((period) => {
        const label = document.createElement("label");
        label.className = "period-option" + (period.available ? "" : " is-unavailable");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = "periodIds";
        input.value = period.id;
        input.disabled = !period.available;
        const text = document.createElement("span");
        text.textContent = period.period_number + "ª aula · " + formatTime(period.starts_at) + "–" + formatTime(period.ends_at);
        label.append(input, text);
        if (period.blocked) {
          const reason = document.createElement("small");
          reason.textContent = "Bloqueado pela secretaria";
          label.append(reason);
        } else if (period.reserved) {
          const reason = document.createElement("small");
          reason.textContent = "Já reservado";
          label.append(reason);
        }
        grid.append(label);
      });
      group.append(grid);
      periodList.append(group);
    }
  }

  async function loadAvailability() {
    const date = $("#booking-date").value;
    const spaceId = $("#booking-space").value;
    const classShift = $("#booking-class").selectedOptions[0]?.dataset.shift || "";
    if (!date || !spaceId || !classShift) {
      renderPeriods([]);
      const help = document.createElement("p");
      help.className = "form-help";
      help.textContent = "Escolha uma data, um espaço e uma turma para consultar os períodos.";
      periodList.replaceChildren(help);
      return;
    }
    periodList.textContent = "Consultando disponibilidade...";
    try {
      const data = await request("/api/teacher/availability?date=" + encodeURIComponent(date) + "&spaceId=" + encodeURIComponent(spaceId));
      periods = data.periods.filter((period) => period.shift === classShift);
      renderPeriods(periods);
    } catch (error) {
      periodList.textContent = error.message;
    }
  }

  function renderReservations(items) {
    reservationList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "form-help";
      empty.textContent = "Você ainda não possui reservas.";
      reservationList.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "reservation-card";
      const title = document.createElement("h3");
      title.textContent = item.space + " · " + new Date(item.date + "T12:00:00").toLocaleDateString("pt-BR");
      const details = document.createElement("p");
      details.textContent = item.classGroup + " · " + item.purpose;
      const times = document.createElement("small");
      times.textContent = item.periods.map((period) => period.number + "ª aula (" + formatTime(period.startsAt) + "–" + formatTime(period.endsAt) + ")").join(" · ");
      const status = document.createElement("span");
      status.className = "reservation-status" + (item.status === "confirmed" ? " is-confirmed" : "");
      status.textContent = item.status === "confirmed" ? "Confirmada" : "Cancelada";
      card.append(title, details, times, status);
      reservationList.append(card);
    });
  }

  async function loadReservations() {
    reservationList.textContent = "Carregando histórico...";
    try {
      const data = await request("/api/teacher/reservations/mine");
      renderReservations(data.reservations);
    } catch (error) {
      reservationList.textContent = error.message;
    }
  }

  async function loadOptions() {
    const [spaceData, classData] = await Promise.all([
      request("/api/teacher/spaces"),
      request("/api/teacher/class-groups")
    ]);
    const spaceSelect = $("#booking-space");
    const classSelect = $("#booking-class");
    spaceSelect.replaceChildren();
    classSelect.replaceChildren();
    addOption(spaceSelect, "", "Selecione um espaço");
    addOption(classSelect, "", "Selecione uma turma");
    spaceData.spaces.forEach((space) => addOption(spaceSelect, space.id, space.name));
    classData.classGroups.forEach((group) => { addOption(classSelect, group.id, group.name); classSelect.lastElementChild.dataset.shift = group.shift; });
    if (!spaceData.spaces.length || !classData.classGroups.length) {
      showNotice("A secretaria ainda precisa cadastrar os espaços ou as turmas antes de liberar reservas.");
    }
  }

  async function init() {
    try {
      const me = await request("/api/auth/me");
      if (!me.authenticated || me.user.role !== "teacher") { window.location.href = "./"; return; }
      $("#welcome-title").textContent = "Olá, " + me.user.fullName + "!";
      await loadOptions();
      const periodData = await request("/api/teacher/periods");
      periods = periodData.periods;
      await loadReservations();
      await loadAvailability();
    } catch (_error) {
      window.location.href = "./";
    }
  }

  $("#booking-date").addEventListener("change", loadAvailability);
  $("#booking-space").addEventListener("change", loadAvailability);
  $("#booking-class").addEventListener("change", loadAvailability);
  $("#refresh-availability").addEventListener("click", loadAvailability);
  $("#refresh-reservations").addEventListener("click", loadReservations);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#submit-reservation");
    const selected = [...form.querySelectorAll('input[name="periodIds"]:checked')].map((input) => input.value);
    if (!selected.length) {
      showNotice("Selecione pelo menos um período disponível.", true);
      return;
    }
    button.disabled = true;
    showNotice("");
    try {
      await refreshCsrf();
      const payload = {
        date: $("#booking-date").value,
        spaceId: $("#booking-space").value,
        classGroupId: $("#booking-class").value,
        purpose: $("#booking-purpose").value,
        periodIds: selected
      };
      const data = await request("/api/teacher/reservations", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify(payload)
      });
      showNotice(data.message);
      $("#booking-purpose").value = "";
      await loadAvailability();
      await loadReservations();
    } catch (error) {
      showNotice(error.message, true);
      await loadAvailability();
    } finally {
      button.disabled = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    try {
      await refreshCsrf();
      await request("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify({})
      });
    } finally { window.location.href = "./"; }
  });

  init();
})();
