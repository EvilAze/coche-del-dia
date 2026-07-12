// src/admin/AddCarPanel.jsx
// Panel embebido en AdminTools para añadir un coche al catálogo. Refactor
// de src/admin/AddCar.jsx con dos diferencias:
//   - Sin gate de sesión propio (lo hace AdminTools).
//   - Acepta `assignToDate` opcional: cuando viene desde el flujo de swap
//     ("crear coche nuevo para el día X"), tras guardar lo asigna a esa
//     fecha vía /api/admin/schedule POST y notifica al padre con la fecha.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useFreshCatalog } from "../data/catalog";
import DescriptionEnField from "./DescriptionEnField";
import FocusPicker from "./FocusPicker";
import ZoomBaseField from "./ZoomBaseField";
import { DEFAULT_ZOOM_BASE } from "../lib/zoom.js";

const STORAGE_BUCKET = "cars_images";
const CURRENT_YEAR = new Date().getFullYear();

const initialForm = {
  make: "",
  model: "",
  year: "",
  pais: "",
  description: "",
  description_en: "",
  file: null,
  // Punto focal del zoom. 0.5/0.5 = centro (igual que el comportamiento
  // por defecto del servidor antes de existir las columnas).
  focus_x: 0.5,
  focus_y: 0.5,
  // Zoom inicial (dificultad). Por defecto = el de siempre; se ajusta por coche.
  zoom_base: DEFAULT_ZOOM_BASE,
};

function sanitizeFilename(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export default function AddCarPanel({
  assignToDate = null,
  onCancelAssign,
  onSaved,
}) {
  // useFreshCatalog (no useCatalog) por dos razones:
  //   1. Expone reload() — necesario para refrescar el dropdown tras
  //      guardar un coche sin esperar al TTL del CDN.
  //   2. Al montar, hace fresh-fetch: si vienes de un swap (flujo
  //      "crear coche para el día X"), no quieres que el datalist
  //      muestre datos viejos.
  const { data: catalog, reload: reloadCatalog } = useFreshCatalog();
  const MARCAS = catalog?.marcas ?? [];
  const PAISES = catalog?.paises ?? [];

  const MARCA_LOOKUP = useMemo(() => {
    const map = {};
    const source = catalog?.marcaPais ?? {};
    for (const [m, p] of Object.entries(source)) {
      map[m.toLowerCase()] = p;
    }
    return map;
  }, [catalog]);

  const [form, setForm] = useState(initialForm);
  const [paisTouched, setPaisTouched] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Ref al <input type="file"> para limpiarlo al resetear el form SIN remontar el
  // input. El `key={form.file ? …}` anterior remontaba el input a mitad de la
  // interacción con el diálogo del sistema → bug de "hay que clicar dos veces".
  const fileInputRef = useRef(null);
  useEffect(() => {
    if (!form.file && fileInputRef.current) fileInputRef.current.value = "";
  }, [form.file]);

  function updateField(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
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
    // Cambiar foto resetea el punto focal al centro: la foto anterior
    // podía tener un foco específico que ya no aplica.
    setForm((prev) => ({
      ...prev,
      file,
      focus_x: 0.5,
      focus_y: 0.5,
    }));
    if (feedback) setFeedback(null);
  }

  function resetForm() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setForm(initialForm);
    setPaisTouched(false);
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
      // 1) Subir imagen al bucket.
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
      const imageUrl = publicData?.publicUrl;
      if (!imageUrl) throw new Error("No se pudo obtener la URL pública.");

      // 2) Insertar fila vía endpoint admin.
      const {
        data: { session },
      } = await supabase.auth.getSession();
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
          description: description ? description : null,
          description_en: descriptionEn ? descriptionEn : null,
          image_url: imageUrl,
          focus_x: form.focus_x,
          focus_y: form.focus_y,
          zoom_base: form.zoom_base,
        }),
      });
      const addBody = await addRes.json().catch(() => ({}));
      if (!addRes.ok) {
        // Best-effort cleanup del blob huérfano.
        await supabase.storage.from(STORAGE_BUCKET).remove([path]);
        throw new Error(
          addBody?.detail || addBody?.error || `HTTP ${addRes.status}`
        );
      }

      const newCar = addBody.car;

      // 3) Si veníamos de un flujo de swap (assignToDate presente), lo
      //    enganchamos al calendario antes de cerrar.
      let assignedDate = null;
      if (assignToDate) {
        const assignRes = await fetch("/api/admin/schedule", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ date: assignToDate, car_id: newCar.id }),
        });
        const assignBody = await assignRes.json().catch(() => ({}));
        if (!assignRes.ok) {
          // El coche YA está en el catálogo, pero la asignación falló.
          // Mostramos warning con call-to-action manual al calendario.
          setFeedback({
            type: "error",
            message: `Coche creado, pero no se pudo asignar al ${assignToDate}: ${
              assignBody?.error || `HTTP ${assignRes.status}`
            }`,
          });
          reloadCatalog().catch(() => {});
          setIsSubmitting(false);
          return;
        }
        assignedDate = assignToDate;
      }

      reloadCatalog().catch((err) =>
        console.warn("[AddCarPanel] reloadCatalog post-save:", err)
      );

      setFeedback({
        type: "success",
        message: assignedDate
          ? `${make} ${model} (${yearNum}) añadido y asignado al ${assignedDate}.`
          : `${make} ${model} (${yearNum}) añadido correctamente.`,
      });
      resetForm();

      if (typeof onSaved === "function") onSaved(newCar, assignedDate);
    } catch (err) {
      console.error("[AddCarPanel] fallo al guardar coche:", err);
      setFeedback({
        type: "error",
        message: err?.message || "No se pudo guardar el coche.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="border-b border-border pb-3">
        <h2 className="font-display text-2xl tracking-widest text-white">
          Añadir coche
        </h2>
        <p className="mt-1 text-xs text-muted">
          Sube la foto y los datos. La imagen va a Storage; los datos a la
          tabla <code className="text-accent">cars</code>.
        </p>
      </header>

      {assignToDate && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          <div className="font-semibold uppercase tracking-widest">
            Asignación pendiente
          </div>
          <p className="mt-1 text-xs text-accent/90">
            Al guardar, este coche se asignará al día{" "}
            <strong>{assignToDate}</strong> en el calendario.
          </p>
          {typeof onCancelAssign === "function" && (
            <button
              type="button"
              onClick={onCancelAssign}
              className="mt-2 text-[11px] uppercase tracking-widest text-accent underline-offset-2 hover:underline"
            >
              Cancelar asignación
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Escritorio: dos columnas — identidad a la izquierda, imagen y zoom a
            la derecha. En móvil se apilan. */}
        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
        <div className="flex flex-col gap-5">
        <Field label="Marca">
          <input
            type="text"
            value={form.make}
            onChange={(e) => updateField("make", e.target.value)}
            placeholder="Ferrari"
            maxLength={40}
            disabled={isSubmitting}
            list="add-marcas-list"
            autoComplete="off"
            className={inputClass}
            required
          />
          <datalist id="add-marcas-list">
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
            list="add-paises-list"
            autoComplete="off"
            className={inputClass}
            required
          />
          <datalist id="add-paises-list">
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
        </div>

        <div className="mt-5 flex flex-col gap-5 lg:mt-0">
        <Field label="Foto del coche">
          <input
            ref={fileInputRef}
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
        </Field>

        {previewUrl && (
          <Field
            label={
              <>
                Punto focal del zoom
                <span className="ml-2 normal-case tracking-normal text-muted">
                  · arrastra para elegir desde dónde nace
                </span>
              </>
            }
          >
            <FocusPicker
              src={previewUrl}
              value={{ x: form.focus_x, y: form.focus_y }}
              onChange={({ x, y }) =>
                setForm((prev) => ({ ...prev, focus_x: x, focus_y: y }))
              }
              zoomBase={form.zoom_base}
              disabled={isSubmitting}
            />
          </Field>
        )}

        {previewUrl && (
          <Field
            label={
              <>
                Nivel de zoom inicial
                <span className="ml-2 normal-case tracking-normal text-muted">
                  · sube para coches muy reconocibles
                </span>
              </>
            }
          >
            <ZoomBaseField
              value={form.zoom_base}
              onChange={(v) => setForm((prev) => ({ ...prev, zoom_base: v }))}
              disabled={isSubmitting}
            />
          </Field>
        )}
        </div>
        </div>

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
          {isSubmitting
            ? "Subiendo..."
            : assignToDate
            ? `Guardar y asignar al ${assignToDate}`
            : "Guardar coche"}
        </button>
      </form>
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
