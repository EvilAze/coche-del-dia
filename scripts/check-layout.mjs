#!/usr/bin/env node
// scripts/check-layout.mjs
// Banco de pruebas del PLIEGO SIN SCROLL de la app (el shell que monta
// `:root[data-plataforma="app"] .app-pantalla` en src/index.css).
//
// POR QUÉ EXISTE. Ninguna de las otras suites puede ver esto. `test:estetica`
// lee cadenas y clases, `test:unit` es lógica pura y el build solo comprueba que
// el CSS compila — un shell que se aplasta, una foto que se pinta encima del
// cupón o un pie cortado compilan perfectamente. Escribiendo esa regla se
// colaron DOS fallos que solo aparecieron al medir píxeles en un navegador:
//
//   · Con `min-height: 0` en la sección de la foto, la sección se aplastaba a
//     h=0 mientras el marco respetaba su suelo: la fotografía se pintaba ENCIMA
//     del cupón y el pie quedaba fuera de la ventana, sin scroll con el que
//     alcanzarlo.
//   · Sin declarar mínimo, el automático de un ítem flex es su min-content, que
//     con `aspect-ratio` ya es el alto natural: la sección no encogía nunca y no
//     había shell en ningún móvil.
//
// LO QUE ATA, y el primero es de SEGURIDAD, no de estética: el marco tiene que
// medir 4:3 EXACTO siempre. De esa proporción dependen el recorte que calcula el
// servidor y el lightbox (reglas 5 y 7 de CLAUDE.md); si se deforma,
// `object-fit: cover` enseña un trozo de coche distinto del que sirvió el
// servidor para ese intento — o sea, cambia la dificultad del día.
//
// LO QUE **NO** ATA, y conviene tenerlo presente: la cabecera y el cupón de este
// banco son maquetas con las clases reales pero contenido aproximado, así que
// las alturas absolutas no son las de producción al píxel. Lo que se verifica es
// el COMPORTAMIENTO del shell (proporción, solapes, alcanzabilidad, quién cede
// primero), no el presupuesto vertical exacto. El veredicto final sigue siendo
// el APK en un móvil.
//
// Corre contra el CSS **compilado** (build/assets/*.css), no contra el fuente:
// lo que importa es lo que llega al navegador después de Tailwind y del
// minificador, incluida la cascada entre las utilidades y las reglas propias
// —que es justo donde este proyecto ya se ha pegado más de una vez—. Sirve
// `build/` por HTTP en vez de abrir un file:// porque los @font-face llevan
// rutas absolutas (/fonts/…) y sin las fuentes reales las alturas de texto no
// son las de verdad.
//
// Uso:  npm run test:layout
// Fuera de `npm test` a propósito: necesita un build fresco y un Chromium, y no
// queremos que la suite de siempre dependa de tener navegador instalado.

import { createServer } from "node:http";
import { readFile, readdir, stat, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extname, join, dirname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(RAIZ, "build");

// ── El CSS compilado ───────────────────────────────────────────────────────
// Si falta, o si src/index.css es MÁS NUEVO que el build, reconstruimos: medir
// un CSS viejo es peor que no medir, porque da un verde que no significa nada.
async function cssCompilado() {
  async function buscar() {
    try {
      const assets = await readdir(join(BUILD, "assets"));
      const css = assets.filter((f) => f.endsWith(".css"));
      return css.length ? join(BUILD, "assets", css[0]) : null;
    } catch {
      return null;
    }
  }
  let ruta = await buscar();
  let motivo = null;
  if (!ruta) motivo = "no hay build/";
  else {
    const [fuente, salida] = await Promise.all([
      stat(join(RAIZ, "src", "index.css")),
      stat(ruta),
    ]);
    if (fuente.mtimeMs > salida.mtimeMs) motivo = "src/index.css es más nuevo que el build";
  }
  if (motivo) {
    console.log(`· ${motivo} → compilando (npm run build)…`);
    execFileSync("npm", ["run", "build"], { cwd: RAIZ, stdio: "ignore" });
    ruta = await buscar();
    if (!ruta) throw new Error("el build no ha dejado ningún CSS en build/assets/");
  }
  return ruta;
}

// ── El navegador ───────────────────────────────────────────────────────────
// playwright-core NO descarga navegadores (por eso es la dependencia ligera).
// Buscamos uno ya instalado en el orden que menos sorprende.
async function existe(p) {
  try { await access(p); return true; } catch { return false; }
}
async function abrirNavegador() {
  const candidatos = [];
  if (process.env.CDD_CHROMIUM) candidatos.push(process.env.CDD_CHROMIUM);
  // Cachés de Playwright (la variable la fijan los entornos de CI y los remotos).
  const cachés = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.HOME || "", ".cache", "ms-playwright"),
  ].filter(Boolean);
  for (const base of cachés) {
    let dirs = [];
    try { dirs = await readdir(base); } catch { continue; }
    for (const d of dirs.filter((x) => x.startsWith("chromium"))) {
      candidatos.push(
        join(base, d, "chrome-linux", "chrome"),
        join(base, d, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(base, d, "chrome-win", "chrome.exe"),
      );
    }
  }
  // Chrome del sistema, que es lo que casi todo el mundo tiene.
  candidatos.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  );
  for (const executablePath of candidatos) {
    if (await existe(executablePath)) {
      return { navegador: await chromium.launch({ executablePath }), executablePath };
    }
  }
  // Último intento: que Playwright resuelva un Chrome instalado por canal.
  try {
    return { navegador: await chromium.launch({ channel: "chrome" }), executablePath: "channel:chrome" };
  } catch {
    throw new Error(
      "no se ha encontrado ningún Chromium/Chrome.\n" +
      "  Instala uno o apunta a él con CDD_CHROMIUM=/ruta/al/binario"
    );
  }
}

// ── Las clases de las que depende el banco ─────────────────────────────────
// Anti-deriva: si alguien renombra una pieza del pliego, este script seguiría
// midiendo un DOM que ya no existe y daría verde midiendo nada. Comprobamos que
// cada selector crítico sigue apareciendo en el CSS compilado.
const SELECTORES = [
  ".app-pantalla", ".prensa-area-cab", ".prensa-area-foto", ".cdd-stage",
  ".cdd-stage-frame", ".prensa-area-jugar", ".prensa-historial",
  ".prensa-area-pie", ".prensa-cierre-enlaces",
  // El modo escritura: el cupón que se ancla al teclado, el desplegable que se
  // abre hacia arriba y el recorte que hace de fotografía.
  ".prensa-cupon", ".prensa-listbox", ".cdd-peek",
];

// ── La maqueta ─────────────────────────────────────────────────────────────
// Mismas clases que monta Configurator.jsx, en el mismo orden del DOM.
function paginaHtml(hrefCss) {
  return `<!doctype html>
<html lang="es" data-plataforma="app">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${hrefCss}"></head>
<body><div class="cdd-app prensa" style="--accent: var(--rojo)">
  <main class="prensa-hoja prensa-pliego flex min-h-screen flex-col gap-3 app-pantalla">
    <header class="prensa-area-cab">
      <nav class="prensa-topbar"><span>SUMARIO</span><span>CLASIFICACIÓN</span></nav>
      <div class="prensa-masthead prensa-masthead--compacto"><p class="titulo">Coche del Día</p></div>
      <div class="prensa-folio"><span>Jueves, 6 de agosto de 2026</span></div>
    </header>
    <section class="prensa-area-foto flex flex-col gap-3 pb-4">
      <div class="prensa-ladillo">La fotografía del día<span class="aparte">Pista 1 de 5</span></div>
      <div class="cdd-stage"><div class="cdd-stage-frame" id="marco">
        <div style="position:absolute;inset:0;background:#888"></div>
      </div></div>
    </section>
    <div class="prensa-area-jugar" id="jugar">
      <div class="prensa-cupon" id="cupon">
        <form class="flex flex-col gap-3">
          <div class="relative flex flex-col gap-0.5" id="campo-marca">
            <label class="prensa-label">Marca</label>
            <div class="prensa-campo"><input class="prensa-input" placeholder="Escribe o elige"></div>
            <ul class="prensa-listbox" id="listbox" role="listbox" hidden></ul>
          </div>
          <div class="relative flex flex-col gap-0.5">
            <label class="prensa-label">Modelo</label>
            <div class="prensa-campo"><input class="prensa-input" placeholder="Escribe o elige"></div>
          </div>
          <div class="relative flex flex-col gap-0.5">
            <label class="prensa-label">Año<span class="pista-label">±2</span></label>
            <div class="prensa-campo"><input class="prensa-input" placeholder="1998"></div>
          </div>
          <button class="prensa-submit mt-2" id="adivinar">ADIVINAR</button>
        </form>
      </div>
    </div>
    <div class="prensa-historial" id="historial"></div>
    <footer class="prensa-area-pie prensa-cierre py-6">
      <div id="reloj" class="text-xs font-bold uppercase text-tinta tabular-nums tracking-wider">
        <span class="text-rojo mr-2">CIERRE</span>05:47:12</div>
      <div class="prensa-cierre-enlaces flex justify-center items-center gap-x-3 text-xs text-muted font-bold uppercase">
        <button type="button">Cómo se juega</button><span>·</span><a href="/privacidad">Privacidad</a>
      </div>
    </footer>
  </main>
  <!-- El «recorte» de la foto. Fuera del <main> a propósito, igual que en
       Configurator: es fixed y no participa del reparto del pliego. -->
  <button class="cdd-peek" id="peek" hidden></button>
  </div>
<script>
  // El modo escritura: lo que en la app hacen lib/teclado.js (sellar el estado
  // cuando la ventana encoge de verdad) y Configurator (pedir el recorte). Aquí
  // se hacen a mano para poder medir la composición resultante; el banco ya
  // abre la página con la ventana encogida, que es la parte que importa.
  window.setTeclado = function (abierto) {
    if (abierto) document.documentElement.dataset.teclado = "abierto";
    else delete document.documentElement.dataset.teclado;
    document.getElementById("peek").hidden = !abierto;
  };
  window.setListbox = function (n) {
    const ul = document.getElementById("listbox");
    ul.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const li = document.createElement("li");
      li.className = "prensa-opt";
      li.setAttribute("role", "option");
      li.textContent = "Marca " + (i + 1);
      ul.appendChild(li);
    }
    ul.hidden = n === 0;
  };
  window.setIntentos = function (n) {
    const h = document.getElementById("historial");
    h.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const f = document.createElement("div");
      f.style.cssText = "min-height:34px;display:flex;align-items:center;gap:8px;" +
        "padding:6px 0;border-bottom:1px solid var(--line);font-size:12px";
      f.textContent = "Intento " + (i + 1) + " · Marca Modelo · 2011";
      h.appendChild(f);
    }
  };
  setIntentos(0);
</script></body></html>`;
}

// `corriente` = móvil de uso real. En esos EXIGIMOS cero scroll; por debajo
// aceptamos que el pliego se deslice, que es la degradación diseñada (antes
// eso que servir una foto por debajo del mínimo jugable).
const PANTALLAS = [
  { nombre: "iPhone SE / gama baja", w: 320, h: 568, corriente: false },
  // 360x640 estuvo marcado `corriente` mientras la maqueta del cupón eran DOS
  // inputs sueltos. El cupón de verdad son tres renglones con su etiqueta más
  // ADIVINAR —~276px, unos 90 más— y con esa medida un 640 no da para el shell:
  // se desliza ~89px. No es una regresión de nadie, es la maqueta poniéndose al
  // día. Aquí entra la degradación diseñada (la válvula), igual que en el 320.
  { nombre: "Android medio        ", w: 360, h: 640, corriente: false },
  { nombre: "Galaxy S23 Ultra     ", w: 384, h: 854, corriente: true },
  { nombre: "Pixel 7              ", w: 412, h: 915, corriente: true },
  { nombre: "Muy corto (patológico)", w: 360, h: 480, corriente: false },
];
const RATIO = 4 / 3;

async function main() {
  const rutaCss = await cssCompilado();
  const css = await readFile(rutaCss, "utf8");

  // Frontera de token, no subcadena: con `includes` a secas, renombrar
  // `.app-pantalla` → `.app-pantalla-x` seguía dando positivo (la vieja es
  // prefijo de la nueva) y el guardarraíl no servía para el caso que más lo
  // necesita, que es justo el renombrado.
  const ausentes = SELECTORES.filter(
    (s) => !new RegExp(s.replace(".", "\\.") + "(?![\\w-])").test(css)
  );
  if (ausentes.length) {
    console.error(
      `\n✖ El CSS compilado ya no contiene: ${ausentes.join(", ")}\n` +
      "  El banco estaría midiendo un DOM que no existe. Si has renombrado\n" +
      "  piezas del pliego, actualiza la maqueta de este script.\n"
    );
    process.exit(1);
  }

  // Servidor estático sobre build/: los @font-face llevan rutas absolutas.
  // `basename` y no `split("/")`: en Windows `join` devuelve barras INVERTIDAS,
  // así que el split no partía nada y el href salía como
  // "/assets/C:\...\index-abc.css" → 404 → el banco medía una página SIN CSS y
  // daba 40 fallos que no existían. Un banco que no puede correr en la máquina
  // desde la que se compila la app no es un banco.
  const hrefCss = "/assets/" + basename(rutaCss);
  const MIME = { ".css": "text/css", ".woff2": "font/woff2", ".js": "text/javascript",
                 ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = createServer(async (req, res) => {
    const ruta = decodeURIComponent(req.url.split("?")[0]);
    if (ruta === "/__layout.html") {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      return res.end(paginaHtml(hrefCss));
    }
    try {
      const buf = await readFile(join(BUILD, ruta));
      res.writeHead(200, { "Content-Type": MIME[extname(ruta)] || "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/__layout.html`;

  const { navegador, executablePath } = await abrirNavegador();
  console.log(`· CSS: ${relative(RAIZ, rutaCss)}`);
  console.log(`· Navegador: ${executablePath}\n`);

  let fallos = 0;
  const linea = (ok, txt) => { if (!ok) fallos++; console.log(`${ok ? "✓" : "✗"} ${txt}`); };

  for (const tema of ["dia", "noche"]) {
    for (const p of PANTALLAS) {
      for (const intentos of [0, 3, 5]) {
        const page = await navegador.newPage({ viewport: { width: p.w, height: p.h } });
        await page.goto(url, { waitUntil: "networkidle" });
        await page.evaluate((t) => { document.documentElement.dataset.tema = t; }, tema);
        await page.evaluate((n) => window.setIntentos(n), intentos);
        await page.waitForTimeout(50);

        const m = await page.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const marco = q(".cdd-stage-frame").getBoundingClientRect();
          const stage = q(".cdd-stage").getBoundingClientRect();
          const jugar = q(".prensa-area-jugar").getBoundingClientRect();
          const hoja = q(".app-pantalla");
          const pie = q(".prensa-area-pie");
          return {
            ratio: marco.width / marco.height,
            w: Math.round(marco.width), h: Math.round(marco.height),
            solapa: stage.bottom > jugar.top + 1,
            scrollPliego: hoja.scrollHeight - hoja.clientHeight,
            scrollDoc: document.documentElement.scrollHeight - window.innerHeight,
            pieAlcanzable: pie.offsetTop + pie.offsetHeight <= hoja.scrollHeight + 1,
          };
        });
        await page.close();

        const fallo = [];
        // 1) SEGURIDAD: el marco es 4:3 exacto (reglas 5 y 7).
        if (Math.abs(m.ratio - RATIO) > 0.01) fallo.push(`ratio ${m.ratio.toFixed(3)}≠1.333`);
        // 2) La foto nunca se pinta encima del cupón.
        if (m.solapa) fallo.push("la foto solapa el cupón");
        // 3) Nada queda inalcanzable.
        if (!m.pieAlcanzable) fallo.push("el pie no se alcanza ni con scroll");
        // 4) El DOCUMENTO nunca se desplaza: si algo cede, es el pliego. Es lo
        //    que evita el rebote elástico del WebView bajo el shell.
        if (m.scrollDoc > 1) fallo.push(`el documento scrollea ${m.scrollDoc}px`);
        // 5) En móviles corrientes, cero scroll. Es el requisito del shell.
        if (p.corriente && m.scrollPliego > 1) fallo.push(`scroll ${m.scrollPliego}px en móvil corriente`);

        linea(
          fallo.length === 0,
          `${tema}  ${p.nombre}  ${String(p.w).padStart(3)}x${p.h}  ${intentos} int · ` +
          `marco ${m.w}x${m.h} · pliego ${m.scrollPliego}px` +
          (fallo.length ? `   ← ${fallo.join(" · ")}` : "")
        );
      }
    }
  }

  // Control negativo: EN WEB nada de esto aplica. El requisito es explícito —
  // en web el scroll es correcto y el pie con sus enlaces tiene que verse.
  const page = await navegador.newPage({ viewport: { width: 360, height: 640 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => { delete document.documentElement.dataset.plataforma; });
  await page.evaluate(() => window.setIntentos(5));
  await page.waitForTimeout(50);
  const web = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight - window.innerHeight,
    enlaces: getComputedStyle(document.querySelector(".prensa-cierre-enlaces")).display,
  }));
  linea(
    web.scroll > 1 && web.enlaces !== "none",
    `WEB (sin data-plataforma) · scroll ${web.scroll}px (debe haberlo) · ` +
    `enlaces del pie: ${web.enlaces} (deben verse)`
  );

  await page.close();

  // ── EL MODO ESCRITURA ──────────────────────────────────────────────────────
  // El teclado se simula EXACTAMENTE como lo hace Android con `adjustResize`:
  // encogiendo la ventana. No hay nada más que simular, y ese es justo el
  // motivo por el que el modo no mide teclados (ver src/lib/teclado.js).
  //
  // Lo que se ata aquí es la promesa entera: sigue siendo UNA pantalla (cero
  // scroll), ADIVINAR está a la vista sobre el teclado, el desplegable se abre
  // HACIA ARRIBA y —lo que más duele si se rompe, porque el scroll no llega a
  // rescatarlo— no se sale por el techo.
  console.log("");
  for (const p of PANTALLAS) {
    // 260px = teclado normal; 340px = con barra de sugerencias o teclado de
    // fabricante, que es lo que se lleva puesto media gama Android.
    for (const teclado of [260, 340]) {
      const alto = p.h - teclado;
      // Por debajo de esto no queda pantalla ni para el cupón: no es un caso
      // real (sería un móvil en horizontal, donde el teclado ocupa casi todo).
      if (alto < 180) continue;
      // RÉPLICA del suelo que declara index.css (`min-height: 360px`). Por
      // debajo no hay modo escritura y el contrato es el contrario: el pliego
      // vuelve al flujo normal y se alcanza todo bajando. Si cambia allí,
      // cambia aquí — y este banco es justo quien avisa.
      const enModo = alto >= 360;

      const pg = await navegador.newPage({ viewport: { width: p.w, height: alto } });
      await pg.goto(url, { waitUntil: "networkidle" });
      await pg.evaluate(() => {
        window.setIntentos(3);
        window.setTeclado(true);
        window.setListbox(30);
      });
      // 300ms y no los 50 de arriba: el recorte y el desplegable ENTRAN con una
      // animación de transform, y un getBoundingClientRect a mitad de camino
      // mide la caja transformada — no la que verá el jugador.
      await pg.waitForTimeout(300);

      const m = await pg.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const oculto = (s) => {
          const el = q(s);
          return !el || getComputedStyle(el).display === "none";
        };
        const hoja = q(".app-pantalla");
        const cupon = q(".prensa-cupon").getBoundingClientRect();
        const boton = q("#adivinar").getBoundingClientRect();
        const campo = q("#campo-marca").getBoundingClientRect();
        const lista = q(".prensa-listbox").getBoundingClientRect();
        const peek = q(".cdd-peek").getBoundingClientRect();
        return {
          scrollDoc: document.documentElement.scrollHeight - window.innerHeight,
          scrollPliego: hoja.scrollHeight - hoja.clientHeight,
          // Lo que se retira mientras se escribe.
          seVan:
            oculto(".prensa-area-cab") && oculto(".prensa-area-foto") &&
            oculto(".prensa-historial") && oculto(".prensa-area-pie"),
          // El cupón arriba, y el recorte SIN pisarlo: el recorte es fixed y no
          // participa del reparto, así que si la reserva falla se pinta encima
          // del renglón de MARCA.
          cuponLibre: cupon.top >= peek.bottom - 1,
          botonDentro: boton.bottom <= window.innerHeight + 1 && boton.top >= -1,
          // El desplegable, PEGADO al campo y cayendo hacia el teclado.
          haciaAbajo: lista.top >= campo.bottom - 1,
          pegadoAlCampo: lista.top - campo.bottom <= 8,
          dentroDeLaVentana: lista.bottom <= window.innerHeight + 1,
          listaTop: Math.round(lista.top),
          listaAlto: Math.round(lista.height),
          // Alcanzable = se llega bajando. Sin modo el que se desplaza es el
          // DOCUMENTO (el pliego vuelve al flujo normal), así que se mide en
          // coordenadas de documento y contra su alto, no contra la válvula del
          // pliego — que ahí vale cero justamente porque no hace falta.
          botonAlcanzable:
            boton.bottom + window.scrollY <=
            Math.max(document.documentElement.scrollHeight, hoja.scrollHeight) + 1,
          // El recorte hace de fotografía: 4:3 exacto (reglas 5 y 7).
          peekRatio: peek.width / peek.height,
        };
      });
      await pg.close();

      const fallo = [];
      // El recorte hace de fotografía en las dos ramas: su proporción es
      // seguridad (reglas 5 y 7), no maquetación.
      if (Math.abs(m.peekRatio - RATIO) > 0.01) fallo.push(`recorte ${m.peekRatio.toFixed(3)}≠1.333`);

      if (!enModo) {
        // SIN modo: el contrato es el de siempre. No se recompone nada y todo
        // sigue siendo alcanzable — que es lo único que se le puede pedir a una
        // ventana en la que no cabe ni el cupón.
        if (m.seVan) fallo.push("recompone una ventana en la que no cabe");
        if (m.scrollDoc <= 1) fallo.push("el pliego no se ha soltado (no hay scroll con el que llegar)");
        if (!m.botonAlcanzable) fallo.push("ADIVINAR no se alcanza ni con scroll");
      } else {
        if (m.scrollDoc > 1) fallo.push(`el documento scrollea ${m.scrollDoc}px`);
        if (!m.seVan) fallo.push("algo que sobra sigue pintándose");
        // El recorte no puede pisar el primer renglón del cupón.
        if (!m.cuponLibre) fallo.push("el recorte se pinta encima del cupón");
        // La lista, donde la busca el dedo: colgando del campo que la ha
        // abierto y hacia el teclado. Lo contrario —despegarse e irse arriba—
        // es el fallo que se vio en el S25 y por el que existe esta prueba.
        if (!m.haciaAbajo) fallo.push("el desplegable NO cae hacia el teclado");
        if (!m.pegadoAlCampo) fallo.push(`el desplegable se despega ${m.listaTop}px del campo`);
        if (!m.dentroDeLaVentana) fallo.push("el desplegable se mete debajo del teclado");
        if (m.scrollPliego <= 1) {
          // Cabe todo: ADIVINAR entra entero en la ventana. Se mide con la
          // lista abierta y da igual —es `position: absolute`, no mueve la
          // maqueta—: lo que se comprueba es que el botón tiene su sitio, no
          // que se vea. Que la lista lo tape mientras está desplegada es
          // deliberado: se elige una opción y desaparece.
          if (!m.botonDentro) fallo.push("ADIVINAR no se ve entero");
        } else if (p.corriente) {
          fallo.push(`scroll ${m.scrollPliego}px en móvil corriente`);
        }
      }

      linea(
        fallo.length === 0,
        `${enModo ? "ESCRITURA" : "sin modo "}  ${p.nombre}  ${String(p.w).padStart(3)}x${p.h} −${teclado}kb → ${String(alto).padStart(3)}px · ` +
        `lista ${m.listaAlto}px (top ${m.listaTop}) · pliego ${m.scrollPliego}px` +
        (fallo.length ? `   ← ${fallo.join(" · ")}` : "")
      );
    }
  }

  await navegador.close();
  server.close();
  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLOS`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n✖ check-layout:", err?.message || err);
  process.exit(1);
});
