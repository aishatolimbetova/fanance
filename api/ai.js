// Vercel Serverless Function: адрес /api/ai (тот же, что у server.js). Вся логика — в ../ai.js.
module.exports = (req, res) => require("../ai").handle(req, res).catch(() => { try { res.statusCode = 500; res.end(); } catch (e) {} });
