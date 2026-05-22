// src/admin/EditCarPanel.jsx
// Panel embebido en AdminTools para editar un coche existente. Lo que
// antes vivía en src/admin/EditCar.jsx, refactorizado para:
//   - No gestionar gate de sesión (lo hace AdminTools una sola vez).
//   - No tocar <title> ni meta robots (también AdminTools).
//   - Aceptar selectedCarId por props (para que el Calendario pueda
//     enviarte directo a editar un coche concreto).
//   - Exponer callbacks onSelectCar / onSaved / onOpenPreview para que
//     el resto de tabs se enteren.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useFreshCatalog } from "../data/catalog";
import DescriptionEnField from "./DescriptionEnField";

const STORAGE_BUCKET = "cars_images";
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
  description_en: "",
  img: "",
  file: null,
};

export default function EditCarPanel({
  selectedCarId = "",
  onSelectCar,
  onSaved,
  onOpenPreview,
}) {
  // useFreshCatalog (no useCatalog) para que un coche recién creado en el
  // tab Añadir aparezca aquí al instante, sin esperar al TTL del CDN.
  const { data: catalog, reload: reloadCatalog } = useFreshCatalog();
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

  const [form, setForm] = useState(initialForm);
  const [originalForm, setOriginalForm] = useState(initialForm);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadingCar, setLoadingCar] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Libera el object URL del preview al desmontar / cambiar archivo.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Carga los datos del coche cuando cambia el id externo. El callback
  // onSelectCar mantiene a AdminTools sincronizado si el usuario cambia
  // de coche dentro del dropdown.
  useEffect(() => {
    if (!selectedCarId) {
      setForm(initialForm);
      setOriginalForm(initialForm);
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

        // get-car fue fusionado en save-car (GET ?id=) para ahorrar slot
        // de función serverless en plan Hobby de Vercel.
        const res = await fetch(
          `/api/admin/save-car?id=${encodeURIComponent(selectedCarId)}`,
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
          description_en: data.description_en || "",
          img: data.img || "",
          file: null,
        };
        setForm(next);
        setOriginalForm(next);
        setPreviewUrl(null);
      } catch (err) {
        if (!cancelled) {
          console.error("[EditCarPanel] get-car:", err);
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
  }, [selectedCarId]);

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

  const dirty = useMemo(() => {
    if (!selectedCarId) return false;
    return (
      form.marca !== originalForm.marca ||
      form.modelo !== originalForm.modelo ||
      form.anio !== originalForm.anio ||
      form.pais !== originalForm.pais ||
      form.description !== originalForm.description ||
      form.description_en !== originalForm.description_en ||
      form.file != null
    );
  }, [form, originalForm, selectedCarId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting || !selectedCarId || !dirty) return;

    const marca = form.marca.trim();
    const modelo = form.modelo.trim();
    const pais = form.pais.trim();
    const description = form.description.trim();
    const descriptionEn = form.description_en.trim();
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

      const patch = { id: selectedCarId };
      if (marca !== originalForm.marca) patch.marca = marca;
      if (modelo !== originalForm.modelo) patch.modelo = modelo;
      if (form.anio !== originalForm.anio) patch.anio = anioNum;
      if (pais !== originalForm.pais) patch.pais = pais;
      if (description !== originalForm.description) patch.description = description;
      if (descriptionEn !== originalForm.description_en) {
        patch.description_en = descriptionEn;
      }
      if (newImageUrl) patch.image_url = newImageUrl;

      const res = await fetch("/api/admin/save-car", {
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

      reloadCatalog().catch((err) =>
        console.warn("[EditCarPanel] reloadCatalog post-save:", err)
      );

      const updated = data.car;
      const nextForm = {
        marca: updated.marca || "",
        modelo: updated.modelo || "",
        anio: updated.anio != null ? String(updated.anio) : "",
        pais: updated.pais || "",
        description: updated.description || "",
        description_en: updated.description_en || "",
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

      // Notifica al shell para que refresque el calendario u otros tabs.
      if (typeof onSaved === "function") onSaved(updated);
    } catch (err) {
      console.error("[EditCarPanel] save:", err);
      setFeedback({
        type: "error",
        message: err?.message || "No se pudo guardar el coche.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const activePreview = previewUrl || form.img || null;

  return (
    <div className="flex flex-col gap-5">
      <header className="border-b border-border pb-3">
        <h2 className="font-display text-2xl tracking-widest text-white">
          Editar coche
        </h2>
        <p className="mt-1 text-xs text-muted">
          Hot-swap del catálogo. Los cambios se reflejan en el juego al
          instante (la imagen tarda hasta 60 s por el CDN).
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
            value={selectedCarId}
            onChange={(e) => {
              if (typeof onSelectCar === "function") onSelectCar(e.target.value);
            }}
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

        {selectedCarId && !loadingCar && (
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
                  Descripción (ES)
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

            {typeof onOpenPreview === "function" && (
              <button
                type="button"
                onClick={() => onOpenPreview(selectedCarId)}
                className="
                  rounded-xl border border-white/10 bg-black/40 px-4 py-3
                  text-sm font-semibold uppercase tracking-[0.18em] text-white
                  transition hover:border-accent
                "
              >
                Probar en preview →
              </button>
            )}
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
          disabled={isSubmitting || !selectedCarId || !dirty}
          className="
            h-12 w-full rounded-xl bg-accent font-display text-lg
            tracking-widest text-bg-primary transition
            hover:bg-accent-dark active:scale-[0.98]
            disabled:cursor-not-allowed disabled:opacity-40
          "
        >
          {isSubmitting
            ? "Guardando..."
            : !selectedCarId
            ? "Selecciona un coche"
            : !dirty
            ? "Sin cambios"
            : "Guardar cambios"}
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
