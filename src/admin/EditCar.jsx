// src/admin/EditCar.jsx
// Herramienta interna de admin para editar coches existentes en caliente.
// Acceso: /admin/edit-car  (enrutado manualmente desde src/index.js)
//
// Flujo:
//   1. Dropdown con todo el catálogo (vía /api/list-cars, mismo hook que
//      el resto del juego — no necesita auth porque solo expone metadatos
//      públicos).
//   2. Al seleccionar un coche, pide /api/admin/get-car?id=... que sí está
//      gateado por whitelist de emails y devuelve también image_url.
//   3. El admin edita campos. Si cambia la foto, sube el nuevo blob al
//      bucket por su cuenta (mismo patrón que AddCar) y nos manda la URL.
//   4. POST /api/admin/update-car con solo los campos que hayan cambiado.
//      El UPDATE corre con service_role.
//
// Hot-swap: el resto del juego (/api/get-daily-car y /api/daily-image)
// relee `cars` cada vez, así que los cambios se ven al instante (la imagen
// con un retraso máximo de ~60 s por la cache CDN).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useCatalog, loadCatalog } from "../data/catalog";

const STORAGE_BUCKET = "cars_images";
const ADMIN_EMAILS = ["ievilaze@gmail.com"];

const CURRENT_YEAR = new Date().getFullYear();

function sanitizeFilename(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

const initialForm = {
  marca: "",
  modelo: "",
  anio: "",
  pais: "",
  description: "",
  // Imagen: img (URL actual cargada del servidor) y file (nueva selección).
  img: "",
  file: null,
};

export default function EditCar() {
  const { data: catalog } = useCatalog();
  const CARS = catalog?.cars ?? [];
  const MARCAS = catalog?.marcas ?? [];
  const PAISES = catalog?.paises ?? [];

  const carsSorted = useMemo(
    () =>
      [...CARS].sort((a, b) =>
        `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`)
      ),
    [CARS]
  );

  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [originalForm, setOriginalForm] = useState(initialForm);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadingCar, setLoadingCar] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // noindex y título de pestaña.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Admin · Editar coche";
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  // Sesión.
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

  // Libera el object URL del preview al desmontar / cambiar archivo.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Cuando cambia el coche seleccionado, carga sus datos completos.
  useEffect(() => {
    if (!selectedId) {
      setForm(initialForm);
      setOriginalForm(initialForm);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setFeedback(null);
      return;
    }

    let cancelled = false;
    setLoadingCar(true);
    setFeedback(null);

    (async () => {
      try {
        const {
          data: { session: s },
        } = await supabase.auth.getSession();
        if (!s) throw new Error("Sin sesión");

        const res = await fetch(
          `/api/admin/get-car?id=${encodeURIComponent(selectedId)}`,
          { headers: { Authorization: `Bearer ${s.access_token}` } }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;

        const next = {
          marca: data.marca || "",
          modelo: data.modelo || "",
          anio: data.anio != null ? String(data.anio) : "",
          pais: data.pais || "",
          description: data.description || "",
          img: data.img || "",
          file: null,
        };
        setForm(next);
        setOriginalForm(next);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      } catch (err) {
        if (!cancelled) {
          console.error("[EditCar] get-car:", err);
          setFeedback({
            type: "error",
            message: err?.message || "No se pudo cargar el coche.",
          });
        }
      } finally {
        if (!cancelled) setLoadingCar(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (feedback) setFeedback(null);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0] ?? null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
    updateField("file", file);
  }

  // ¿Hay algún cambio frente al original?
  const dirty = useMemo(() => {
    if (!selectedId) return false;
    return (
      form.marca !== originalForm.marca ||
      form.modelo !== originalForm.modelo ||
      form.anio !== originalForm.anio ||
      form.pais !== originalForm.pais ||
      form.description !== originalForm.description ||
      form.file != null
    );
  }, [form, originalForm, selectedId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting || !selectedId || !dirty) return;

    const marca = form.marca.trim();
    const modelo = form.modelo.trim();
    const pais = form.pais.trim();
    const description = form.description.trim();
    const anioNum = Number(form.anio);
    const file = form.file;

    if (!marca || !modelo || !pais) {
      setFeedback({ type: "error", message: "Marca, modelo y país son obligatorios." });
      return;
    }
    if (!Number.isInteger(anioNum) || anioNum < 1885 || anioNum > CURRENT_YEAR + 1) {
      setFeedback({
        type: "error",
        message: `El año debe estar entre 1885 y ${CURRENT_YEAR + 1}.`,
      });
      return;
    }
    if (file && !file.type.startsWith("image/")) {
      setFeedback({ type: "error", message: "El archivo debe ser una imagen." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      let newImageUrl = null;
      if (file) {
        // Sube la nueva imagen ANTES de tocar la BD: si falla, no rompemos
        // la fila existente.
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

        const { data: publicData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(path);
        newImageUrl = publicData?.publicUrl;
        if (!newImageUrl) throw new Error("No se pudo obtener la URL pública.");
      }

      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      if (!s) throw new Error("Sin sesión");

      // Solo mandamos los campos que han cambiado, para que el endpoint
      // construya un patch mínimo.
      const patch = { id: selectedId };
      if (marca !== originalForm.marca) patch.marca = marca;
      if (modelo !== originalForm.modelo) patch.modelo = modelo;
      if (form.anio !== originalForm.anio) patch.anio = anioNum;
      if (pais !== originalForm.pais) patch.pais = pais;
      if (description !== originalForm.description) patch.description = description;
      if (newImageUrl) patch.image_url = newImageUrl;

      const res = await fetch("/api/admin/update-car", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.access_token}`,
        },
        body: JSON.stringify(patch),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      // Refrescamos el catálogo en caché para que el dropdown muestre los
      // nuevos valores si el admin cambia de coche y vuelve.
      loadCatalog.bind(null)();
      // Forzamos recarga limpia del cache local:
      try {
        const fresh = await fetch("/api/list-cars", { cache: "no-store" });
        if (fresh.ok) {
          // useCatalog ya está montado; en un siguiente mount leerá lo nuevo.
        }
      } catch {}

      // Sincronizamos estado local: el coche editado pasa a ser el nuevo
      // "original".
      const updated = data.car;
      const nextForm = {
        marca: updated.marca || "",
        modelo: updated.modelo || "",
        anio: updated.anio != null ? String(updated.anio) : "",
        pais: updated.pais || "",
        description: updated.description || "",
        img: updated.img || "",
        file: null,
      };
      setForm(nextForm);
      setOriginalForm(nextForm);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);

      setFeedback({
        type: "success",
        message: `${updated.marca} ${updated.modelo} actualizado correctamente.`,
      });
    } catch (err) {
      console.error("[EditCar] save:", err);
      setFeedback({
        type: "error",
        message: err?.message || "No se pudo guardar el coche.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---- Render: gates de sesión / permisos ----

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
            Inicia sesión con la cuenta de administrador.
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

  // ---- Render: formulario ----

  const activePreview = previewUrl || form.img || null;

  return (
    <div className="min-h-screen bg-bg-primary font-body text-white">
      <div className="mx-auto w-full max-w-md px-4 py-8">
        <header className="border-b border-border pb-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
            Admin
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-widest text-white">
            Editar coche
          </h1>
          <p className="mt-2 text-xs text-muted">
            Hot-swap del catálogo. Los cambios se reflejan en el juego al
            instante (la imagen tarda hasta 60 s por la cache del CDN).
          </p>
        </header>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
          <Field
            label={
              <>
                Coche
                <span className="ml-2 normal-case tracking-normal text-muted">
                  · {CARS.length} en catálogo
                </span>
              </>
            }
          >
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={isSubmitting || CARS.length === 0}
              className={selectClass}
            >
              <option value="">— Selecciona —</option>
              {carsSorted.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.marca} {c.modelo} ({c.anio})
                </option>
              ))}
            </select>
          </Field>

          {loadingCar && (
            <p className="animate-pulse text-xs uppercase tracking-widest text-muted">
              Cargando datos del coche...
            </p>
          )}

          {selectedId && !loadingCar && (
            <>
              <Field label="Marca">
                <input
                  type="text"
                  value={form.marca}
                  onChange={(e) => updateField("marca", e.target.value)}
                  maxLength={40}
                  disabled={isSubmitting}
                  list="edit-marcas-list"
                  autoComplete="off"
                  className={inputClass}
                  required
                />
                <datalist id="edit-marcas-list">
                  {MARCAS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>

              <Field label="Modelo">
                <input
                  type="text"
                  value={form.modelo}
                  onChange={(e) => updateField("modelo", e.target.value)}
                  maxLength={60}
                  disabled={isSubmitting}
                  className={inputClass}
                  required
                />
              </Field>

              <Field label="Año">
                <input
                  type="number"
                  value={form.anio}
                  onChange={(e) => updateField("anio", e.target.value)}
                  min={1885}
                  max={CURRENT_YEAR + 1}
                  inputMode="numeric"
                  disabled={isSubmitting}
                  className={inputClass}
                  required
                />
              </Field>

              <Field label="País">
                <input
                  type="text"
                  value={form.pais}
                  onChange={(e) => updateField("pais", e.target.value)}
                  maxLength={40}
                  disabled={isSubmitting}
                  list="edit-paises-list"
                  autoComplete="off"
                  className={inputClass}
                  required
                />
                <datalist id="edit-paises-list">
                  {PAISES.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>

              <Field
                label={
                  <>
                    Descripción
                    <span className="ml-2 normal-case tracking-normal text-muted">
                      · {form.description.length} / 600
                    </span>
                  </>
                }
              >
                <textarea
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  placeholder="Un párrafo corto sobre el coche..."
                  maxLength={600}
                  rows={4}
                  disabled={isSubmitting}
                  className={`${inputClass} h-auto resize-y py-3 leading-relaxed`}
                />
              </Field>

              <Field
                label={
                  <>
                    Foto del coche
                    <span className="ml-2 normal-case tracking-normal text-muted">
                      · {form.file ? "nueva seleccionada" : "deja vacío para mantener la actual"}
                    </span>
                  </>
                }
              >
                <input
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
                />
                {activePreview && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-border bg-black/40">
                    <img
                      src={activePreview}
                      alt="Vista previa"
                      className="h-48 w-full object-contain"
                    />
                  </div>
                )}
              </Field>
            </>
          )}

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
            disabled={isSubmitting || !selectedId || !dirty}
            className="
              h-12 w-full rounded-xl bg-accent font-display text-lg
              tracking-widest text-bg-primary transition
              hover:bg-accent-dark active:scale-[0.98]
              disabled:cursor-not-allowed disabled:opacity-40
            "
          >
            {isSubmitting
              ? "Guardando..."
              : !selectedId
              ? "Selecciona un coche"
              : !dirty
              ? "Sin cambios"
              : "Guardar cambios"}
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

const selectClass = `
  h-12 w-full rounded-xl border border-white/10 bg-black/40 px-3
  text-base text-white outline-none
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
