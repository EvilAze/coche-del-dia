// lib/admin-handlers/analyze-image.js
// ARQUITECTURA B del DDA: scoring de imagen con VISIÓN IA para asignar el
// zoom_base (y el punto focal) EN FRÍO al ingestar un coche, antes de que nadie
// lo juegue. Complementa la Arquitectura A (telemetría): B arranca en frío
// —no necesita volumen de jugadores—, A calibra el sesgo de B con datos reales.
//
// CÓMO: una sola llamada a Claude visión por coche. Le pasamos la foto + la
// identidad (marca/modelo/año, que el admin ya conoce — no viola CLAUDE.md #5,
// que protege al JUGADOR, no a esta llamada de servidor) y le pedimos que
// puntúe la "iconicidad": cuán fácil es identificar ESTE coche desde un recorte
// críptico. Iconicidad alta ⇒ empezar muy cerrado (zoom_base alto = más difícil);
// baja ⇒ empezar más abierto. También sugiere un punto focal representativo
// pero no delator.
//
// SALIDA ESTRUCTURADA vía TOOL USE forzado: el modelo rellena un esquema fijo y
// leemos el objeto ya parseado (sin parsear texto a mano). HUMAN-IN-LOOP, igual
// que A: esto SUGIERE; el admin revisa y aplica con un clic.
//
// Se enruta por api/admin/[...slug].js (no es una función serverless propia —
// respeta el límite de 12 de Hobby). Requiere ANTHROPIC_API_KEY; si falta,
// responde 503 sin romper nada (fiel a CLAUDE.md #8/#9: degradar en silencio).

import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard, parseBody } from "../../api/_lib/http.js";
import {
  clampZoomBase,
  ZOOM_BASE_MIN,
  ZOOM_BASE_MAX,
} from "../../api/_lib/zoom.js";

// Modelo por defecto: Haiku 4.5, barato y de sobra para este scoring (una
// llamada por alta de coche → céntimos). Override por env ANALYZE_VISION_MODEL
// si quieres más juicio visual (p.ej. claude-opus-4-8).
const DEFAULT_MODEL = "claude-haiku-4-5";

// Mapea iconicidad (1-10) → zoom_base dentro del rango del motor de zoom.
// 1 (anónimo) → ZOOM_BASE_MIN (empieza abierto, más fácil).
// 10 (icónico) → ZOOM_BASE_MAX (empieza cerrado, más difícil).
function zoomBaseFromIconicidad(icon) {
  const n = Math.max(1, Math.min(10, Number(icon) || 1));
  const t = (n - 1) / 9;
  const raw = ZOOM_BASE_MIN + t * (ZOOM_BASE_MAX - ZOOM_BASE_MIN);
  return Math.round(clampZoomBase(raw) * 10) / 10; // 1 decimal, como el slider
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

// Esquema de la "herramienta" que fuerza la salida estructurada. strict:true
// garantiza adherencia al esquema en Opus 4.8. Nota: structured outputs NO
// soporta min/max numérico, así que iconicidad va como enum 1-10 y el foco se
// acota a [0,1] en servidor.
const REPORT_TOOL = {
  name: "reportar_dificultad",
  description:
    "Reporta la dificultad visual del coche para el juego de adivinanza por zoom.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      iconicidad: {
        type: "integer",
        enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        description:
          "Cuán fácil es identificar marca y modelo EXACTOS desde un recorte pequeño/críptico. 1 = sedán anónimo indistinguible; 10 = silueta o detalle inconfundible que lo delata al instante (p.ej. un Porsche 911, un Beetle).",
      },
      rasgo_distintivo: {
        type: "string",
        description:
          "El rasgo visual más identificable del coche (p.ej. 'faros redondos gemelos', 'parrilla de riñones', 'pilotos en C'). Vacío si no hay ninguno claro.",
      },
      foco_x: {
        type: "number",
        description:
          "Coordenada X (0=izquierda, 1=derecha) de un punto focal REPRESENTATIVO pero NO delator: evita logos/insignias que regalen la respuesta.",
      },
      foco_y: {
        type: "number",
        description: "Coordenada Y (0=arriba, 1=abajo) del mismo punto focal.",
      },
      razon: {
        type: "string",
        description:
          "Justificación breve (1 frase) de la iconicidad asignada.",
      },
    },
    required: ["iconicidad", "rasgo_distintivo", "foco_x", "foco_y", "razon"],
    additionalProperties: false,
  },
};

function buildPrompt({ marca, modelo, anio }) {
  const id =
    marca || modelo
      ? `El coche es: ${[marca, modelo, anio].filter(Boolean).join(" ")}.`
      : "No se da la identidad del coche.";
  return (
    "Eres un experto en diseño de dificultad para un juego diario tipo Wordle " +
    "donde el jugador adivina el coche del día a partir de una foto que se " +
    "revela con zoom decreciente en 5 intentos. El intento 1 muestra un recorte " +
    "muy cerrado y críptico; el 5, casi el coche entero.\n\n" +
    id +
    "\n\nEvalúa SOLO a partir de la imagen cuán fácil sería que un aficionado " +
    "identifique marca y modelo exactos desde un recorte pequeño y críptico, y " +
    "sugiere un punto focal representativo pero que NO regale la respuesta " +
    "(evita logos e insignias). Llama a la herramienta reportar_dificultad."
  );
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
      // Degradar en silencio: el panel muestra "IA no configurada" sin romper.
      return res.status(503).json({
        error: "Análisis con IA no configurado (falta ANTHROPIC_API_KEY).",
      });
    }

    const body = parseBody(req);
    const imageUrl =
      typeof body.image_url === "string" ? body.image_url.trim() : "";
    if (!imageUrl || !imageUrl.startsWith("http")) {
      return res.status(400).json({ error: "image_url inválida" });
    }
    const marca = typeof body.marca === "string" ? body.marca.trim() : "";
    const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
    const anio = body.anio != null ? String(body.anio).trim() : "";

    const client = new Anthropic({ apiKey });
    const model = process.env.ANALYZE_VISION_MODEL || DEFAULT_MODEL;

    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [REPORT_TOOL],
      // Forzamos la herramienta: la respuesta SIEMPRE será un tool_use con el
      // esquema, nunca texto libre.
      tool_choice: { type: "tool", name: REPORT_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            { type: "text", text: buildPrompt({ marca, modelo, anio }) },
          ],
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || !toolUse.input) {
      console.error("[admin/analyze-image] sin tool_use en la respuesta");
      return res.status(502).json({ error: "La IA no devolvió un análisis." });
    }

    const out = toolUse.input;
    const iconicidad = Math.max(1, Math.min(10, Number(out.iconicidad) || 1));

    return res.status(200).json({
      iconicidad,
      suggestedZoomBase: zoomBaseFromIconicidad(iconicidad),
      focusX: clamp01(out.foco_x),
      focusY: clamp01(out.foco_y),
      rasgoDistintivo:
        typeof out.rasgo_distintivo === "string" ? out.rasgo_distintivo : "",
      razon: typeof out.razon === "string" ? out.razon : "",
      model,
    });
  } catch (err) {
    // Errores tipados de la SDK → mensajes claros para el admin.
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(502).json({ error: "ANTHROPIC_API_KEY inválida." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Límite de la API de Claude alcanzado, reintenta en unos segundos." });
    }
    console.error("[admin/analyze-image] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Fallo al analizar la imagen",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
