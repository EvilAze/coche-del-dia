// lib/admin-handlers/describe-car.js
// Genera con IA la descripción en español de un coche para el panel admin.
// Sustituye al flujo manual de "pedírselo a un chat y pegar".
//
// MIGRACIÓN A GROQ (sept 2025): sustituimos Gemini por Groq (Llama 3.3 70B).
// Es gratuito, no tiene cuotas agresivas como la Búsqueda Web de Google,
// y la velocidad es casi instantánea (<1s). Al usar un modelo de 70B, tiene
// conocimiento enciclopédico de los coches, haciendo prescindible la
// necesidad de "grounding" o búsqueda web.
//
// Se enruta por api/admin/[...slug].js (no es una función serverless propia —
// respeta el límite de 12 de Hobby). Requiere GROQ_API_KEY; si falta,
// responde 503 sin romper nada (degradar en silencio).

import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard, parseBody } from "../../api/_lib/http.js";

// Groq (gpt-oss-120b): rapidísimo, gratuito, razonamiento top.
const DEFAULT_MODEL = "openai/gpt-oss-120b";

// Tope de la columna `cars.description` y del textarea del admin. Si el modelo
// se pasa, recortamos aquí en vez de dejar que Postgres o el maxLength del
// textarea corten a mitad de palabra.
export const MAX_DESCRIPTION_LEN = 600;

// Objetivo que le pedimos al modelo, deliberadamente por debajo del tope. Los
// LLM cuentan caracteres fatal: si les pides "unos 600" apuntan a 600 y se
// pasan, y entonces hay que recortar y el texto se lee cortado. Pidiendo 480
// el desbordamiento es raro, y cuando pasa el recorte se come poco.
const OBJETIVO_CARACTERES = 480;

// Normaliza lo que devuelve el modelo: los saltos de línea de un párrafo
// generado se ven fatal en el textarea, y el recorte a pelo (`slice`) partiría
// la última palabra.
//
// El tope es DURO: nada de lo que salga de aquí supera MAX_DESCRIPTION_LEN,
// pase lo que pase con el prompt. Y si hay que recortar, se recorta por el
// final de la última FRASE completa, no por la última palabra: un texto que
// acaba a media frase es justo lo que delataba que aquí había cortado una
// máquina. Preferimos perder la frase entera.
export function limpiarDescripcion(texto) {
  if (typeof texto !== "string") return "";

  const normalizado = texto.replace(/\s+/g, " ").trim();
  if (normalizado.length <= MAX_DESCRIPTION_LEN) return normalizado;

  const recortado = normalizado.slice(0, MAX_DESCRIPTION_LEN);

  // 1ª opción: cerrar en el último final de frase que quepa. Incluimos los
  // cierres de interrogación y exclamación, y las comillas o paréntesis que
  // puedan ir detrás del punto.
  const finFrase = recortado.match(/^[\s\S]*[.!?…]["'»)\]]?(?=\s|$)/);
  if (finFrase) return finFrase[0].trim();

  // 2ª opción (el modelo escribió 600 caracteres sin un solo punto): cortamos
  // por palabra y limpiamos la puntuación que quede colgando.
  const ultimoEspacio = recortado.lastIndexOf(" ");
  const porPalabra = ultimoEspacio > 0 ? recortado.slice(0, ultimoEspacio) : recortado;
  return porPalabra.replace(/[\s,;:.\-–—]+$/, "");
}

const SYSTEM_PROMPT = [
  "Escribes las fichas de un juego diario de adivinar coches. El jugador lee tu",
  "texto justo después de acertar el coche del día: es su recompensa.",
  "",
  "VOZ: hechos y anécdota, sobrio y concreto. Por qué existe ese coche, qué hizo,",
  "algún dato que sorprenda. Nada de titulares, listas, comillas ni emoji: un solo",
  "párrafo corrido. Evita la grandilocuencia y las frases de relleno del tipo",
  '"una auténtica leyenda sobre ruedas" o "marcó un antes y un después".',
  "",
  "IDIOMA: español de España. Cifras con coma decimal y punto de millar.",
  "",
  `LONGITUD: ${MAX_DESCRIPTION_LEN} caracteres COMO MÁXIMO. No es un objetivo que`,
  "haya que alcanzar, es un techo que no puedes rebasar: 600 o menos. Apunta a",
  `unos ${OBJETIVO_CARACTERES} para tener margen, y no rellenes con paja para`,
  "llegar al tope — si lo que tienes que contar ocupa 300 caracteres, entrega 300.",
  "",
  "TERMINA SIEMPRE CON UNA FRASE COMPLETA Y SU PUNTO FINAL. Antes de entregar,",
  "cuenta los caracteres; si te pasas, quita frases enteras, nunca dejes una a",
  "medias.",
  "",
  "EXACTITUD — LO MÁS IMPORTANTE: si un dato (año, cifra, victoria, motorización) no",
  "lo sabes con seguridad, OMÍTELO. No lo aproximes ni lo deduzcas: es preferible una",
  "descripción más corta que una con un dato inventado.",
  "",
  "FORMATO DE RESPUESTA: devuelve ÚNICA Y EXCLUSIVAMENTE el párrafo de la",
  "descripción. Sin titular, sin comillas envolventes, sin explicaciones previas",
  "ni posteriores. Solo el párrafo.",
].join("\n");

function buildUserPrompt({ marca, modelo, anio, pais }) {
  const identidad = [marca, modelo, anio].filter(Boolean).join(" ");
  const origen = pais ? ` Es de origen ${pais}.` : "";
  return `Escribe la descripción de este coche: ${identidad}.${origen}`;
}

// Extrae el texto limpio de la respuesta de Groq.
function extraerTexto(response) {
  const raw = response.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") return "";

  let texto = raw.trim();

  // Si el modelo lo envolvió en un bloque de código markdown
  texto = texto.replace(/^```(?:json|text)?\n?/i, "").replace(/```$/i, "").trim();

  // Limpiar prefijos basura
  texto = texto.replace(/^(text\*?:|descripci[óo]n:|\*\*descripci[óo]n:?\*\*)\s*/i, "").trim();

  // Quitar comillas envolventes si las hay (simples o dobles)
  if (
    (texto.startsWith('"') && texto.endsWith('"')) ||
    (texto.startsWith("«") && texto.endsWith("»")) ||
    (texto.startsWith("'") && texto.endsWith("'"))
  ) {
    texto = texto.slice(1, -1).trim();
  }

  // Asegurar que acabe con un punto si se le olvidó
  if (texto && !/[.!?…»)"']$/.test(texto)) {
    texto += ".";
  }

  return texto;
}

export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;

  try {
    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "Generación con IA no configurada (falta GROQ_API_KEY).",
      });
    }

    const body = parseBody(req);
    const marca = typeof body.marca === "string" ? body.marca.trim() : "";
    const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
    const anio = body.anio != null ? String(body.anio).trim() : "";
    const pais = typeof body.pais === "string" ? body.pais.trim() : "";

    // Sin marca ni modelo el prompt no tiene sujeto y el modelo se inventaría
    // un coche entero.
    if (!marca || !modelo) {
      return res.status(400).json({ error: "marca y modelo son obligatorios" });
    }

    // Import dinámico para no arrastrar al dispatcher entero si falla
    const { Groq } = await import("groq-sdk");
    const groq = new Groq({ apiKey });
    const model = process.env.DESCRIBE_MODEL || DEFAULT_MODEL;

    const response = await groq.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt({ marca, modelo, anio, pais }) },
      ],
      temperature: 0.4,
      max_tokens: 1024,
    });

    const descripcion = limpiarDescripcion(extraerTexto(response));
    if (!descripcion) {
      console.error("[admin/describe-car] respuesta sin texto aprovechable", JSON.stringify(response));
      return res.status(502).json({ 
        error: "La IA no devolvió ninguna descripción. DEBUG: " + JSON.stringify(response) 
      });
    }

    return res.status(200).json({
      descripcion,
      model,
    });
  } catch (err) {
    // Errores comunes
    const msg = err?.message || String(err);

    if (msg.includes("API_KEY") || msg.includes("401") || msg.includes("403")) {
      return res.status(502).json({ error: "GROQ_API_KEY inválida o sin permisos." });
    }
    if (msg.includes("429") || msg.includes("rate_limit")) {
      return res.status(429).json({
        error: "Límite de la API de Groq alcanzado, reintenta en unos segundos.",
      });
    }

    console.error("[admin/describe-car] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Fallo al generar la descripción",
      detail:
        process.env.NODE_ENV === "production" ? undefined : String(err?.message || err),
    });
  }
}

