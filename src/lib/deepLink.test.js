// src/lib/deepLink.test.js
import { describe, it, expect } from "vitest";
import { rutaDesdeEnlace, debeNavegar, APP_LINK_HOST } from "./deepLink";

describe("rutaDesdeEnlace", () => {
  it("extrae la ruta de un enlace nuestro", () => {
    expect(rutaDesdeEnlace(`https://${APP_LINK_HOST}/repesca?id=7`)).toBe("/repesca?id=7");
  });

  it("la portada resuelve a '/'", () => {
    expect(rutaDesdeEnlace(`https://${APP_LINK_HOST}/`)).toBe("/");
    // Sin barra final el pathname sigue siendo "/": no debe salir "" ni null.
    expect(rutaDesdeEnlace(`https://${APP_LINK_HOST}`)).toBe("/");
  });

  it("conserva query y hash", () => {
    expect(rutaDesdeEnlace(`https://${APP_LINK_HOST}/privacidad?lang=en#datos`)).toBe(
      "/privacidad?lang=en#datos"
    );
  });

  // ── Seguridad ──
  // El intent-filter solo gobierna lo que Android nos ENRUTA. Cualquier app
  // puede lanzar un intent explícito a nuestra Activity con la URL que quiera y
  // llega igual a appUrlOpen, así que la validación es de verdad, no ceremonia.

  it("rechaza otro host", () => {
    expect(rutaDesdeEnlace("https://evil.example/roba")).toBeNull();
  });

  it("rechaza un subdominio que solo se PARECE al nuestro", () => {
    expect(rutaDesdeEnlace(`https://${APP_LINK_HOST}.evil.example/x`)).toBeNull();
    expect(rutaDesdeEnlace(`https://evil${APP_LINK_HOST}/x`)).toBeNull();
  });

  it("rechaza esquemas que no son https", () => {
    expect(rutaDesdeEnlace(`http://${APP_LINK_HOST}/x`)).toBeNull();
    expect(rutaDesdeEnlace("javascript:alert(1)")).toBeNull();
    expect(rutaDesdeEnlace("file:///etc/passwd")).toBeNull();
  });

  // El caso peligroso de verdad, y el menos evidente: el host ES el nuestro, así
  // que pasa toda validación de dominio. Lo que escapa es el PATHNAME.
  // "//evil.example/x" pasado a location.replace() es una URL protocol-relative
  // y el WebView acaba en https://evil.example/x. Android enruta este enlace
  // hacia la app por el intent-filter, o sea que basta con mandarlo por un chat.
  it("neutraliza el escape de origen vía ruta protocol-relative", () => {
    const r = rutaDesdeEnlace(`https://${APP_LINK_HOST}//evil.example/x`);
    expect(r).toBe("/evil.example/x");
    // Lo que NO puede pasar bajo ningún concepto:
    expect(r.startsWith("//")).toBe(false);
  });

  it("neutraliza también la variante con barra invertida", () => {
    // Varios navegadores tratan "\" como separador en este contexto.
    const r = rutaDesdeEnlace(`https://${APP_LINK_HOST}/\\/evil.example/x`);
    expect(r.startsWith("//")).toBe(false);
    expect(r.startsWith("/\\")).toBe(false);
  });

  it("aguanta basura sin lanzar", () => {
    for (const basura of [null, undefined, "", 42, {}, "no-es-una-url"]) {
      expect(rutaDesdeEnlace(basura)).toBeNull();
    }
  });
});

describe("debeNavegar", () => {
  const aqui = { pathname: "/", search: "", hash: "" };

  it("no navega si el enlace apunta a donde ya estamos", () => {
    // Abrir la app desde un enlace a la portada estando en la portada no debe
    // recargar el WebView: tiraría la partida en curso por nada.
    expect(debeNavegar("/", aqui)).toBe(false);
  });

  it("navega si la ruta es distinta", () => {
    expect(debeNavegar("/repesca?id=7", aqui)).toBe(true);
  });

  it("distingue por query, no solo por pathname", () => {
    const enRepesca = { pathname: "/repesca", search: "?id=7", hash: "" };
    expect(debeNavegar("/repesca?id=7", enRepesca)).toBe(false);
    expect(debeNavegar("/repesca?id=8", enRepesca)).toBe(true);
  });

  it("no navega con ruta nula", () => {
    expect(debeNavegar(null, aqui)).toBe(false);
  });
});
