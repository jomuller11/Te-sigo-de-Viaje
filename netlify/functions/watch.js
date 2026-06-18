// Registra un vuelo + email para que el cron lo vigile y avise por mail.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "JSON inválido" }); }

  const flight = (body.flight || "").trim().toUpperCase();
  const date = (body.date || "").trim(); // YYYY-MM-DD (fecha local de salida de la pata)
  const email = (body.email || "").trim();
  const events = Array.isArray(body.events) ? body.events : [];

  if (!flight) return json(400, { error: "Falta el número de vuelo." });
  if (!/.+@.+\..+/.test(email)) return json(400, { error: "Email inválido." });
  if (!events.length) return json(400, { error: "Elegí al menos un evento." });

  const id = `${flight}__${date || "next"}__${email}`.replace(/[^a-zA-Z0-9_@.\-]/g, "_");
  const watch = {
    id, flight, date, email, events,
    createdAt: new Date().toISOString(),
    state: null,        // último snapshot conocido (para detectar cambios)
    notified: {},       // qué eventos ya avisamos (despegue/aterrizaje)
    nextCheckAt: 0,     // se revisa en la próxima corrida del cron
  };

  const store = getStore("watches");
  await store.setJSON(id, watch);

  return json(200, { ok: true, message: "Listo, te vamos a avisar por email." });
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
