// Fallback de posición en vivo: cuando AeroDataBox no trae la ubicación del
// avión, la pedimos a OpenSky Network por el ICAO24 (campo modeS del avión).
// OpenSky es gratis; si se llena de límites, se puede cargar OPENSKY_USER /
// OPENSKY_PASS (cuenta gratuita) para más cuota.
export default async (req) => {
  const url = new URL(req.url);
  const icao24 = (url.searchParams.get("icao24") || "").trim().toLowerCase();
  if (!icao24) return json(400, { error: "Falta icao24" });

  const api = `https://opensky-network.org/api/states/all?icao24=${encodeURIComponent(icao24)}`;
  const headers = {};
  const user = process.env.OPENSKY_USER, pass = process.env.OPENSKY_PASS;
  if (user && pass) headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  let res;
  try {
    res = await fetch(api, { headers });
  } catch (e) {
    return json(502, { error: e.message, found: false });
  }
  if (!res.ok) return json(200, { found: false, note: "OpenSky " + res.status });

  const data = await res.json();
  const s = data.states && data.states[0];
  if (!s) return json(200, { found: false });

  // Índices del array de estado de OpenSky:
  // 5=longitude, 6=latitude, 7=baro_altitude(m), 9=velocity(m/s), 10=true_track(deg)
  if (typeof s[6] !== "number" || typeof s[5] !== "number") return json(200, { found: false });
  return json(200, {
    found: true,
    lat: s[6],
    lon: s[5],
    alt: s[7],     // metros
    speed: s[9],   // m/s
    track: s[10],  // grados
  });
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
