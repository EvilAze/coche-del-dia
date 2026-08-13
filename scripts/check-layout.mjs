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
// servidor y el «recorte» flotante (reglas 5 y 7 de CLAUDE.md); si se deforma,
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
  // El cupón de la app: tres renglones que abren una hoja de selección en vez
  // de levantar el teclado.
  ".prensa-cupon", ".prensa-renglon",
  // La cornisa y la marca del sumario: entre las dos ponen el ALTO de la barra
  // de la app (la marca fija 34px de caja; la cornisa mide ~26,5 y cabe dentro).
  // Si alguien las renombra, la cabecera pierde su ancla y este banco seguiría
  // dando verde midiendo una barra que no existe.
  ".prensa-cornisa", ".prensa-sumario-boton",
];

// ── La maqueta ─────────────────────────────────────────────────────────────
// Mismas clases que monta Configurator.jsx, en el mismo orden del DOM.
//
// La cabecera es la de la APP, que es lo que mide este banco en 30 de sus 31
// escenarios: barra con la cornisa dentro (`.prensa-cornisa`) y SIN la banda
// `.prensa-folio`, porque en la app esa banda no se monta — la fecha viaja en
// la barra (ver Header.jsx). El masthead sí se deja: lo apaga el CSS
// por `data-plataforma`, y dejarlo aquí es justo lo que comprueba que sigue
// apagándose. Por lo mismo el ladillo va con `solo-estado`: en la app el rótulo
// «La fotografía del día» no se pinta y la línea la ocupa la pista.
//
// LA MARCA DEL SUMARIO VA COMO BOTÓN DE VERDAD, y no como la palabra «SUMARIO»
// que había aquí. No es cosmética del banco: esa palabra medía un renglón de
// 10px y la marca real mide 34px de caja, así que el banco llevaba tiempo
// midiendo una cabecera ~22px más optimista que la que ve el jugador — en la
// dirección peligrosa, porque este banco existe justo para decir si el pliego
// cabe. Se corrige a la vez que la cabecera.
//
// LA CORNISA VA CON EL PEOR MES DEL AÑO («13 de septiembre») y la clasificación
// con salto («12º ▲2»), que es la combinación más ancha que puede darse en la
// barra. Un banco que mide si el pliego cabe no puede amueblarse con el caso
// cómodo: si los dos bloques se van a tocar en un móvil estrecho, que se toquen
// aquí.
//
// El control negativo de web (abajo) borra `data-plataforma` en caliente y NO
// repone la banda del folio: solo comprueba que hay scroll y que se ven los
// enlaces del pie, y ~29px de folio no cambian ninguna de las dos cosas.
function paginaHtml(hrefCss) {
  return `<!doctype html>
<html lang="es" data-plataforma="app">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${hrefCss}"></head>
<body><div class="cdd-app prensa" style="--accent: var(--rojo)">
  <main class="prensa-hoja prensa-pliego flex min-h-screen flex-col gap-3 app-pantalla">
    <header class="prensa-area-cab">
      <nav class="prensa-topbar"><span><button class="prensa-sumario-boton"><svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1h14M1 6h14M1 11h14"/></svg></button><span class="prensa-cornisa"><span class="cabeza">Coche del Día</span><span class="fecha">13 de septiembre</span></span></span><span><button class="prensa-clasif"><span class="lad">Clasificación</span><span class="cifra"><span class="pos">12º</span><span class="mov mov--up"><svg width="11" height="7" viewBox="0 0 11 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.4 5.6 5.5 1.4l4.1 4.2"/></svg>2</span></span></button></span></nav>
      <div class="prensa-masthead prensa-masthead--compacto"><p class="titulo">Coche del Día</p></div>
    </header>
    <section class="prensa-area-foto flex flex-col gap-3 pb-4">
      <div class="prensa-ladillo solo-estado"><span class="aparte">Pista 1 de 5</span></div>
      <div class="cdd-stage"><div class="cdd-stage-frame" id="marco">
        <div style="position:absolute;inset:0;background:#888"></div>
      </div></div>
    </section>
    <div class="prensa-area-jugar" id="jugar">
      <div class="prensa-cupon" id="cupon">
        <form class="flex flex-col gap-3">
          <div>
            <button type="button" class="prensa-renglon" id="renglon-marca">
              <span class="etiqueta">Marca</span><span class="guia"></span>
              <span class="vacio">Elegir…</span>
            </button>
          </div>
          <div>
            <button type="button" class="prensa-renglon">
              <span class="etiqueta">Modelo</span><span class="guia"></span>
              <span class="vacio">Elegir…</span>
            </button>
          </div>
          <div>
            <button type="button" class="prensa-renglon">
              <span class="etiqueta">Año</span><span class="guia"></span>
              <span class="vacio">Elegir…</span>
            </button>
            <p class="prensa-horquilla">Entre 1974 y 1989</p>
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
  </main></div>
<script>
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
  // inputs sueltos, ~90px más optimista que el cupón de verdad. Con la medida
  // buena un 640 no da para el shell y se desliza. Los renglones de una línea
  // recortaron unos 40px de esos, pero no llegan: aquí sigue entrando la
  // degradación diseñada (la válvula), igual que en el 320.
  { nombre: "Android medio        ", w: 360, h: 640, corriente: false },
  // 360x780: el móvil del autor y la clase más común hoy (360x780/800). Estaba
  // fuera de la lista, y es justo el ancho donde la foto pasa de estar limitada
  // por el ALTO a estarlo por el ANCHO de la columna — la frontera entre los dos
  // regímenes del shell. Sin él, ningún caso corriente medía esa transición.
  { nombre: "Android alto         ", w: 360, h: 780, corriente: true },
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

  // La otra deriva posible, y esta el CSS no la ve: la maqueta monta SIEMPRE la
  // banda del historial porque Configurator la reserva en la app desde el
  // primer pintado (`reservaHistorial`). Si esa reserva desapareciera, la app
  // volvería a soltarle a la foto el suelo de la lista al primer intento —el
  // salto de maqueta que mide la invariante 6— y este banco seguiría en verde,
  // midiendo una maqueta más generosa que la realidad.
  const configurador = await readFile(join(RAIZ, "src/components/configurator/Configurator.jsx"), "utf8");
  if (!/reservaHistorial/.test(configurador)) {
    console.error(
      "\n✖ Configurator.jsx ya no reserva el hueco del historial (`reservaHistorial`).\n" +
      "  La maqueta de este banco sí lo reserva, así que estaría midiendo una\n" +
      "  pantalla que la app no pinta. Actualiza las dos o recupera la reserva.\n"
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

  // EL MARCO NO SE MUEVE EN TODA LA PARTIDA. Se guarda la medida del primer
  // recuento (0 intentos) y se compara con las demás: es la promesa que la app
  // le hace al jugador —la maqueta se decide al abrir y no se recompone— y la
  // única de las cinco que necesita comparar DOS estados, no mirar uno.
  //
  // Se estrenó cazando esto: la banda del historial solo se montaba a partir
  // del primer intento, así que en un móvil apretado la foto se quedaba con los
  // 56px de su suelo al abrir y los soltaba al enviar el primer intento. En
  // pantallas altas no se notaba (a la foto le sobra alto y el que manda es el
  // ancho), que es como sobrevivió tanto tiempo. Lo reserva Configurator con
  // `reservaHistorial`.
  const marcoAlAbrir = new Map();

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
        // 6) El marco mide LO MISMO durante toda la partida (ver arriba).
        const clave = `${tema}|${p.nombre}`;
        const alAbrir = marcoAlAbrir.get(clave);
        if (!alAbrir) marcoAlAbrir.set(clave, { w: m.w, h: m.h });
        else if (Math.abs(alAbrir.h - m.h) > 1 || Math.abs(alAbrir.w - m.w) > 1) {
          fallo.push(`el marco cambia de tamaño jugando: ${alAbrir.w}x${alAbrir.h} al abrir → ${m.w}x${m.h}`);
        }

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

  // La RED DE SEGURIDAD del teclado. En la app ya no hay campos de texto en la
  // pantalla de juego —los renglones abren una hoja de selección— así que esto
  // no debería dispararse nunca jugando. Se mide igual, y es a propósito: si
  // algún día vuelve a colarse un <input> en el pliego, el shell fijo dejaría
  // el campo detrás del teclado y sin scroll con el que llegar. El sello lo
  // suelta (src/lib/teclado.js) y esta línea es quien lo garantiza.
  await page.evaluate(() => {
    document.documentElement.dataset.plataforma = "app";
    document.documentElement.dataset.teclado = "abierto";
  });
  await page.waitForTimeout(50);
  const tec = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  linea(tec > 1, `APP con data-teclado · scroll ${tec}px (el shell se suelta: nada queda inalcanzable)`);

  await page.close();

  await navegador.close();
  server.close();
  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLOS`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n✖ check-layout:", err?.message || err);
  process.exit(1);
});
