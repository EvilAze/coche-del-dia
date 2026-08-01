// api/_lib/og-card.js
// Composición de la tarjeta Open Graph (1200×630) del «Prensa del motor».
//
// Dos consumidores:
//   · api/og-image.js               → la tarjeta VIVA, con el recorte del coche de hoy.
//   · scripts/generate-og-image.mjs → la capa fija pre-renderizada y el respaldo
//                                     estático (public/og-image.jpg).
// Una sola composición: si algún día se rediseña la tarjeta, no hay dos sitios
// que puedan divergir.
//
// POR QUÉ 1200×630
//   - Facebook / WhatsApp piden mínimo 1200×630. Por debajo se ve chico y
//     pixelado.
//   - Twitter (X) usa 1200×600 para summary_large_image; recorta este sin
//     pérdida visible.
//   - LinkedIn / Discord / Telegram usan el mismo estándar.
//
// EL DISEÑO
//   - Papel #f3eee1 a sangre, tinta #1b1712, un solo acento rojo #b3271b.
//     Mismos tokens que src/index.css: el preview compartido y la portada real
//     tienen que ser reconociblemente la misma publicación.
//   - Composición a dos cuerpos: masthead a la izquierda, foto A SANGRE a la
//     derecha — el mismo gesto que la portada del juego.
//   - La foto va en DUOTONO sobre papel, no a color: una foto a todo color
//     sobre crema canta a plantilla; el duotono la integra como un fotograbado
//     de periódico.
//   - Filetes dobles arriba y bajo el wordmark: el motif de .prensa-folio.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ EL TEXTO NO SE DIBUJA EN TIEMPO DE EJECUCIÓN
//
// La primera versión del endpoint componía el SVG con texto y lo rasterizaba en
// cada petición, igual que hacía el script. En producción salió TOFU: los
// filetes perfectos (son <rect>) y todas las letras convertidas en cajitas.
//
// El motivo: el runtime serverless de Vercel no trae fuentes. El comentario
// original decía que la pila «Georgia, DejaVu Serif» cubría «Windows/Mac y
// Linux/Vercel», y era cierto para el ENTORNO DE BUILD —el JPEG estático se
// generaba en la máquina del desarrollador y se commiteaba ya rasterizado— pero
// no para el servidor, donde nunca se había ejecutado nada de esto.
//
// La solución no es adivinar qué fuente habrá instalada (que es el mismo error
// repetido) ni empaquetar fontconfig: es que en el servidor NO SE DIBUJE TEXTO.
// Toda la parte fija de la tarjeta —wordmark, filetes, lema, dominio— se
// pre-renderiza a un PNG con transparencia en `npm run og:build`, que corre en
// una máquina con fuentes de verdad, y se versiona. El endpoint solo pega la
// foto detrás de esa capa.
//
// Efectos secundarios, todos buenos: se elimina la rasterización de SVG del
// camino caliente (más rápido y menos memoria), y la tarjeta no puede volver a
// romperse por el entorno. El coste es que la tarjeta ya no admite texto
// variable — la fecha del antetítulo se retiró por esto. Merece la pena: el
// gancho de la tarjeta es el coche, no la fecha.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from "sharp";
// Import de NAMESPACE y no de named exports a propósito. og-overlay.js lo
// genera el propio script que importa este módulo, así que añadir un export
// nuevo creaba un huevo-y-gallina: el generador no arrancaba porque la capa
// vieja aún no lo exportaba. Con el namespace, un export que falte es
// `undefined` en vez de un error de módulo — el generador corre, reescribe la
// capa, y de paso la tarjeta degrada sola si algún día se despliega con una
// capa desfasada (sale sin marcador en vez de romper).
import * as capa from "./og-overlay.js";

const OVERLAY_PNG_BASE64 = capa.OVERLAY_PNG_BASE64;
const MARCADORES_BASE64 = capa.MARCADORES_BASE64 ?? {};

export const W = 1200;
export const H = 630;

// Paleta = tokens del tema día (src/index.css). No inventar hex aquí.
const PAPEL = "#f3eee1";
const TINTA = "#1b1712";
const TINTA2 = "#6e6553";
const ROJO = "#b3271b";

// Reparto horizontal: la foto ocupa el tercio derecho a sangre; el masthead
// respira en los 760px restantes. El filete vertical los separa.
const FOTO_X = 760;
const FOTO_W = W - FOTO_X;
const MARGEN = 64;

// Pilas tipográficas para el PRE-RENDER. Solo las usa el generador, que corre
// en una máquina con fuentes de verdad; nunca el servidor. Explícitas y no el
// genérico `serif`: en bold, el genérico caía en una monoespaciada (el wordmark
// salía tipo terminal) porque librsvg resuelve `serif` por fontconfig. NO se
// referencian 'Fraunces' ni 'Libre Franklin' (las reales del sitio): no están
// instaladas en ningún entorno de build, y el fallback silencioso da peor
// resultado que elegir la sustituta a sabiendas.
const SERIF = "Georgia, 'DejaVu Serif', 'Times New Roman', serif";
const SANS = "Arial, 'DejaVu Sans', Helvetica, sans-serif";

/**
 * El SVG de la capa fija: papel del lado del texto + tipografía + filetes, con
 * el hueco de la foto TRANSPARENTE.
 *
 * Solo lo usa scripts/generate-og-image.mjs para pre-renderizar el PNG. En el
 * servidor no se llama nunca — ahí no hay fuentes (ver la nota de cabecera).
 */
export function construirOverlaySvg() {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Papel SOLO en el lado del texto. El tercio derecho queda transparente
       para que la foto asome por debajo al componer. -->
  <rect x="0" y="0" width="${FOTO_X}" height="${H}" fill="${PAPEL}"/>

  <!-- Filete doble superior (motif de .prensa-folio: 3px double). -->
  <rect x="${MARGEN}" y="86" width="${FOTO_X - MARGEN * 2}" height="3" fill="${TINTA}"/>
  <rect x="${MARGEN}" y="93" width="${FOTO_X - MARGEN * 2}" height="1" fill="${TINTA}"/>

  <!-- Antetítulo: el folio de la edición, en rojo como .prensa-folio .rojo.
       Genérico y no la fecha del día: la capa es fija (ver cabecera). -->
  <text x="${MARGEN}" y="134"
        font-family="${SANS}" font-size="19" font-weight="700"
        fill="${ROJO}" letter-spacing="7">EDICIÓN DIARIA</text>
  <text x="${FOTO_X - MARGEN}" y="134"
        font-family="${SANS}" font-size="19" font-weight="400"
        fill="${TINTA2}" letter-spacing="4" text-anchor="end">cochedeldia.com</text>

  <!-- Wordmark a dos líneas: más masthead que una línea larga y chica, y deja
       el titular al mismo peso visual que la foto de al lado. -->
  <text x="${MARGEN}" y="298"
        font-family="${SERIF}" font-size="92" font-weight="700"
        fill="${TINTA}" letter-spacing="-1">El Coche</text>
  <text x="${MARGEN}" y="392"
        font-family="${SERIF}" font-size="92" font-weight="700"
        fill="${TINTA}" letter-spacing="-1">del Día</text>

  <!-- Filete doble rojo bajo el wordmark: el único acento de color del lado
       del texto, y el que amarra el bloque tipográfico. -->
  <rect x="${MARGEN}" y="432" width="${FOTO_X - MARGEN * 2}" height="3" fill="${ROJO}"/>
  <rect x="${MARGEN}" y="439" width="${FOTO_X - MARGEN * 2}" height="1" fill="${ROJO}"/>

  <!-- Lema en cursiva serif: la misma voz de .prensa-masthead .lema -->
  <text x="${MARGEN}" y="486"
        font-family="${SERIF}" font-size="27" font-style="italic"
        fill="${TINTA2}">Adivina marca, modelo y año en cinco intentos.</text>

  <!-- Filete vertical de separación: el corte entre el pliego y el grabado.
       Va en la capa de encima, así cae limpio sobre el borde de la foto. -->
  <rect x="${FOTO_X - 1}" y="0" width="2" height="${H}" fill="${TINTA}" fill-opacity="0.35"/>
</svg>`;
}

// Fotograbado: la foto en duotono cálido. grayscale() quita el color, linear()
// abre el contraste Y BAJA el punto blanco (el desplazamiento negativo): sin
// eso, un coche claro sobre cielo claro se quemaba contra el crema y la foto se
// leía como una mancha pálida. tint() la reencaja en la gama del papel. El
// orden importa: tint sobre una imagen aún en color daría un viraje sucio.
//
// (Es el knob más fácil de girar si algún día se decide que en un chat
// concurrido pesa más el impacto que la coherencia: quitando estas tres
// llamadas la foto sale a color.)
async function procesarFoto(entrada) {
  return sharp(entrada)
    .resize(FOTO_W, H, { fit: "cover", position: "center" })
    .grayscale()
    .linear(1.26, -42)
    .tint({ r: 226, g: 214, b: 190 })
    .toBuffer();
}

// ── LA REJILLA DEL RESULTADO ────────────────────────────────────────────────
// Va en el hueco de papel que queda entre el wordmark y la foto (x 500-730),
// que hasta ahora estaba vacío. Tres columnas —marca, modelo, año— y una fila
// por intento.
//
// SE DIBUJA CON FORMAS, NO CON LETRAS, y no es casualidad: es lo único de la
// tarjeta que cambia por jugador, así que es lo único que hay que rasterizar en
// el servidor... donde no hay fuentes (ver la nota de cabecera). Círculos y
// aros no dependen de ninguna, así que la parte dinámica es inmune al fallo que
// nos dejó la tarjeta llena de cajitas.
//
// Y no hace falta escribir "3/5" en ninguna parte: el número de filas ES el
// marcador. Un disco relleno es acierto; un aro vacío, fallo. Monocromo en
// tinta y no verde/rojo como en el juego, porque la paleta del periódico no
// tiene verde y meterlo aquí solo para esto rompería la portada.
// EL MARCADOR MANDA, LA REJILLA ACOMPAÑA.
//
// La primera versión enseñaba SOLO los discos, confiando en que el número de
// filas se leyera como marcador. No se lee: una partida resuelta a la primera
// es una única fila de tres discos y en un chat parece unos puntos suspensivos.
// Lo comprobó en carne propia el autor del juego, que al ver su propia tarjeta
// dijo «no se ve el resultado dinámico» — si no lo descifra quien lo programó,
// no lo descifra nadie.
//
// Así que el "1/5" va con tipografía de verdad y en grande, que además es lo
// único legible cuando la tarjeta se ve del tamaño de un sello en el móvil, y
// la rejilla queda debajo como detalle para quien se acerque.
//
// El marcador son SEIS variantes fijas (1/5…5/5 y X/5), pre-renderizadas junto
// a la capa base por la misma razón que ella: en el servidor no hay fuentes.
// Seis PNG diminutos pesan nada y evitan volver a dibujar texto en producción.
// Métrica del bloque, ajustada para que quepa ENTERO entre el folio (y≈150) y
// el filete rojo del lema (y=432) incluso con cinco intentos, y para que el
// marcador no pise la primera fila de discos — que es lo que pasaba con la
// primera métrica: el "1/5" bajaba hasta y=322 y los discos empezaban en 321.
// Con cinco filas, el último centro cae en 412 y el borde inferior en 420.
//
// Marcador y rejilla comparten EJE VERTICAL (x=640) para que el bloque se lea
// como una sola pieza. El marcador va centrado por text-anchor y no por
// posición calculada, así "X/5" y "1/5" quedan alineados aunque midan distinto.
const EJE_X = 640;
const CELDA = 28;
const RADIO = 8;
const REJILLA_X = EJE_X - CELDA; // centro de la primera columna
const REJILLA_Y0 = 300; // centro de la primera fila
const MARCADOR_W = 220;
const MARCADOR_X = EJE_X - MARCADOR_W / 2;
const MARCADOR_Y = 208;

function dibujarRejilla(intentos) {
  if (!intentos?.length) return null;
  const marcas = intentos
    .map((fila, f) =>
      [fila.marca, fila.modelo, fila.anio]
        .map((ok, c) => {
          const cx = REJILLA_X + c * CELDA;
          const cy = REJILLA_Y0 + f * CELDA;
          return ok
            ? `<circle cx="${cx}" cy="${cy}" r="${RADIO}" fill="${TINTA}"/>`
            : `<circle cx="${cx}" cy="${cy}" r="${RADIO - 1}" fill="none" stroke="${TINTA}" stroke-opacity="0.28" stroke-width="2"/>`;
        })
        .join("")
    )
    .join("");
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${marcas}</svg>`
  );
}

/**
 * Clave del marcador para una partida: "1".."5" si se resolvió, "X" si no.
 * Ganar = el último intento con las tres celdas acertadas, misma definición que
 * usa buildShareText para su "N/5".
 */
function claveMarcador(intentos) {
  if (!intentos?.length) return null;
  const ultimo = intentos[intentos.length - 1];
  const gano = ultimo.marca && ultimo.modelo && ultimo.anio;
  return gano ? String(intentos.length) : "X";
}

/** El SVG de UN marcador, para pre-renderizar. Solo lo usa el generador. */
export function construirMarcadorSvg(clave) {
  return `<svg width="${MARCADOR_W}" height="76" xmlns="http://www.w3.org/2000/svg">
  <text x="${MARCADOR_W / 2}" y="58" text-anchor="middle"
        font-family="${SERIF}" font-size="56" font-weight="700"
        fill="${TINTA}" letter-spacing="-1">${clave}/5</text>
</svg>`;
}

/** Las seis claves posibles. El generador itera sobre esto. */
export const CLAVES_MARCADOR = ["1", "2", "3", "4", "5", "X"];

/**
 * Compone la tarjeta completa: foto del día debajo, capa fija encima y —si se
 * comparte una partida concreta— su rejilla.
 *
 * El texto llega ya en píxeles desde la capa pre-renderizada; lo único que se
 * rasteriza aquí son círculos. Por eso esto funciona igual en el servidor que
 * en tu portátil.
 *
 * @param {Buffer|string} foto  Bytes de la imagen (o ruta, para el script).
 * @param {object} [opciones]
 * @param {Array}  [opciones.intentos]  Partida decodificada (result-code.js).
 *   Sin ella, la tarjeta sale genérica — que es lo que quiere quien llega a la
 *   home sin venir del enlace de nadie.
 * @returns {Promise<Buffer>} JPEG 1200×630.
 */
export async function componerTarjetaOG(foto, { intentos = null } = {}) {
  // 1) Papel a sangre como base. La capa fija ya trae su propio papel en el
  //    lado del texto; este lienzo cubre el caso de que la foto no llene su
  //    tercio por completo (no debería, va con fit:"cover", pero un lienzo de
  //    color plano cuesta nada y evita un borde negro si algo cambia).
  const papel = await sharp({
    create: { width: W, height: H, channels: 3, background: PAPEL },
  })
    .png()
    .toBuffer();

  const grabado = await procesarFoto(foto);
  const capaFija = Buffer.from(OVERLAY_PNG_BASE64, "base64");
  const rejilla = dibujarRejilla(intentos);
  // El marcador puede faltar si la capa se generó con una versión anterior del
  // script: en ese caso sale la rejilla sola, que es la degradación buena.
  const clave = claveMarcador(intentos);
  const marcador = clave && MARCADORES_BASE64?.[clave];

  // 2) Foto primero, capa fija después (su filete vertical remata el borde del
  //    grabado) y el resultado al final, sobre el papel ya pintado.
  const capas = [
    { input: grabado, top: 0, left: FOTO_X },
    { input: capaFija, top: 0, left: 0 },
  ];
  if (marcador) {
    capas.push({
      input: Buffer.from(marcador, "base64"),
      top: MARCADOR_Y,
      left: MARCADOR_X,
    });
  }
  if (rejilla) capas.push({ input: rejilla, top: 0, left: 0 });

  return sharp(papel)
    .composite(capas)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
