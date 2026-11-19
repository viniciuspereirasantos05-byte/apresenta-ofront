(() => {
  if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.warn("Não foi possível ativar o modo instalável:", error.message);
      });
    });
  }
})();
