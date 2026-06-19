// Detecta el chat ID del usuario leyendo los últimos mensajes que recibió
// el bot. El usuario abre su bot, aprieta Start y llama a este endpoint.
export default async () => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return json(500, { error: "Falta TELEGRAM_BOT_TOKEN en el servidor." });

  // Validar el token con getMe (da un error más claro que getUpdates)
  const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
  if (!me.ok) {
    return json(502, {
      error: `Telegram rechazó el token: "${me.description || "?"}". ` +
        `El servidor leyó un token de ${token.length} caracteres que empieza con "${token.slice(0, 6)}". ` +
        `Si eso no coincide con tu bot, el valor en Netlify está mal.`,
    });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const data = await res.json();
  if (!data.ok) return json(502, { error: "Telegram: " + (data.description || "error") });

  const updates = data.result || [];
  for (let i = updates.length - 1; i >= 0; i--) {
    const msg = updates[i].message || updates[i].edited_message;
    if (msg?.chat?.id) {
      return json(200, {
        chatId: msg.chat.id,
        name: msg.chat.first_name || msg.chat.username || "",
      });
    }
  }
  return json(404, { error: "No vi mensajes todavía. Abrí tu bot en Telegram y apretá Start." });
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
