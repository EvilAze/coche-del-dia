// src/admin/AddCar.jsx
// Herramienta interna de administración para añadir coches al catálogo.
// Acceso: /admin/add-car  (enrutado manualmente desde src/index.js)
//
// Sube la imagen al bucket público `cars_images` de Supabase Storage y
// crea una fila en la tabla `cars` (make, model, year, pais, image_url).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useCatalog } from "../data/catalog";
import DescriptionEnField from "./DescriptionEnField";
import CarImage from "../components/CarImage";

const STORAGE_BUCKET = "cars_images";
const TABLE_NAME = "cars";
const ADMIN_EMAILS = ["ievilaze@gmail.com"];

const CURRENT_YEAR = new Date().getFullYear();

// Mismos valores que useGame.js / Preview.jsx — duplicados a propósito para
// que la previsualización aquí sea independiente del juego real.
const ZOOM_LEVELS = [3.5, 3.0, 2.7, 2.4, 1.8];

// Slider 1..6 -> mismo recorrido que vive un jugador real:
//   1..5 = las cinco pistas progresivas
//   6    = revelado final (zoom 1.0)
function zoomFromStep(step) {
  if (step >= 6) {
    return { zoom: 1.0, hintIndex: null, status: "won" };
  }
  const idx = step - 1;
  return { zoom: ZOOM_LEVELS[idx], hintIndex: idx, status: "playing" };
}

const initialForm = {
  make: "",
  model: "",
  year: "",
  pais: "",
  description: "",
  description_en: "",
  file: null,
};

function sanitizeFilename(name) {
  // Quita acentos y normaliza para evitar URLs raras en Storage.
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export default function AddCar() {
  const { data: catalog } = useCatalog();
  const MARCAS = catalog?.marcas ?? [];
  const PAISES = catalog?.paises ?? [];

  // Lookup case-insensitive marca -> país. Memoizado: cambia solo si llega
  // un catálogo nuevo (p.ej. tras añadir un coche con marca desconocida).
  const MARCA_LOOKUP = useMemo(() => {
    const map = {};
    const source = catalog?.marcaPais ?? {};
    for (const [m, p] of Object.entries(source)) {
      map[m.toLowerCase()] = p;
    }
    return map;
  }, [catalog]);

  const [form, setForm] = useState(initialForm);
  // Si el usuario edita el país a mano, dejamos de pisarlo desde la marca.
  const [paisTouched, setPaisTouched] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  // Slider de dificultad (1..6) — mismo recorrido que el juego real.
  const [previewStep, setPreviewStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: "success" | "error", message }

  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Bloquea indexación: esta ruta no debe acabar en Google.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Admin · Añadir coche";
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  // Sesión: ruta privada -> hay que estar logueado.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Libera el object URL del preview al cambiar/desmontar.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function updateField(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-rellenar país desde la marca si el usuario aún no lo ha tocado.
      if (field === "make" && !paisTouched) {
        const hit = MARCA_LOOKUP[value.trim().toLowerCase()];
        next.pais = hit ?? "";
      }
      return next;
    });
    if (field === "pais") setPaisTouched(true);
    if (feedback) setFeedback(null);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0] ?? null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
    setPreviewStep(1);
    updateField("file", file);
  }

  function resetForm() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewStep(1);
    setForm(initialForm);
    setPaisTouched(false);
    // El <input type="file"> es controlado por su DOM: lo reseteamos vía key.
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const make = form.make.trim();
    const model = form.model.trim();
    const pais = form.pais.trim();
    const description = form.description.trim();
    const descriptionEn = form.description_en.trim();
    const yearNum = Number(form.year);
    const file = form.file;

    if (!make || !model) {
      setFeedback({ type: "error", message: "Marca y modelo son obligatorios." });
      return;
    }
    if (!pais) {
      setFeedback({ type: "error", message: "El país es obligatorio." });
      return;
    }
    if (!Number.isInteger(yearNum) || yearNum < 1885 || yearNum > CURRENT_YEAR + 1) {
      setFeedback({
        type: "error",
        message: `El año debe estar entre 1885 y ${CURRENT_YEAR + 1}.`,
      });
      return;
    }
    if (!file) {
      setFeedback({ type: "error", message: "Selecciona una imagen del coche." });
      return;
    }
    if (!file.type.startsWith("image/")) {
      setFeedback({ type: "error", message: "El archivo debe ser una imagen." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      // 1) Subir imagen al bucket público.
      const safeName = sanitizeFilename(file.name) || "car.jpg";
      const path = `${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (uploadError) throw uploadError;

      // 2) Obtener URL pública.
      const { data: publicData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(path);
      const imageUrl = publicData?.publicUrl;
      if (!imageUrl) throw new Error("No se pudo obtener la URL pública.");

      // 3) Insertar fila en la tabla cars vía endpoint admin server-side.
      //    Antes: supabase.from('cars').insert(...) directo desde el
      //    navegador. La policy "Subida de coches" permitía INSERT a
      //    cualquier authenticated (no solo al admin) → contaminación de
      //    catálogo. Movido al server con whitelist de email + service_role
      //    para cerrar el agujero. La policy permisiva y los grants de
      //    escritura sobre `cars` quedaron revocados en BD.
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Sesión perdida. Vuelve a iniciar sesión.");
      }

      const addRes = await fetch("/api/admin/save-car", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          marca: make,
          modelo: model,
          anio: yearNum,
          pais,
          // Descripción opcional: mandamos null si está vacía para que la
          // columna admita el `is null` natural en lugar de strings vacíos.
          description: description ? description : null,
          description_en: descriptionEn ? descriptionEn : null,
          image_url: imageUrl,
        }),
      });
      const addBody = await addRes.json().catch(() => ({}));
      if (!addRes.ok) {
        // Limpieza best-effort: el blob ya está subido; si la fila no
        // entró, quítalo para no acumular huérfanos.
        await supabase.storage.from(STORAGE_BUCKET).remove([path]);
        throw new Error(
          addBody?.detail || addBody?.error || `HTTP ${addRes.status}`
        );
      }

      setFeedback({
        type: "success",
        message: `${make} ${model} (${yearNum}) añadido correctamente.`,
      });
      resetForm();
    } catch (err) {
      console.error("[AddCar] fallo al guardar coche:", err);
      setFeedback({
        type: "error",
        message: err?.message || "No se pudo guardar el coche.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---- Render ----

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary font-body text-white">
        <p className="animate-pulse text-sm uppercase tracking-widest text-muted">
          Comprobando sesión...
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-white">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-secondary p-6 text-center shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
            Zona interna
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-widest text-white">
            Acceso restringido
          </h1>
          <p className="mt-3 text-sm text-muted">
            Inicia sesión con la cuenta de administrador para añadir coches.
          </p>
          <button
            onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
            className="mt-5 h-12 w-full rounded-xl bg-accent font-display text-lg tracking-widest text-bg-primary transition hover:bg-accent-dark active:scale-[0.98]"
          >
            Continuar con Google
          </button>
        </div>
      </div>
    );
  }

  const currentEmail = (session.user?.email ?? "").toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(currentEmail);

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-white">
        <div className="w-full max-w-sm rounded-2xl border border-red-400/40 bg-bg-secondary p-6 text-center shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.28em] text-red-400">
            403 · Sin permisos
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-widest text-white">
            No autorizado
          </h1>
          <p className="mt-3 text-sm text-muted">
            La cuenta <span className="text-white">{currentEmail || "actual"}</span>{" "}
            no tiene acceso a esta herramienta.
          </p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
            }}
            className="mt-5 h-12 w-full rounded-xl border border-white/10 bg-black/40 font-display text-lg tracking-widest text-white transition hover:border-accent active:scale-[0.98]"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary font-body text-white">
      <div className="mx-auto w-full max-w-md px-4 py-8">
        <header className="border-b border-border pb-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
            Admin
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-widest text-white">
            Añadir coche
          </h1>
          <p className="mt-2 text-xs text-muted">
            Sube la foto y los datos. La imagen va a Storage; los datos a la
            tabla <code className="text-accent">{TABLE_NAME}</code>.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
          <Field label="Marca">
            <input
              type="text"
              value={form.make}
              onChange={(e) => updateField("make", e.target.value)}
              placeholder="Ferrari"
              maxLength={40}
              disabled={isSubmitting}
              list="marcas-list"
              autoComplete="off"
              className={inputClass}
              required
            />
            <datalist id="marcas-list">
              {MARCAS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>

          <Field label="Modelo">
            <input
              type="text"
              value={form.model}
              onChange={(e) => updateField("model", e.target.value)}
              placeholder="F40"
              maxLength={60}
              disabled={isSubmitting}
              className={inputClass}
              required
            />
          </Field>

          <Field label="Año">
            <input
              type="number"
              value={form.year}
              onChange={(e) => updateField("year", e.target.value)}
              placeholder="1987"
              min={1885}
              max={CURRENT_YEAR + 1}
              inputMode="numeric"
              disabled={isSubmitting}
              className={inputClass}
              required
            />
          </Field>

          <Field
            label={
              <>
                País
                {!paisTouched && form.pais && (
                  <span className="ml-2 normal-case tracking-normal text-accent">
                    · auto desde marca
                  </span>
                )}
              </>
            }
          >
            <input
              type="text"
              value={form.pais}
              onChange={(e) => updateField("pais", e.target.value)}
              placeholder="Italia"
              maxLength={40}
              disabled={isSubmitting}
              list="paises-list"
              autoComplete="off"
              className={inputClass}
              required
            />
            <datalist id="paises-list">
              {PAISES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>

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
            <textarea
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Un párrafo corto sobre el coche: anécdotas, datos curiosos, contexto histórico..."
              maxLength={600}
              rows={4}
              disabled={isSubmitting}
              className={`${inputClass} h-auto resize-y py-3 leading-relaxed`}
            />
            <span className="text-[10px] uppercase tracking-widest text-muted">
              {form.description.length} / 600
            </span>
          </Field>

          <Field
            label={
              <>
                Description (EN)
                <span className="ml-2 normal-case tracking-normal text-muted">
                  · auto-traducible
                </span>
              </>
            }
          >
            <DescriptionEnField
              valueEs={form.description}
              valueEn={form.description_en}
              onChange={(v) => updateField("description_en", v)}
              disabled={isSubmitting}
              inputClass={inputClass}
            />
          </Field>

          <Field label="Foto del coche">
            <input
              // key fuerza el reseteo del input file tras un envío exitoso
              key={form.file ? "has-file" : "empty"}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="
                block w-full cursor-pointer text-sm text-muted
                file:mr-3 file:cursor-pointer file:rounded-lg file:border-0
                file:bg-accent file:px-4 file:py-2 file:font-display
                file:tracking-widest file:text-bg-primary
                hover:file:bg-accent-dark
                disabled:cursor-not-allowed disabled:opacity-50
              "
              required
            />
            {previewUrl && (
              <DifficultyPreview
                src={previewUrl}
                step={previewStep}
                onStepChange={setPreviewStep}
              />
            )}
          </Field>

          {feedback && (
            <div
              role={feedback.type === "error" ? "alert" : "status"}
              className={`rounded-xl border px-4 py-3 text-sm ${
                feedback.type === "success"
                  ? "border-green-400/40 bg-green-400/10 text-green-300"
                  : "border-red-400/40 bg-red-400/10 text-red-300"
              }`}
            >
              {feedback.message}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="
              h-12 w-full rounded-xl bg-accent font-display text-lg
              tracking-widest text-bg-primary transition
              hover:bg-accent-dark active:scale-[0.98]
              disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            {isSubmitting ? "Subiendo..." : "Guardar coche"}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputClass = `
  h-12 w-full rounded-xl border border-white/10 bg-black/40 px-4
  text-base text-white outline-none placeholder:text-white/20
  focus:border-accent disabled:cursor-not-allowed disabled:opacity-50
`;

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function DifficultyPreview({ src, step, onStepChange }) {
  const { zoom, hintIndex, status } = zoomFromStep(step);
  return (
    <div className="mt-3 flex flex-col gap-3">
      <CarImage
        src={src}
        zoom={zoom}
        hintIndex={hintIndex}
        totalHints={ZOOM_LEVELS.length}
        status={status}
      />
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-secondary/40 p-3">
        <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted">
          <span>Intento</span>
          <span className="font-display text-base text-accent">
            {step} / 6 {step === 6 && "· revelado"}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={step}
          onChange={(e) => onStepChange(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted">
          <span>x3.5</span>
          <span>x3</span>
          <span>x2.7</span>
          <span>x2.4</span>
          <span>x1.8</span>
          <span>1:1</span>
        </div>
      </div>
    </div>
  );
}
