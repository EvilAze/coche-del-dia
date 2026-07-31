# Autorrellenar descripciones con IA en el panel admin

**Fecha:** 2026-07-31
**Estado:** diseño aprobado, pendiente de implementar

## Problema

Dar de alta un coche exige escribir a mano la descripción en español que el jugador
ve al ganar. El flujo actual es salir del panel, pedirle a Gemini «dame una
descripción de aproximadamente 600 caracteres para X coche», copiar y pegar. Es un
paso manual en un formulario que ya está en pantalla.

## Objetivo

Un botón en el campo «Descripción (ES)» que genere el texto sin salir del panel.
El resultado siempre es editable y **no se guarda solo**: sigue haciendo falta pulsar
Guardar. Human-in-the-loop, igual que el análisis de imagen del DDA.

## Fuera de alcance

- **El inglés no cambia.** `DescriptionEnField` sigue traduciendo desde ES con DeepL.
  Se decidió no generar ES+EN en una sola llamada: el flujo de dos clics ya funciona
  y no justifica tocar lo que no está roto.
- No se genera nada en lote ni automáticamente al importar coches.
- No se escribe en `public.cars` desde este endpoint.

## Decisiones de diseño

### Voz del texto: hechos + anécdota

Se descartaron «ficha técnica» (fría como recompensa por ganar) y «columna de prensa
con opinión» (con la misma cadencia literaria 365 días al año, cansa, y es donde más
se nota si la IA se pone grandilocuente). La voz elegida es sobria y concreta: por qué
existe el coche, qué hizo, algún dato que sorprenda — que es justo lo que promete el
placeholder actual del campo.

### Exactitud: búsqueda web antes de escribir

Estas descripciones se muestran al jugador como verdad. El modelo busca en la web antes
de redactar en lugar de tirar de memoria, lo que reduce mucho el invento en coches raros
o poco conocidos. Cuesta unos segundos más por generación. El admin sigue revisando
antes de guardar, así que la red de seguridad es doble.

Regla dura en el prompt: **si un dato no aparece, se omite; no se rellena a ojo.**

### `tool_choice` NO puede ir forzado

`analyze-image.js` fuerza la herramienta (`tool_choice: {type:"tool"}`) para garantizar
salida estructurada. **Aquí no se puede copiar ese patrón**: forzar la herramienta obliga
al modelo a responder de inmediato, sin poder buscar antes. Por tanto `tool_choice` va en
automático y el prompt le indica el orden: buscar primero, después llamar a
`reportar_descripcion`.

Consecuencia: la salida estructurada deja de estar garantizada por la API. El handler
lleva un plan B — si no llega bloque `tool_use`, concatena los bloques de texto. Así
nunca devuelve vacío.

### Modelo: Claude Sonnet 5

Opus 4.8 salía a ~5-8 céntimos por coche; Sonnet 5 ronda los 2 (menos aún hasta el
2026-08-31, que está con precio de lanzamiento). Para redactar 600 caracteres con
documentación previa, Sonnet 5 llega de sobra.

Dos particularidades de Sonnet 5 frente a los modelos que ya usamos:

- **El *thinking* adaptativo está activado por defecto** (en Opus hay que pedirlo
  explícitamente). Consume del mismo `max_tokens` que la respuesta.
- Por eso se fija `effort: "medium"` explícitamente en lugar de dejar el `high` por
  defecto: para este texto es de sobra y evita deliberación pagada de más.

### `maxDuration` del dispatcher admin

`api/admin/[...slug].js` no tiene entrada en `functions` de `vercel.json`, así que hereda
el default de Hobby (10 s). Una llamada con búsqueda web se pasa de ahí y devolvería
timeout. Hay que subirlo a 60 s. Es un techo, no un coste: los demás endpoints admin
siguen respondiendo en lo que tarden.

## Arquitectura

### Servidor — `lib/admin-handlers/describe-car.js`

Handler nuevo colgado del dispatcher que ya existe (`ROUTES["describe-car"]`), no una
función serverless propia: respeta el límite de 12 funciones de Hobby, igual que se hizo
con `analyze-image`.

```
POST /api/admin/describe-car
Body:     { marca, modelo, anio, pais? }
Respuesta: { descripcion, model }
```

- **Auth:** `requireAdmin` + `methodGuard("POST")`, idéntico al resto de admin. Sin esto
  cualquiera podría quemar la cuota de Claude desde DevTools.
- **Sin `ANTHROPIC_API_KEY` → 503** con mensaje claro; el panel lo muestra sin romper
  (regla 9: degradar en silencio).
- **Validación:** marca y modelo obligatorios (sin ellos el prompt no tiene sujeto).
- **Errores tipados de la SDK** → mensajes útiles para el admin, igual que `analyze-image`:
  `AuthenticationError` → clave inválida, `RateLimitError` → 429.
- **`pause_turn`:** Claude puede pausar el turno tras muchas rondas de búsqueda. Sin
  manejarlo, la respuesta llega cortada a mitad. Se reenvía una vez como máximo.

Helper puro exportado para poder testearlo aislado:

```js
limpiarDescripcion(texto) // trim, colapsa espacios, recorta a 600 sin partir palabra
```

### Cliente — `src/admin/DescriptionEsField.jsx`

Hoy la descripción ES es un `<textarea>` suelto duplicado en `AddCarPanel` y
`EditCarPanel`. Se extrae un componente **gemelo de `DescriptionEnField.jsx`** (mismo
layout, mismo contador, botón en el mismo sitio) y se usa en ambos paneles, para que los
dos campos queden simétricos y la lógica no se duplique.

```
Descripción (ES)  [                                    ]
                  [                                    ]
0 / 600                            [ Generar con IA ]

Description (EN)  [                                    ]
0 / 600                          [ Traducir desde ES ]
```

Props: `value`, `onChange(v)`, `marca`, `modelo`, `anio`, `pais`, `disabled`, `inputClass`.

Comportamiento:

- El botón se activa solo con **marca y modelo** rellenos.
- Si el campo ya tiene texto, pide confirmación antes de reemplazarlo — un clic
  accidental no borra algo escrito a mano.
- Estado de carga explícito (`Buscando y redactando…`): son varios segundos y un botón
  mudo parece colgado.
- Los errores se muestran en el propio campo, sin `alert`.

### Configuración

`vercel.json` → `functions["api/admin/[...slug].js"] = { maxDuration: 60 }`.

## Verificación

- `npm run build` y `npm test` (incluye `test:estetica`; `src/admin/` está exento de sus
  reglas por ser herramienta interna).
- Test unitario de `limpiarDescripcion`: recorte a 600, sin partir palabras, colapso de
  espacios, entradas vacías.
- El resto se comprueba en el Preview de Vercel. Requiere `ANTHROPIC_API_KEY` en las envs
  del entorno Preview — ya debería estar por `analyze-image`; si falta, el panel dirá
  «IA no configurada» en vez de romper.

## Riesgos asumidos

- **El modelo puede seguir equivocándose** pese a la búsqueda. Mitigación: revisión
  humana obligatoria (nada se guarda solo) y la instrucción de omitir lo que no encuentre.
- **Latencia de varios segundos.** Mitigación: estado de carga honesto y `maxDuration` a 60.
- **Coste por generación.** Acotado por la whitelist de admin y por ser una acción manual,
  un coche cada vez.
