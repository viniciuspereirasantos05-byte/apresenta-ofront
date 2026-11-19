(() => {
  const config = window.KENNEDY_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const notice = document.querySelector("#notice");
  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");
  const loginPanel = document.querySelector("#login-panel");
  const registerPanel = document.querySelector("#register-panel");
  const pendingPanel = document.querySelector("#pending-panel");
  const tabs = [...document.querySelectorAll("[data-view]")];
  let csrfToken = "";

  async function request(path, options = {}) {
    const response = await fetch(apiBase + path, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir. Tente novamente.");
    return data;
  }

  async function refreshCsrf() {
    const data = await request("/api/auth/csrf");
    csrfToken = data.csrfToken;
  }

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.hidden = !message;
  }

  function showView(view) {
    loginPanel.hidden = view !== "login";
    registerPanel.hidden = view !== "register";
    pendingPanel.hidden = view !== "pending";
    tabs.forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    showNotice("");
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  document.querySelector("#back-to-login").addEventListener("click", () => showView("login"));

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector("button[type=submit]");
    button.disabled = true;
    showNotice("");
    try {
      await refreshCsrf();
      const form = new FormData(loginForm);
      const data = await request("/api/auth/login", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      showNotice("Login realizado. A próxima etapa será conectar o painel da sua conta.");
      loginForm.reset();
      await refreshCsrf();
      console.info("Sessão iniciada para perfil:", data.user.role);
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = registerForm.querySelector("button[type=submit]");
    button.disabled = true;
    showNotice("");
    try {
      await refreshCsrf();
      const form = new FormData(registerForm);
      await request("/api/auth/register", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          email: form.get("email"),
          recoveryEmail: form.get("recoveryEmail"),
          password: form.get("password")
        })
      });
      registerForm.reset();
      showView("pending");
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  refreshCsrf().catch(() => {
    showNotice("O sistema ainda está em preparação. O acesso será liberado quando a API e o banco estiverem configurados.");
  });
})();
