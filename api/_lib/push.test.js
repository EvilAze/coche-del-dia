// api/_lib/push.test.js
import { describe, it, expect } from "vitest";
import {
  getPushCopy,
  buildPushPayload,
  classifySendError,
  madridDateStr,
} from "./push.js";

describe("getPushCopy", () => {
  it("devuelve copy en español", () => {
    const c = getPushCopy("es");
    expect(c.title).toMatch(/coche/i);
    expect(typeof c.body).toBe("string");
  });
  it("devuelve copy en inglés", () => {
    expect(getPushCopy("en").body).toMatch(/car|guess/i);
  });
  it("cae a español si el locale es desconocido", () => {
    expect(getPushCopy("xx")).toEqual(getPushCopy("es"));
  });
});

describe("buildPushPayload", () => {
  it("serializa title/body/url a JSON", () => {
    const p = JSON.parse(buildPushPayload({ title: "T", body: "B", url: "/" }));
    expect(p).toEqual({ title: "T", body: "B", url: "/" });
  });
});

describe("classifySendError", () => {
  it("404 y 410 son suscripciones expiradas", () => {
    expect(classifySendError({ statusCode: 404 })).toBe("expired");
    expect(classifySendError({ statusCode: 410 })).toBe("expired");
  });
  it("otros códigos son reintentables", () => {
    expect(classifySendError({ statusCode: 500 })).toBe("retry");
    expect(classifySendError({})).toBe("retry");
  });
});

describe("madridDateStr", () => {
  it("formatea YYYY-MM-DD en zona Madrid", () => {
    const d = new Date("2026-07-02T00:30:00Z");
    expect(madridDateStr(d)).toBe("2026-07-02");
  });
  it("una hora antes de medianoche UTC ya es el día siguiente en Madrid", () => {
    const d = new Date("2026-07-01T23:30:00Z");
    expect(madridDateStr(d)).toBe("2026-07-02");
  });
});
