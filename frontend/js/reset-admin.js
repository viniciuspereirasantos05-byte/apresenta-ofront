(() => {
  const config = window.KENNEDY_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const form = document.querySelector("#reset-form");
  const notice = document.querySelector("#reset-notice");
  const submit = document.querySelector("#reset-submit");

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
      showNotice("A nova senha precisa ter pelo menos 12 caracteres.", true);
      return;
    }

    submit.disabled = true;
    submit.textContent = "Redefinindo...";
    try {
      const csrf = await request("/api/auth/csrf");
      const result = await request("/api/setup/reset-admin-password", {
        method: "POST",
        headers: { "x-csrf-token": csrf.csrfToken },
        body: JSON.stringify({
          resetSecret: values.get("resetSecret"),
          email: values.get("email"),
          password
        })
      });
      form.reset();
      form.hidden = true;
      showNotice("Senha redefinida para " + result.email + ". Agora remova ADMIN_PASSWORD_RESET_SECRET das variáveis de ambiente do backend no Render e salve a alteração. Depois, entre pela página inicial.", false);
    } catch (error) {
      showNotice(error.message, true);
      submit.disabled = false;
      submit.textContent = "Redefinir senha";
    }
  });
})();
