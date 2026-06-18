// Función serverless: hace de proxy a AeroDataBox para que la API key
// nunca quede expuesta en el navegador. La key vive en una variable
// de entorno de Netlify (RAPIDAPI_KEY).
const API_HOST = "aerodatabox.p.rapidapi.com";

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const flight = (params.flight || "").trim();
  const date = (params.date || "").trim(); // opcional: YYYY-MM-DD

  if (!flight) {
    return json(400, { error: "Falta el parámetro 'flight' (ej: AA100)." });
  }

  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    return json(500, { error: "El servidor no tiene configurada RAPIDAPI_KEY." });
  }

  const path = date
    ? `/flights/number/${encodeURIComponent(flight)}/${encodeURIComponent(date)}`
    : `/flights/number/${encodeURIComponent(flight)}`;
  const url = `https://${API_HOST}${path}?withAircraftImage=false&withLocation=true`;

  try {
    const res = await fetch(url, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": API_HOST },
    });
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body,
    };
  } catch (e) {
    return json(502, { error: "No se pudo contactar la API: " + e.message });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
