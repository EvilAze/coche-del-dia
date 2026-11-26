// lib/admin-handlers/suggest-specs.js
// «Sugerir cifras» del panel interno: propone las cuatro cifras de la ficha
// técnica (potencia, par, 0-100, velocidad máxima) para que el admin las
// revise y pulse Guardar. NO escribe nada: devuelve sugerencias y el panel
// prerrellena el formulario, igual que «Generar con IA» con la descripción.
//
// POR QUÉ DOS VOTOS Y NO UNO. Una cifra mal puesta es PEOR que un hueco: el
// hueco no se pinta (api/_lib/cifras.js), y una potencia inventada se le
// enseña en grande a quien acaba de ganar. Un LLM sin búsqueda contesta con la
// misma seguridad cuando sabe que cuando confunde versiones —el caso real que
// motivó esto: el mismo modelo, con pocos años de diferencia, con un 6 % más
// de potencia según la serie—. La forma barata de detectar esa confusión es preguntar a DOS modelos
// de familias distintas y quedarse solo con lo que coincide: entrenados sobre
// datos distintos, es poco probable que alucinen la MISMA cifra. Lo que no
// coincide se queda vacío y se explica, y el admin decide.
//
// POR QUÉ SIN BÚSQUEDA WEB. Es lo único gratuito que hay: la búsqueda de Google
// de Gemini da 429 sin facturación (comprobado otra vez el 16-oct-2026, igual
// que en sept-2026), así que los dos votos tiran de lo que el modelo sabe.
// Por eso el prompt les obliga a decir QUÉ VERSIÓN asumen y a abstenerse si
// dudan, y el panel enseña esa versión al lado de la foto.
//
// Dos familias de modelos distintas en Groq (gratuitas, una sola GROQ_API_KEY,
// cada modelo con su propia cuota de 1.000 RPD):
//   • Voto 1: `openai/gpt-oss-120b` (familia OpenAI).
//   • Voto 2: `llama-3.3-70b-versatile` (familia Meta). Si da 429/503/502/404
//     se reintenta UNA vez con `qwen/qwen3-32b` (familia Alibaba); si tampoco,
//     se sigue sin segundo voto.
//
// Se enruta por api/admin/[...slug].js (no gasta slot de función, límite 12 de
// Hobby). Degrada en silencio: sin clave o con los dos modelos caídos responde
// un JSON que dice por qué, y el panel no se rompe.

import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard, parseBody } from "../../api/_lib/http.js";
import { CIFRAS, parseCifra } from "../../api/_lib/cifras.js";
import { conTimeout, TimeoutError } from "../../api/_lib/timeout.js";

const MODELO_GPT_OSS = "openai/gpt-oss-120b";
const MODELO_LLAMA = "llama-3.3-70b-versatile";
const MODELO_LLAMA_RESPALDO = "qwen/qwen3-32b";

// Plazos (regla 21). El dispatcher le da 55 s a la ruta entera; los dos votos
// van EN PARALELO, así que el peor caso es el más lento de los dos, no la suma.
// gpt-oss razona antes de contestar; Llama tiene dos intentos EN SERIE
// (principal + respaldo Qwen), 24 + 24 = 48 s sigue por debajo de los 55.
const PLAZO_GPT_OSS_MS = 45000;
const PLAZO_LLAMA_MS = 24000;

// TOLERANCIAS DEL CONSENSO. Relativas para las cifras grandes (3 % separa una
// errata de redondeo —CV vs PS, 300 vs 305 km/h según la fuente— de una versión
// distinta) y absoluta para el 0-100, donde una décima o dos es lo que bailan
// las fuentes y 0,3 s ya es otra versión o otro cambio.
export const TOLERANCIAS = {
  potencia_cv: { relativa: 0.03 },
  par_nm: { relativa: 0.03 },
  aceleracion_0_100: { absoluta: 0.3 },
  vmax_kmh: { relativa: 0.03 },
};

// Margen para que la aritmética en coma flotante no deje fuera un caso que
// está justo en el borde (4,8 − 4,5 = 0,2999…98, no 0,3).
const EPSILON = 1e-9;

// Con dos o más cifras en desacuerdo de verdad, los modelos no están dudando
// de una cifra: están hablando de VERSIONES distintas. Entonces tampoco nos
// fiamos de las que coinciden por casualidad (el 0-100 o la punta pueden caer
// dentro de tolerancia entre dos series que no son la misma), y no se sugiere
// ninguna.
const DISCREPANCIAS_PARA_ABSTENERSE = 2;

/**
 * ¿Dos valores de la misma cifra coinciden dentro de tolerancia?
 * La relativa se mide contra el MENOR de los dos: es la lectura estricta, y
 * así el resultado no depende de en qué orden lleguen los votos.
 */
export function dentroDeTolerancia(col, a, b) {
  const t = TOLERANCIAS[col];
  if (!t) return a === b;
  const diferencia = Math.abs(a - b);
  if (t.absoluta != null) return diferencia <= t.absoluta + EPSILON;
  return diferencia <= t.relativa * Math.min(a, b) + EPSILON;
}

// Si coinciden dentro de tolerancia pero no son idénticas, se sugiere la
// CONSERVADORA: menos potencia, menos par, menos punta, más tiempo en el 0-100.
// No una media: la media es una cifra que no ha dicho nadie y que seguro que no
// es la oficial, mientras que cada voto tiene alguna posibilidad de serlo. Y
// entre los dos, quedarse corto es el error que menos se nota en una ficha.
function conservadora(col, a, b) {
  return col === "aceleracion_0_100" ? Math.max(a, b) : Math.min(a, b);
}

// Lo que dice el modelo sobre la versión, saneado para enseñarlo en el panel:
// texto corto, de una línea, o null si no dijo nada aprovechable.
function limpiarVersion(v) {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 160) : null;
}

/**
 * Saca el objeto JSON de la respuesta de un modelo. Les pedimos JSON estricto,
 * pero un modelo que lo envuelve en ```json o le pone una frase delante no
 * debería costarnos el voto entero.
 *
 * @returns {object|null}
 */
export function extraerJson(texto) {
  if (typeof texto !== "string") return null;
  const sinPensar = texto.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const limpio = sinPensar.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const candidatos = [limpio];
  const ini = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (ini !== -1 && fin > ini) candidatos.push(limpio.slice(ini, fin + 1));
  for (const c of candidatos) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

/**
 * Un voto normalizado: la versión que asumió el modelo y cada cifra validada
 * con `parseCifra` (los mismos rangos que los CHECK de la BD). Lo que no pase
 * —texto con unidades, fuera de rango, decimales en un entero— cuenta como
 * abstención en esa cifra: preferimos perder una cifra a interpretarla.
 *
 * @param {object|null} obj  el JSON que devolvió el modelo
 * @returns {{ version: string|null, cifras: Record<string, number|null> }|null}
 */
export function leerVoto(obj) {
  if (!obj || typeof obj !== "object") return null;
  const cifras = {};
  for (const def of CIFRAS) {
    const bruto = obj[def.col];
    // Solo números o texto numérico. Un `true` o un objeto no es una cifra.
    if (typeof bruto !== "number" && typeof bruto !== "string") {
      cifras[def.col] = null;
      continue;
    }
    // En los enteros parseCifra rechaza «381.0», que es como algunos modelos
    // escriben un entero en JSON: lo aceptamos solo si de verdad es entero.
    let entrada = bruto;
    if (def.decimales === 0 && typeof bruto === "string" && /^\d+\.0+$/.test(bruto.trim())) {
      entrada = Number(bruto);
    }
    // Un entero que llega con decimales de verdad (360.5 CV) no es una cifra
    // de ficha: algo ha ido mal y no la redondeamos a escondidas.
    if (def.decimales === 0 && typeof entrada === "number" && !Number.isInteger(entrada)) {
      cifras[def.col] = null;
      continue;
    }
    const { value, error } = parseCifra(def, entrada);
    cifras[def.col] = error ? null : value;
  }
  return { version: limpiarVersion(obj.version), cifras };
}

/**
 * EL CONSENSO. Pura y sin red: es lo que decide qué se le enseña al admin, y
 * por eso es lo que tiene tests.
 *
 * @param {{ gptOss: object|null, llama: object|null }} votos  salidas de leerVoto
 *   (null = ese modelo no votó)
 * @returns {{
 *   sugerencias: Record<string, number|null>,
 *   detalle: Array<{ col, estado, valor, gptOss, llama, motivo }>,
 *   versionesDistintas: boolean,
 * }}
 *   `estado`: "consenso" | "discrepan" | "abstencion" | "sin-voto".
 */
export function consensoCifras({ gptOss, llama }) {
  const detalle = CIFRAS.map((def) => {
    const col = def.col;
    const a = gptOss?.cifras?.[col] ?? null;
    const b = llama?.cifras?.[col] ?? null;
    const base = { col, gptOss: a, llama: b };

    if (!gptOss || !llama) {
      const quien = !gptOss && !llama ? "ningún modelo" : !gptOss ? "GPT-OSS" : "Llama";
      return {
        ...base,
        estado: "sin-voto",
        valor: null,
        motivo: `Falta el voto de ${quien}: sin dos votos no se sugiere.`,
      };
    }
    if (a === null || b === null) {
      const quien = a === null && b === null ? "Ninguno de los dos" : a === null ? "GPT-OSS" : "Llama";
      return {
        ...base,
        estado: "abstencion",
        valor: null,
        motivo: `${quien} no está seguro.`,
      };
    }
    if (!dentroDeTolerancia(col, a, b)) {
      return {
        ...base,
        estado: "discrepan",
        valor: null,
        motivo: `No coinciden: GPT-OSS ${a} / Llama ${b}.`,
      };
    }
    return {
      ...base,
      estado: "consenso",
      valor: conservadora(col, a, b),
      motivo: a === b ? null : `Difieren poco (GPT-OSS ${a} / Llama ${b}): se sugiere la más conservadora.`,
    };
  });

  const discrepancias = detalle.filter((d) => d.estado === "discrepan").length;
  const versionesDistintas = discrepancias >= DISCREPANCIAS_PARA_ABSTENERSE;
  if (versionesDistintas) {
    for (const d of detalle) {
      if (d.estado === "consenso") {
        d.estado = "discrepan";
        d.valor = null;
        d.motivo =
          "Coinciden, pero los modelos discrepan en otras cifras: probablemente hablan de versiones distintas.";
      }
    }
  }

  const sugerencias = Object.fromEntries(detalle.map((d) => [d.col, d.valor]));
  return { sugerencias, detalle, versionesDistintas };
}

const SYSTEM_PROMPT = [
  "Eres un documentalista de fichas técnicas de coches. Te dan un coche (marca,",
  "modelo, año) y devuelves sus cifras OFICIALES de fabricante.",
  "",
  "EXACTITUD — LO ÚNICO QUE IMPORTA: una cifra equivocada es mucho peor que una",
  "cifra vacía. Si no conoces una cifra con seguridad, devuelve null. No la",
  "aproximes, no la deduzcas de otras versiones, no la calcules.",
  "",
  "VERSIÓN: un mismo modelo tiene a menudo varias versiones o series con cifras",
  "distintas (motores, fases, restylings). Di en `version` cuál asumes, con el",
  "detalle que la distinga (serie/generación, motor, fase). Si para ese año hubo",
  "varias y no puedes saber cuál es, elige la de lanzamiento de ese año y dilo.",
  "",
  "UNIDADES: potencia en CV métricos (PS), NO en hp ni kW; par en Nm; 0-100 km/h",
  "en segundos con un decimal; velocidad máxima en km/h. Si el coche no llega a",
  "100 km/h, aceleracion_0_100 es null.",
  "",
  "FORMATO: responde ÚNICAMENTE con un objeto JSON, sin texto alrededor ni",
  "bloques de código, con exactamente estas claves:",
  '{"version": string, "potencia_cv": number|null, "par_nm": number|null,',
  '"aceleracion_0_100": number|null, "vmax_kmh": number|null}',
  "Números JSON (punto decimal), sin unidades dentro.",
].join("\n");

function buildUserPrompt({ marca, modelo, anio, pais }) {
  const identidad = [marca, modelo, anio].filter(Boolean).join(" ");
  const origen = pais ? ` (origen: ${pais})` : "";
  return `Ficha técnica de: ${identidad}${origen}.`;
}

// ── Votos ───────────────────────────────────────────────────────────────
// Cada uno devuelve { ok: true, voto, modelo } o { ok: false, error, modelo },
// NUNCA lanza: un proveedor caído es un voto que falta, no un 500.

async function intentoGroq(groq, modelo, identidad, plazoMs) {
  const response = await conTimeout(
    groq.chat.completions.create({
      model: modelo,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(identidad) },
      ],
      // Cero: queremos la cifra que el modelo cree más probable, no variedad.
      temperature: 0,
      max_tokens: 4096,
    }),
    plazoMs,
    { etiqueta: `groq/${modelo}` }
  );
  return response.choices?.[0]?.message?.content ?? null;
}

async function votoGptOss(groq, identidad) {
  try {
    const texto = await intentoGroq(groq, MODELO_GPT_OSS, identidad, PLAZO_GPT_OSS_MS);
    const voto = leerVoto(extraerJson(texto));
    if (!voto) return { ok: false, modelo: MODELO_GPT_OSS, error: "respuesta sin JSON legible" };
    return { ok: true, modelo: MODELO_GPT_OSS, voto };
  } catch (err) {
    return { ok: false, modelo: MODELO_GPT_OSS, error: describirError(err) };
  }
}

async function votoLlama(groq, identidad) {
  let modelo = MODELO_LLAMA;
  try {
    let texto;
    try {
      texto = await intentoGroq(groq, modelo, identidad, PLAZO_LLAMA_MS);
    } catch (err) {
      const st = err?.status;
      // 503/502 = saturado, 429 = cuota del modelo, 404 = modelo retirado:
      // probamos el respaldo (familia Qwen), que tiene su propio cupo.
      if (st === 503 || st === 502 || st === 429 || st === 404) {
        modelo = MODELO_LLAMA_RESPALDO;
        texto = await intentoGroq(groq, modelo, identidad, PLAZO_LLAMA_MS);
      } else {
        throw err;
      }
    }
    const voto = leerVoto(extraerJson(texto));
    if (!voto) return { ok: false, modelo, error: "respuesta sin JSON legible" };
    return { ok: true, modelo, voto };
  } catch (err) {
    return { ok: false, modelo, error: describirError(err) };
  }
}

function describirError(err) {
  if (err instanceof TimeoutError) return "no respondió a tiempo";
  const status = err?.status;
  if (status === 401 || status === 403) return "clave inválida o sin permisos";
  if (status === 429) return "límite de uso alcanzado";
  if (status) return `HTTP ${status}`;
  return String(err?.message || err).slice(0, 200);
}

export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;

  try {
    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (!groqKey) {
      return res.status(503).json({
        error: "Sugerir cifras no está configurado: falta GROQ_API_KEY en Vercel.",
      });
    }

    const body = parseBody(req);
    const marca = typeof body.marca === "string" ? body.marca.trim() : "";
    const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
    const anio = body.anio != null ? String(body.anio).trim() : "";
    const pais = typeof body.pais === "string" ? body.pais.trim() : "";
    // Sin marca ni modelo no hay coche del que buscar cifras.
    if (!marca || !modelo) {
      return res.status(400).json({ error: "marca y modelo son obligatorios" });
    }
    const identidad = { marca, modelo, anio, pais };

    const { Groq } = await import("groq-sdk");
    const groq = new Groq({ apiKey: groqKey, maxRetries: 0 });

    const [a, b] = await Promise.all([
      votoGptOss(groq, identidad),
      votoLlama(groq, identidad),
    ]);

    const votos = {
      gptOss: { ok: a.ok, modelo: a.modelo, version: a.voto?.version ?? null, error: a.error ?? null },
      llama: { ok: b.ok, modelo: b.modelo, version: b.voto?.version ?? null, error: b.error ?? null },
    };

    // Los dos caídos: no hay nada que enseñar, y un 503 con el porqué es más
    // honesto que un 200 con cuatro huecos.
    if (!a.ok && !b.ok) {
      console.error("[admin/suggest-specs] sin votos:", a.error, "|", b.error);
      return res.status(503).json({
        error: `Ningún modelo respondió (GPT-OSS: ${a.error}; Llama: ${b.error}). Reintenta en un rato.`,
        votos,
      });
    }

    const { sugerencias, detalle, versionesDistintas } = consensoCifras({
      gptOss: a.ok ? a.voto : null,
      llama: b.ok ? b.voto : null,
    });

    let aviso = null;
    if (!a.ok || !b.ok) {
      const caido = !a.ok ? `GPT-OSS (${a.error})` : `Llama (${b.error})`;
      aviso = `Solo respondió un modelo; ${caido} falló. Sin segundo voto no se sugiere ninguna cifra.`;
    } else if (versionesDistintas) {
      aviso = "Los modelos discrepan en varias cifras: probablemente asumen versiones distintas. No se sugiere ninguna.";
    }

    return res.status(200).json({ sugerencias, detalle, votos, aviso });
  } catch (err) {
    console.error("[admin/suggest-specs] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Fallo al sugerir las cifras",
      detail: process.env.NODE_ENV === "production" ? undefined : String(err?.message || err),
    });
  }
}
