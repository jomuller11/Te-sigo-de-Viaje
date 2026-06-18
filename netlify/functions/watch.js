// Registra un vuelo + destino (Telegram y/o email) para que el cron lo
// vigile y avise cuando despega, aterriza o hay cambios.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "JSON inválido" }); }

  const flight = (body.flight || "").trim().toUpperCase();
  const date = (body.date || "").trim();            // YYYY-MM-DD (salida local de la pata)
  const chatId = (body.chatId ?? "").toString().trim(); // Telegram
  const email = (body.email || "").trim();          // opcional
  const events = Array.isArray(body.events) ? body.events : [];

  if (!flight) return json(400, { error: "Falta el número de vuelo." });
  if (!chatId && !email) return json(400, { error: "Falta un destino (Telegram o email)." });
  if (email && !/.+@.+\..+/.test(email)) return json(400, { error: "Email inválido." });
  if (!events.length) return json(400, { error: "Elegí al menos un evento." });

  const dest = chatId || email;
  const id = `${flight}__${date || "next"}__${dest}`.replace(/[^a-zA-Z0-9_@.\-]/g, "_");
  const watch = {
    id, flight, date, chatId, email, events,
    createdAt: new Date().toISOString(),
    state: null,        // último snapshot conocido (para detectar cambios)
    notified: {},       // qué eventos ya avisamos (despegue/aterrizaje)
    nextCheckAt: 0,     // se revisa en la próxima corrida del cron
  };

  const store = getStore("watches");
  await store.setJSON(id, watch);

  return json(200, { ok: true, message: "Listo, te vamos a avisar por Telegram." });
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
