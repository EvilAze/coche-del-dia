// api/_lib/origen-propio.test.js
// El portero de /api/list-cars: deja pasar a nuestra página (web y app) y a
// nadie más que se pueda distinguir desde un navegador.

import { describe, it, expect } from "vitest";
import { esPeticionPropia } from "./origen-propio.js";

const req = (headers) => ({ headers: { host: "cochedeldia.com", ...headers } });

describe("esPeticionPropia", () => {
  it("la web: fetch same-origin", () => {
    expect(esPeticionPropia(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("la app: Origin https://localhost (cross-site para el navegador)", () => {
    expect(
      esPeticionPropia(req({ "sec-fetch-site": "cross-site", origin: "https://localhost" }))
    ).toBe(true);
  });

  it("abrir la URL a mano en una pestaña NO pasa", () => {
    expect(esPeticionPropia(req({ "sec-fetch-site": "none" }))).toBe(false);
  });

  it("un fetch desde otra web NO pasa, aunque traiga un Referer nuestro", () => {
    expect(
      esPeticionPropia(
        req({
          "sec-fetch-site": "cross-site",
          origin: "https://otra-web.example",
          referer: "https://cochedeldia.com/",
        })
      )
    ).toBe(false);
  });

  it("navegador sin Fetch Metadata (Safari viejo): vale el Referer del mismo host", () => {
    expect(esPeticionPropia(req({ referer: "https://cochedeldia.com/r/abc" }))).toBe(true);
    expect(esPeticionPropia(req({ referer: "https://otra-web.example/" }))).toBe(false);
  });

  it("sin ninguna cabecera (un curl pelado) NO pasa", () => {
    expect(esPeticionPropia(req({}))).toBe(false);
    expect(esPeticionPropia({})).toBe(false);
  });
});
