const crypto = require("node:crypto");

function requireCsrf(req, res, next) {
  const submitted = req.get("x-csrf-token");
  const expected = req.session?.csrfToken;

  if (!submitted || !expected) {
    return res.status(403).json({ error: "Token de segurança ausente. Atualize a página e tente novamente." });
  }

  const submittedBuffer = Buffer.from(submitted);
  const expectedBuffer = Buffer.from(expected);
  if (
    submittedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(submittedBuffer, expectedBuffer)
  ) {
    return res.status(403).json({ error: "Token de segurança inválido. Atualize a página e tente novamente." });
  }

  next();
}

module.exports = { requireCsrf };
