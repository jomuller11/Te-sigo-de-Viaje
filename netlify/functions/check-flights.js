// Función PROGRAMADA (cron): revisa cada vuelo seguido y manda email
// cuando despega, aterriza o hay demoras/cambios. Corre cada 15 minutos.
import { getStore } from "@netlify/blobs";

const API_HOST = "aerodatabox.p.rapidapi.com";

export default async () => {
  const store = getStore("watches");
  const { blobs } = await store.list();
  const now = Date.now();

  for (const { key } of blobs) {
    const w = await store.getJSON(key);
    if (!w) continue;
    if (w.nextCheckAt && now < w.nextCheckAt) continue; // todavía no toca

    const leg = await fetchLeg(w.flight, w.date);
    if (!leg) {
      w.nextCheckAt = now + 30 * 60000; // no se encontró aún: reintentar en 30 min
      await store.setJSON(key, w);
      continue;
    }

    await diffAndNotify(w, leg); // manda emails y actualiza w.state / w.notified

    // Si ya aterrizó (o se canceló) y no quedan avisos pendientes, limpiar
    const arrivalDone = !w.events.includes("arrival") || w.notified.arrival;
    if ((isArrived(leg) || isCanceled(leg)) && arrivalDone) {
      await store.delete(key);
    } else {
      w.nextCheckAt = now + nextInterval(leg, now);
      await store.setJSON(key, w);
    }
  }

  return new Response("ok");
};

// Cron: cada 15 minutos (en UTC)
export const config = { schedule: "*/15 * * * *" };

// --- API ---
async function fetchLeg(flight, date) {
  const path = date
    ? `/flights/number/${encodeURIComponent(flight)}/${encodeURIComponent(date)}`
    : `/flights/number/${encodeURIComponent(flight)}`;
  const url = `https://${API_HOST}${path}?withAircraftImage=false&withLocation=false`;
  const res = await fetch(url, {
    headers: { "X-RapidAPI-Key": process.env.RAPIDAPI_KEY, "X-RapidAPI-Host": API_HOST },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  if (!list.length) return null;
  list.sort((a, b) => rel(a) - rel(b)); // la pata activa/próxima primero
  return list[0];
}

// --- Lógica de eventos ---
async function diffAndNotify(w, leg) {
  const prev = w.state || {};
  const cur = snapshot(leg);
  const msgs = [];

  if (w.events.includes("departure") && !w.notified.departure && hasDeparted(leg)) {
    msgs.push(msgDeparted(w, leg));
    w.notified.departure = true;
  }

  if (w.events.includes("arrival") && !w.notified.arrival && isArrived(leg)) {
    msgs.push(msgArrived(w, leg));
    w.notified.arrival = true;
  }

  if (w.events.includes("changes") && Object.keys(prev).length) {
    const changes = [];
    if (prev.depRevised && cur.depRevised && prev.depRevised !== cur.depRevised)
      changes.push(`Nueva salida estimada: ${fmt(cur.depRevised)}`);
    if (prev.arrRevised && cur.arrRevised && prev.arrRevised !== cur.arrRevised)
      changes.push(`Nueva llegada estimada: ${fmt(cur.arrRevised)}`);
    if (prev.depGate && cur.depGate && prev.depGate !== cur.depGate)
      changes.push(`Cambió la puerta de salida: ${cur.depGate}`);
    if (prev.status && cur.status && prev.status !== cur.status)
      changes.push(`Estado: ${cur.status}`);
    if (changes.length) msgs.push(msgChanges(w, leg, changes));
  }

  w.state = cur;
  for (const m of msgs) await notify(w, m);
}

function snapshot(leg) {
  return {
    status: leg.status || "",
    depRevised: leg.departure?.revisedTime?.utc || leg.departure?.scheduledTime?.utc || "",
    arrRevised: leg.arrival?.revisedTime?.utc || leg.arrival?.scheduledTime?.utc || "",
    depGate: leg.departure?.gate || "",
    arrGate: leg.arrival?.gate || "",
  };
}

function rel(f) {
  const s = (f.status || "").toLowerCase();
  if (/(enroute|departed|boarding|expected|approach|checkin|scheduled|delay)/.test(s)) return 1;
  if (s.includes("arrived") || s.includes("landed") || s.includes("cancel")) return 3;
  return 2;
}
function hasDeparted(leg) { return /(departed|enroute|arrived|landed|approach)/.test((leg.status || "").toLowerCase()); }
function isArrived(leg) { return /(arrived|landed)/.test((leg.status || "").toLowerCase()); }
function isCanceled(leg) { return /cancel/.test((leg.status || "").toLowerCase()); }

// Revisa más seguido cerca de la salida o llegada; más espaciado en crucero
function nextInterval(leg, now) {
  const dep = ts(leg.departure?.revisedTime?.utc || leg.departure?.scheduledTime?.utc);
  const arr = ts(leg.arrival?.revisedTime?.utc || leg.arrival?.scheduledTime?.utc);
  const near = (t) => t && Math.abs(t - now) < 60 * 60000;
  return (near(dep) || near(arr)) ? 15 * 60000 : 30 * 60000;
}
function ts(s) { return s ? new Date(s.replace(" ", "T")).getTime() : null; }
function fmt(s) { try { return new Date(s.replace(" ", "T")).toLocaleString("es-AR"); } catch { return s; } }

// --- Envío (Telegram y/o email) ---
async function notify(w, m) {
  if (w.chatId && process.env.TELEGRAM_BOT_TOKEN) await sendTelegram(w.chatId, m.text);
  if (w.email && process.env.RESEND_API_KEY) await sendEmail(w.email, m.subject, m.html);
}

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.log("Error Telegram:", res.status, await res.text());
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const from = process.env.MAIL_FROM || "Te sigo de Viaje <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.log("Error enviando email:", res.status, await res.text());
}

// Cada builder devuelve { subject, html (email), text (Telegram) }
function route(leg) {
  const dep = leg.departure?.airport, arr = leg.arrival?.airport;
  return `${dep?.iata || "?"} → ${arr?.iata || "?"}`;
}
function msgDeparted(w, leg) {
  return {
    subject: `✈️ Despegó ${w.flight}`,
    text: `✈️ <b>Despegó ${w.flight}</b>\n${route(leg)}`,
    html: tpl(leg, `Tu vuelo <b>${w.flight}</b> despegó.`),
  };
}
function msgArrived(w, leg) {
  const dest = leg.arrival?.airport?.name || "destino";
  return {
    subject: `🛬 Aterrizó ${w.flight}`,
    text: `🛬 <b>Aterrizó ${w.flight}</b>\n${route(leg)}\nEn ${dest}`,
    html: tpl(leg, `Tu vuelo <b>${w.flight}</b> aterrizó en ${dest}.`),
  };
}
function msgChanges(w, leg, changes) {
  return {
    subject: `🔔 Cambios en ${w.flight}`,
    text: `🔔 <b>Cambios en ${w.flight}</b>\n${route(leg)}\n` + changes.map((c) => `• ${c}`).join("\n"),
    html: tpl(leg, `Hubo cambios en tu vuelo <b>${w.flight}</b>:<ul>${changes.map((c) => `<li>${c}</li>`).join("")}</ul>`),
  };
}
function tpl(leg, body) {
  const dep = leg.departure?.airport, arr = leg.arrival?.airport;
  return `<div style="font-family:sans-serif;max-width:480px">
    <h2 style="margin:0 0 4px">${dep?.iata || "?"} → ${arr?.iata || "?"}</h2>
    <p style="color:#666;margin:0 0 16px">${dep?.name || ""} → ${arr?.name || ""}</p>
    <p>${body}</p>
    <p style="color:#999;font-size:13px">${leg.airline?.name || ""} · ${leg.aircraft?.model || ""}</p>
  </div>`;
}
