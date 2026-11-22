(() => {
  const config = window.KENNEDY_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const form = document.querySelector("#setup-form");
  const notice = document.querySelector("#setup-notice");
  const submit = document.querySelector("#setup-submit");

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.hidden = !message;
  }

  async function request(path, options = {}) {
    const response = await fetch(apiBase + path, {
      credentials: "include",
      cache: "no-store",
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showNotice("");
    const values = new FormData(form);
    const password = String(values.get("password") || "");
    const confirmation = String(values.get("passwordConfirm") || "");
    if (password !== confirmation) {
      showNotice("As senhas não coincidem. Confira os dois campos.", true);
      return;
    }
    if (password.length < 12) {
      showNotice("A senha precisa ter pelo menos 12 caracteres.", true);
      return;
    }

    submit.disabled = true;
    submit.textContent = "Criando...";
    try {
      const csrf = await request("/api/auth/csrf");
      const result = await request("/api/setup/first-admin", {
        method: "POST",
        headers: { "x-csrf-token": csrf.csrfToken },
        body: JSON.stringify({
          setupSecret: values.get("setupSecret"),
          fullName: values.get("fullName"),
          email: values.get("email"),
          password
        })
      });
      form.reset();
      form.hidden = true;
      showNotice("Administrador criado com sucesso para " + result.admin.email + ". Agora remova ADMIN_SETUP_SECRET das variáveis de ambiente do backend no Render e salve a alteração. Depois, entre pelo login normal.", false);
    } catch (error) {
      showNotice(error.message, true);
      submit.disabled = false;
      submit.textContent = "Criar administrador";
    }
  });
})();