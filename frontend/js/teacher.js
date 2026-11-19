(() => {
  const config = window.KENNEDY_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  async function request(path, options = {}) {
    const response = await fetch(apiBase + path, { credentials: "include", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível validar sua sessão.");
    return data;
  }
  async function init() {
    try {
      const data = await request("/api/auth/me");
      if (!data.authenticated || data.user.role !== "teacher") { window.location.href = "./"; return; }
      document.querySelector("#teacher-name").textContent = "Olá, " + data.user.fullName + "!";
    } catch (_error) { window.location.href = "./"; }
  }
  document.querySelector("#logout").addEventListener("click", async () => {
    try {
      const csrf = await request("/api/auth/csrf");
      await request("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken }, body: JSON.stringify({}) });
    } finally { window.location.href = "./"; }
  });
  init();
})();
