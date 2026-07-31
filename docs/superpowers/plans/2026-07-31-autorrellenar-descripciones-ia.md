# Autorrellenar descripciones con IA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un botón «Generar con IA» al campo «Descripción (ES)» de los paneles de alta y edición de coches, que redacta el texto con Claude Sonnet 5 documentándose antes con búsqueda web.

**Architecture:** Handler nuevo `describe-car` colgado del dispatcher admin que ya existe (no una función serverless propia, por el límite de 12 de Hobby). Llama a Sonnet 5 con dos herramientas —búsqueda web y una herramienta propia de entrega— con `tool_choice` en automático, porque forzarla impediría buscar antes de responder. En el cliente, un componente `DescriptionEsField` gemelo del `DescriptionEnField` que ya existe, usado por los dos paneles.

**Tech Stack:** `@anthropic-ai/sdk` 0.102.0 (ya instalado), React 18 JSX, Vitest, Vercel Functions (Node).

**Spec:** [docs/superpowers/specs/2026-07-31-autorrellenar-descripciones-ia-design.md](../specs/2026-07-31-autorrellenar-descripciones-ia-design.md)

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `lib/admin-handlers/describe-car.js` (crear) | Handler: auth, validación, llamada a Claude, limpieza del texto |
| `lib/admin-handlers/describe-car.test.js` (crear) | Test unitario del helper puro `limpiarDescripcion` |
| `api/admin/[...slug].js` (modificar) | Registrar la ruta `describe-car` |
| `vercel.json` (modificar) | Subir `maxDuration` del dispatcher admin a 60 s |
| `src/admin/DescriptionEsField.jsx` (crear) | Textarea ES + contador + botón «Generar con IA» |
| `src/admin/AddCarPanel.jsx` (modificar) | Usar el componente nuevo |
| `src/admin/EditCarPanel.jsx` (modificar) | Usar el componente nuevo |

---

### Task 1: Helper `limpiarDescripcion` (TDD)

El único trozo de lógica pura del handler: normaliza lo que devuelve el modelo y garantiza que nunca supera los 600 caracteres que acepta la columna, sin cortar a mitad de una palabra.

**Files:**
- Create: `lib/admin-handlers/describe-car.js`
- Test: `lib/admin-handlers/describe-car.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/admin-handlers/describe-car.test.js`:

```js
import { describe, it, expect } from "vitest";
import { limpiarDescripcion, MAX_DESCRIPTION_LEN } from "./describe-car.js";

describe("limpiarDescripcion", () => {
  it("devuelve cadena vacía si no le llega texto", () => {
    expect(limpiarDescripcion(null)).toBe("");
    expect(limpiarDescripcion(undefined)).toBe("");
    expect(limpiarDescripcion(42)).toBe("");
    expect(limpiarDescripcion("   ")).toBe("");
  });

  it("colapsa saltos de línea y espacios repetidos", () => {
    expect(limpiarDescripcion("  El Delta\n\n  ganó  seis   Mundiales. ")).toBe(
      "El Delta ganó seis Mundiales."
    );
  });

  it("deja intacto un texto que ya cabe", () => {
    const texto = "Un compacto que ganó seis Mundiales seguidos.";
    expect(limpiarDescripcion(texto)).toBe(texto);
  });

  it("recorta a 600 sin partir una palabra por la mitad", () => {
    // 700 caracteres en palabras de 4 ("aaa ") → el corte cae dentro de una palabra
    const largo = "aaa ".repeat(175);
    const salida = limpiarDescripcion(largo);
    expect(salida.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LEN);
    expect(salida.endsWith("aaa")).toBe(true);
  });

  it("no deja puntuación ni espacios colgando tras el recorte", () => {
    const largo = `${"palabra ".repeat(80)}, y algo más`;
    const salida = limpiarDescripcion(largo);
    expect(salida).not.toMatch(/[\s,;:]$/);
  });
});
```

- [ ] **Step 2: Ejecutar el test y ver que falla**

Run: `npx vitest run lib/admin-handlers/describe-car.test.js`
Expected: FAIL — el fichero `describe-car.js` no existe todavía.

- [ ] **Step 3: Implementación mínima**

Crear `lib/admin-handlers/describe-car.js` con solo el helper (el handler llega en la Task 2):

```js
// lib/admin-handlers/describe-car.js
// Genera la descripción en español de un coche para el panel admin.
// (El handler se añade en la Task 2 de este plan.)

// Tope de la columna `cars.description` y del textarea del admin. Si el modelo
// se pasa, recortamos aquí en vez de dejar que Postgres o el maxLength del
// textarea corten a mitad de palabra.
export const MAX_DESCRIPTION_LEN = 600;

// Normaliza lo que devuelve el modelo: los saltos de línea de un párrafo
// generado se ven fatal en el textarea de una línea larga, y el recorte a pelo
// (`slice`) partiría la última palabra.
export function limpiarDescripcion(texto) {
  if (typeof texto !== "string") return "";

  const normalizado = texto.replace(/\s+/g, " ").trim();
  if (normalizado.length <= MAX_DESCRIPTION_LEN) return normalizado;

  const recortado = normalizado.slice(0, MAX_DESCRIPTION_LEN);
  const ultimoEspacio = recortado.lastIndexOf(" ");
  // Si no hay espacios (texto anómalo de una sola palabra kilométrica) nos
  // quedamos con el corte duro: mejor eso que devolver vacío.
  const porPalabra = ultimoEspacio > 0 ? recortado.slice(0, ultimoEspacio) : recortado;

  // Un texto que acaba en coma o dos puntos delata el corte; lo limpiamos.
  return porPalabra.replace(/[\s,;:.\-–—]+$/, "");
}
```

- [ ] **Step 4: Ejecutar el test y ver que pasa**

Run: `npx vitest run lib/admin-handlers/describe-car.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/admin-handlers/describe-car.js lib/admin-handlers/describe-car.test.js
git commit -m "feat(admin): helper que normaliza y recorta la descripción generada"
```

---

### Task 2: El handler `describe-car`

**Files:**
- Modify: `lib/admin-handlers/describe-car.js` (añadir al final, debajo del helper)

- [ ] **Step 1: Añadir los imports al principio del fichero**

Sustituir la cabecera de comentarios creada en la Task 1 por esto, dejando `MAX_DESCRIPTION_LEN` y `limpiarDescripcion` como están debajo:

```js
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
```

- [ ] **Step 2: Añadir la herramienta de entrega y el prompt (debajo del helper)**

```js
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
          "La descripción en español, en un solo párrafo, sin titular ni comillas.",
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
  `LONGITUD: unos ${MAX_DESCRIPTION_LEN} caracteres. Nunca los superes.`,
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
```

- [ ] **Step 3: Añadir el handler al final del fichero**

```js
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
```

- [ ] **Step 4: Verificar que los tests del helper siguen pasando**

Run: `npx vitest run lib/admin-handlers/describe-car.test.js`
Expected: PASS — 5 tests. (Añadir el handler no debe romper el helper.)

- [ ] **Step 5: Commit**

```bash
git add lib/admin-handlers/describe-car.js
git commit -m "feat(admin): endpoint que redacta la descripción con Sonnet 5 y búsqueda web"
```

---

### Task 3: Registrar la ruta y subir el `maxDuration`

Sin lo segundo la feature falla por timeout: el dispatcher admin no tiene entrada en `functions`, así que hereda el default de Hobby (10 s) y la búsqueda web se lo pasa.

**Files:**
- Modify: `api/admin/[...slug].js:35-45`
- Modify: `vercel.json:9-18`

- [ ] **Step 1: Registrar el handler en el dispatcher**

En `api/admin/[...slug].js`, añadir el import debajo del de `analyzeImage` (línea 35):

```js
import analyzeImage from "../../lib/admin-handlers/analyze-image.js";
import describeCar from "../../lib/admin-handlers/describe-car.js";
```

Y la entrada en `ROUTES`:

```js
const ROUTES = {
  "analytics":     analytics,
  "audit":         audit,
  "save-car":      saveCar,
  "schedule":      schedule,
  "seasons":       seasons,
  "translate":     translate,
  "analyze-image": analyzeImage,
  "describe-car":  describeCar,
};
```

- [ ] **Step 2: Subir el `maxDuration` del dispatcher**

En `vercel.json`, dentro de `"functions"`, añadir la entrada nueva junto a las dos que ya hay:

```json
  "functions": {
    "api/admin/[...slug].js": {
      "maxDuration": 60
    },
    "api/daily-image.js": {
      "memory": 1769,
      "maxDuration": 15
    },
    "api/og-image.js": {
      "memory": 1769,
      "maxDuration": 15
    }
  },
```

Sin `memory`: los endpoints admin no procesan imágenes y el default les vale. `maxDuration` es un techo, no un coste — el resto de rutas admin siguen respondiendo en lo que tarden.

- [ ] **Step 3: Verificar que el JSON sigue siendo válido**

Run: `node -e "console.log(Object.keys(require('./vercel.json').functions))"`
Expected: `[ 'api/admin/[...slug].js', 'api/daily-image.js', 'api/og-image.js' ]`

- [ ] **Step 4: Commit**

```bash
git add api/admin/\[...slug\].js vercel.json
git commit -m "feat(admin): enrutar describe-car y dar 60s al dispatcher para la búsqueda web"
```

---

### Task 4: Componente `DescriptionEsField`

Gemelo del `DescriptionEnField` que ya existe: mismo layout, mismo contador, botón en el mismo sitio.

**Files:**
- Create: `src/admin/DescriptionEsField.jsx`

- [ ] **Step 1: Crear el componente**

```jsx
// src/admin/DescriptionEsField.jsx
// Gemelo de DescriptionEnField para la descripción en español: textarea con
// botón "Generar con IA" que llama a /api/admin/describe-car (Claude Sonnet 5
// con búsqueda web). El admin siempre puede editar el resultado antes de
// guardar — el botón rellena el formulario, no guarda nada.
//
// Vive aparte (y no inline en cada panel) porque AddCarPanel y EditCarPanel
// nombran sus campos distinto (make/model/year vs marca/modelo/anio): el
// componente unifica esa diferencia en una sola interfaz.
//
// Props:
//   value        string · descripción ES actual (controlada por el padre)
//   onChange(v)  fn     · setter del padre al editar / tras generar
//   marca        string · identidad del coche para el prompt
//   modelo       string ·
//   anio         string|number · opcional
//   pais         string · opcional
//   disabled     bool   · estado de submitting del padre
//   inputClass   string · clases del textarea, consistentes con el resto del form

import { useState } from "react";
import { supabase } from "../supabaseClient";

const MAX_LEN = 600;

export default function DescriptionEsField({
  value,
  onChange,
  marca,
  modelo,
  anio,
  pais,
  disabled = false,
  inputClass = "",
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // Sin marca y modelo el endpoint responde 400: mejor no dejar pulsar.
  const tieneIdentidad = marca.trim().length > 0 && modelo.trim().length > 0;
  const canGenerate = tieneIdentidad && !generating && !disabled;

  async function handleGenerate() {
    setError("");
    if (!canGenerate) return;

    // Un clic accidental no debe borrar algo escrito a mano.
    if (value.trim() && !window.confirm("Se reemplazará la descripción actual. ¿Seguir?")) {
      return;
    }

    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sesión perdida. Vuelve a iniciar sesión.");

      const res = await fetch("/api/admin/describe-car", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ marca, modelo, anio, pais }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      }
      if (typeof body.descripcion !== "string" || !body.descripcion) {
        throw new Error("Respuesta vacía de la IA.");
      }
      onChange(body.descripcion);
    } catch (err) {
      console.error("[DescriptionEsField] generate:", err);
      setError(err?.message || "Error generando la descripción.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Un párrafo corto sobre el coche: anécdotas, datos curiosos, contexto histórico..."
        maxLength={MAX_LEN}
        rows={4}
        disabled={disabled}
        className={`${inputClass} h-auto resize-y py-3 leading-relaxed`}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          {value.length} / {MAX_LEN}
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          title={
            tieneIdentidad
              ? "Redacta la descripción documentándose en la web"
              : "Rellena marca y modelo primero"
          }
          className="
            rounded-md border border-accent/40 bg-accent/10
            px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent
            transition hover:border-accent hover:bg-accent/20
            disabled:cursor-not-allowed disabled:opacity-40
          "
        >
          {generating ? "Buscando y redactando..." : "Generar con IA"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: build correcto (el componente aún no lo usa nadie, pero un error de sintaxis saldría aquí).

- [ ] **Step 3: Commit**

```bash
git add src/admin/DescriptionEsField.jsx
git commit -m "feat(admin): campo de descripción ES con botón de generación por IA"
```

---

### Task 5: Enchufarlo en AddCarPanel

**Files:**
- Modify: `src/admin/AddCarPanel.jsx:12` (import) y `:413-435` (el Field de descripción)

- [ ] **Step 1: Añadir el import**

Junto al de `DescriptionEnField` (línea 12):

```jsx
import DescriptionEnField from "./DescriptionEnField";
import DescriptionEsField from "./DescriptionEsField";
```

- [ ] **Step 2: Sustituir el textarea por el componente**

Reemplazar el bloque completo del `<Field label={...Descripción (ES)...}>` (el `<textarea>` y el `<span>` del contador que van dentro) por:

```jsx
        <Field
          label={
            <>
              Descripción (ES)
              <span className="ml-2 normal-case tracking-normal text-muted">
                · opcional
              </span>
            </>
          }
        >
          <DescriptionEsField
            value={form.description}
            onChange={(v) => updateField("description", v)}
            marca={form.make}
            modelo={form.model}
            anio={form.year}
            pais={form.pais}
            disabled={isSubmitting}
            inputClass={inputClass}
          />
        </Field>
```

El contador de caracteres desaparece de aquí porque ahora lo pinta el componente, igual que hace `DescriptionEnField`.

- [ ] **Step 3: Verificar el build**

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 4: Commit**

```bash
git add src/admin/AddCarPanel.jsx
git commit -m "feat(admin): generación por IA en el alta de coches"
```

---

### Task 6: Enchufarlo en EditCarPanel

Este panel nombra los campos en español (`marca`/`modelo`/`anio`) y llevaba el contador dentro de la etiqueta, no debajo — hay que quitarlo de ahí.

**Files:**
- Modify: `src/admin/EditCarPanel.jsx:14` (import) y `:680-699` (el Field de descripción)

- [ ] **Step 1: Añadir el import**

Junto al de `DescriptionEnField` (línea 14):

```jsx
import DescriptionEnField from "./DescriptionEnField";
import DescriptionEsField from "./DescriptionEsField";
```

- [ ] **Step 2: Sustituir el textarea por el componente**

Reemplazar el bloque completo del `<Field>` de «Descripción (ES)» (líneas 680-699) por:

```jsx
            <Field label="Descripción (ES)">
              <DescriptionEsField
                value={form.description}
                onChange={(v) => updateField("description", v)}
                marca={form.marca}
                modelo={form.modelo}
                anio={form.anio}
                pais={form.pais}
                disabled={isSubmitting}
                inputClass={inputClass}
              />
            </Field>
```

El `· {form.description.length} / 600` de la etiqueta se va: el contador lo pinta ahora el componente, debajo, como en el campo EN.

- [ ] **Step 3: Verificar el build**

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 4: Commit**

```bash
git add src/admin/EditCarPanel.jsx
git commit -m "feat(admin): generación por IA en la edición de coches"
```

---

### Task 7: Verificación completa y PR

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS, incluidos `test:estetica` (de cuyas reglas `src/admin/` está exento) y el test nuevo del helper.

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 3: Suites de seguridad**

Run: `npm run test:security`
Expected: PASS. No hemos tocado RLS ni columnas, pero el endpoint nuevo es admin-only y conviene confirmar que la whitelist sigue en pie.

- [ ] **Step 4: Push y PR**

```bash
git push -u origin claude/admin-auto-fill-descriptions-ai-3aad90
gh pr create --base main \
  --title "feat(admin): autorrellenar descripciones con IA" \
  --body "$(cat <<'EOF'
Botón «Generar con IA» en el campo Descripción (ES) del alta y la edición de
coches. Sustituye el flujo manual de pedírselo a un chat aparte y pegar.

Claude Sonnet 5 (~2 céntimos por coche) que **busca en la web antes de
redactar**: estas descripciones se le muestran al jugador como verdad al ganar,
y un modelo tirando de memoria inventa años y cifras en coches poco conocidos.
Si un dato no lo confirma, lo omite. Nada se guarda solo: el texto queda en el
formulario y sigues pulsando Guardar.

Dos cosas no evidentes del cambio:

- **`tool_choice` va en automático, no forzado.** `analyze-image.js` sí lo
  fuerza para garantizar la salida estructurada, pero aquí eso impediría buscar
  antes de responder. Como la estructura deja de estar garantizada, el handler
  lleva plan B leyendo los bloques de texto.
- **`maxDuration` del dispatcher admin a 60 s.** No tenía entrada en
  `vercel.json`, así que heredaba los 10 s de Hobby y la búsqueda web se los
  pasaba. Sin esto la feature fallaría por timeout con todo lo demás correcto.

Requiere `ANTHROPIC_API_KEY` en las envs (ya está por `analyze-image`). Si
faltara, el panel dice «no configurada» en vez de romper.

Diseño: `docs/superpowers/specs/2026-07-31-autorrellenar-descripciones-ia-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notas para quien ejecute

- **No tocar `DescriptionEnField.jsx`.** El inglés sigue traduciéndose con DeepL; se decidió expresamente no generarlo con IA.
- **No añadir el `GRANT` de nada.** Este cambio no toca columnas de `public.cars` (regla 3 de CLAUDE.md).
- **Comentarios en español explicando el porqué** en todo lo nuevo, como el resto del repo (regla 10).
- **Nada de emoji ni paleta cruda** en el JSX — aunque `src/admin/` esté exento de `test:estetica`, el componente usa los tokens del tema (`accent`, `muted`) como sus vecinos.
