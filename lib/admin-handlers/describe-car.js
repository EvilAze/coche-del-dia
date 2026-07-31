// lib/admin-handlers/describe-car.js
// Genera con IA la descripción en español de un coche para el panel admin.
// Sustituye al flujo manual de "pedírselo a un chat y pegar".
//
// POR QUÉ CON BÚSQUEDA WEB: este texto se le muestra al jugador como verdad al
// ganar la partida. Un modelo tirando de memoria inventa años, cifras y
// victorias en coches poco conocidos; documentándose antes falla mucho menos.
// El admin revisa igualmente: esto SUGIERE, no guarda nada (human-in-loop,
// igual que analyze-image.js).
//
// OJO — DIFERENCIA CLAVE CON analyze-image.js: allí forzamos la herramienta
// (`tool_choice: {type:"tool"}`) para garantizar la salida estructurada. Aquí
// NO se puede: forzarla obliga al modelo a responder de inmediato, sin poder
// buscar antes. Por eso va en automático y el prompt le marca el orden. Como
// la estructura ya no está garantizada por la API, hay plan B leyendo el texto.
//
// Se enruta por api/admin/[...slug].js (no es una función serverless propia —
// respeta el límite de 12 de Hobby). Requiere ANTHROPIC_API_KEY; si falta,
// responde 503 sin romper nada (CLAUDE.md #9: degradar en silencio).

import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard, parseBody } from "../../api/_lib/http.js";

// Sonnet 5 en vez de Opus: redactar 600 caracteres con documentación previa no
// necesita el modelo grande, y baja el coste por coche de ~8 céntimos a ~2.
const DEFAULT_MODEL = "claude-sonnet-5";

// Sonnet 5 lleva el "thinking" adaptativo ENCENDIDO por defecto (al revés que
// Opus, donde hay que pedirlo) y sale del mismo presupuesto que la respuesta.
// max_tokens holgado para que quepan deliberación + búsquedas + texto final.
const MAX_TOKENS = 8192;

// Tope de rondas por si el modelo encadena pausas: cada `pause_turn` consume
// una. Con 3 hay margen de sobra para buscar y redactar sin bucle infinito.
const MAX_RONDAS = 3;

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

// Herramienta con la que el modelo entrega el texto ya redactado. NO la
// forzamos (ver cabecera), así que el prompt le pide explícitamente que la
// llame al final; si aun así respondiera en texto plano, lo recogemos igual.
const REPORT_TOOL = {
  name: "reportar_descripcion",
  description:
    "Entrega la descripción final del coche, ya redactada y lista para publicar.",
  input_schema: {
    type: "object",
    properties: {
      descripcion: {
        type: "string",
        description:
          `La descripción en español, en un solo párrafo, sin titular ni comillas. ` +
          `Máximo ${MAX_DESCRIPTION_LEN} caracteres — es un techo, no un objetivo. ` +
          `Debe terminar en una frase completa con su punto final.`,
      },
    },
    required: ["descripcion"],
    additionalProperties: false,
  },
};

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
  "EXACTITUD — LO MÁS IMPORTANTE: busca en la web antes de escribir y apóyate en",
  "lo que encuentres. Si un dato (año, cifra, victoria, motorización) no lo puedes",
  "confirmar, OMÍTELO. No lo aproximes ni lo deduzcas: es preferible una",
  "descripción más corta que una con un dato inventado.",
  "",
  "Cuando lo tengas, llama a la herramienta reportar_descripcion.",
].join("\n");

function buildUserPrompt({ marca, modelo, anio, pais }) {
  const identidad = [marca, modelo, anio].filter(Boolean).join(" ");
  const origen = pais ? ` Es de origen ${pais}.` : "";
  return `Escribe la descripción de este coche: ${identidad}.${origen}`;
}

// Saca el texto de la respuesta. Ruta preferente: el tool_use con el esquema.
// Plan B: los bloques de texto concatenados, por si el modelo contesta en plano.
function extraerDescripcion(content) {
  const toolUse = content.find(
    (b) => b.type === "tool_use" && b.name === REPORT_TOOL.name
  );
  if (toolUse?.input?.descripcion) return toolUse.input.descripcion;

  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ");
}

export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;

  try {
    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "Generación con IA no configurada (falta ANTHROPIC_API_KEY).",
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

    const client = new Anthropic({ apiKey });
    const model = process.env.DESCRIBE_MODEL || DEFAULT_MODEL;

    const messages = [
      { role: "user", content: buildUserPrompt({ marca, modelo, anio, pais }) },
    ];

    let message;
    for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
      message = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        // "medium" en vez del "high" por defecto: para 600 caracteres sobra, y
        // el thinking adaptativo de Sonnet 5 se paga del mismo presupuesto.
        output_config: { effort: "medium" },
        system: SYSTEM_PROMPT,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
          REPORT_TOOL,
        ],
        messages,
      });

      // El bucle de herramientas de servidor pausa el turno tras varias rondas
      // de búsqueda. Sin reenviar, la respuesta llegaría cortada a medias.
      if (message.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: message.content });
    }

    // Segunda causa posible de un texto cortado, independiente del prompt: que
    // el thinking adaptativo se coma el presupuesto y la generación se trunque
    // de verdad. limpiarDescripcion lo dejará cerrado en la última frase sana,
    // pero conviene verlo en los logs si empieza a pasar a menudo.
    if (message.stop_reason === "max_tokens") {
      console.warn(
        `[admin/describe-car] generación truncada por max_tokens (${MAX_TOKENS})`
      );
    }

    const descripcion = limpiarDescripcion(extraerDescripcion(message.content));
    if (!descripcion) {
      console.error("[admin/describe-car] respuesta sin texto aprovechable");
      return res.status(502).json({ error: "La IA no devolvió ninguna descripción." });
    }

    return res.status(200).json({ descripcion, model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(502).json({ error: "ANTHROPIC_API_KEY inválida." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({
        error: "Límite de la API de Claude alcanzado, reintenta en unos segundos.",
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
