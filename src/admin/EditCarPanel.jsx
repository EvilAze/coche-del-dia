// src/admin/EditCarPanel.jsx
// Panel embebido en AdminTools para editar un coche existente. Lo que
// antes vivía en src/admin/EditCar.jsx, refactorizado para:
//   - No gestionar gate de sesión (lo hace AdminTools una sola vez).
//   - No tocar <title> ni meta robots (también AdminTools).
//   - Aceptar selectedCarId por props (para que el Calendario pueda
//     enviarte directo a editar un coche concreto).
//   - Exponer callbacks onSelectCar / onSaved / onOpenPreview para que
//     el resto de tabs se enteren.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useFreshCatalog } from "../data/catalog";
import DescriptionEnField from "./DescriptionEnField";
import DescriptionEsField from "./DescriptionEsField";
import FichaRendimiento from "./FichaRendimiento";
import FocusPicker from "./FocusPicker";
import ZoomBaseField from "./ZoomBaseField";
import { DEFAULT_ZOOM_BASE } from "../lib/zoom.js";

const STORAGE_BUCKET = "cars_images";
const CURRENT_YEAR = new Date().getFullYear();

function sanitizeFilename(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
  // Punto focal del crop del zoom — 0.5/0.5 = centro (compat con el
  // comportamiento histórico).
  focus_x: 0.5,
  focus_y: 0.5,
  // Zoom inicial (dificultad). Default = comportamiento histórico.
  zoom_base: DEFAULT_ZOOM_BASE,
  // Etiquetas de Temporada Temática, como texto separado por comas (la API
  // recibe y devuelve array; el form trabaja con string por comodidad de
  // edición). El servidor las normaliza a slug — ver api/_lib/season-theme.js.
  tags: "",
  // Vídeo del coche (temporadas presentadas). El form guarda lo que se pegue —
  // ID o URL de YouTube— y el servidor lo normaliza a ID de 11 caracteres (ver
  // api/_lib/video-id.js). Vacío = el coche no tiene vídeo.
  video_id: "",
};

// "grupo-b, rally" → ["grupo-b", "rally"]. El saneado real (slug, dedupe,
// tope) lo hace el servidor; aquí solo troceamos.
function parseTagList(raw) {
  return String(raw || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function EditCarPanel({
  selectedCarId = "",
  onSelectCar,
  onSaved,
  onDeleted,
  onOpenPreview,
  overrides,
  onFormChange,
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

  // Filtro de "solo pendientes de imagen": cuando el admin tiene cientos
  // de coches en catálogo, encontrar a cuáles les falta imagen es una
  // necesidad recurrente (ej: batch de 200 inserts vía SQL). Toggle
  // simple por encima del dropdown que reduce la lista a los image_ready=FALSE.
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const pendingCount = useMemo(
    () => CARS.filter((c) => c.image_ready === false).length,
    [CARS]
  );
  const visibleCars = useMemo(
    () =>
      showOnlyPending
        ? carsSorted.filter((c) => c.image_ready === false)
        : carsSorted,
    [carsSorted, showOnlyPending]
  );

  const [form, setForm] = useState(initialForm);
  const [originalForm, setOriginalForm] = useState(initialForm);
  // Intel de dificultad observada (DDA Arquitectura A). La rellena el GET de
  // save-car desde la telemetría; null si el coche aún no tiene datos.
  const [difficulty, setDifficulty] = useState(null);
  // Ficha de rendimiento. Va POR SEPARADO del GET del coche a propósito: la
  // sirve /api/admin/car-report leyendo daily_stats en vivo, mientras que
  // `difficulty` sigue saliendo de las columnas cacheadas de cars — que son las
  // que alimentan la sugerencia de zoom. Dos fuentes porque son dos cosas, y
  // porque así la ficha no se cae si el recálculo vuelve a romperse.
  const [ficha, setFicha] = useState(null);
  const [fichaCargando, setFichaCargando] = useState(false);
  const [fichaError, setFichaError] = useState(null);
  // Análisis de imagen con IA (DDA Arquitectura B). Estado local de la llamada.
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadingCar, setLoadingCar] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [usedCarIds, setUsedCarIds] = useState(new Set());

  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // Carga la lista de coches ya jugados (hoy o pasado) para marcarlos en el dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session: s },
        } = await supabase.auth.getSession();
        if (!s) return;
        const res = await fetch("/api/admin/schedule", {
          headers: { Authorization: `Bearer ${s.access_token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && Array.isArray(body.usedCarIds)) {
          setUsedCarIds(new Set(body.usedCarIds));
        }
      } catch (err) {
        console.warn("[EditCarPanel] no se pudo cargar usedCarIds:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Libera el object URL del preview al desmontar / cambiar archivo.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Ref al <input type="file"> para limpiarlo al cambiar de coche / tras guardar
  // SIN remontar el input. El `key={form.file ? …}` anterior lo remontaba a mitad
  // de la interacción con el diálogo del sistema → bug de "clicar dos veces".
  const fileInputRef = useRef(null);
  useEffect(() => {
    if (!form.file && fileInputRef.current) fileInputRef.current.value = "";
  }, [form.file]);

  // Carga los datos del coche cuando cambia el id externo. El callback
  // onSelectCar mantiene a AdminTools sincronizado si el usuario cambia
  // de coche dentro del dropdown.
  useEffect(() => {
    if (!selectedCarId) {
      setForm(initialForm);
      setOriginalForm(initialForm);
      setDifficulty(null);
      setAiResult(null);
      setAiError(null);
      setPreviewUrl(null);
      setFeedback(null);
      setDeleteConfirm(false);
      return;
    }
    setDeleteConfirm(false);

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
          focus_x: typeof data.focus_x === "number" ? data.focus_x : 0.5,
          focus_y: typeof data.focus_y === "number" ? data.focus_y : 0.5,
          zoom_base:
            typeof data.zoom_base === "number" ? data.zoom_base : DEFAULT_ZOOM_BASE,
          tags: Array.isArray(data.tags) ? data.tags.join(", ") : "",
          video_id: data.video_id || "",
        };

        const ovr = overridesRef.current;
        const hasOverrides = ovr && String(ovr.carId) === String(selectedCarId);
        if (hasOverrides) {
          if (ovr.zoom_base !== undefined) next.zoom_base = ovr.zoom_base;
          if (ovr.focus_x !== undefined) next.focus_x = ovr.focus_x;
          if (ovr.focus_y !== undefined) next.focus_y = ovr.focus_y;
          if (ovr.img && ovr.img !== data.img) {
            next.img = ovr.img;
          }
        }

        setForm(next);
        setOriginalForm(next);
        setDifficulty(data.difficulty ?? null);
        setAiResult(null);
        setAiError(null);
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

  // Ficha de rendimiento del coche seleccionado. Petición aparte de la del
  // coche porque son dos fuentes distintas (ver el estado `ficha` arriba).
  useEffect(() => {
    if (!selectedCarId) {
      setFicha(null);
      setFichaError(null);
      return;
    }
    let cancelado = false;
    setFichaCargando(true);
    setFichaError(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Sin sesión");
        const res = await fetch(
          `/api/admin/car-report?id=${encodeURIComponent(selectedCarId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        // Mirar res.ok ANTES de parsear: un 504 de Vercel llega como respuesta
        // correcta con HTML dentro, y el .json() reventaría con un SyntaxError
        // que no se parece en nada a la causa (regla 21 del CLAUDE.md).
        if (!res.ok) {
          const cuerpo = await res.json().catch(() => ({}));
          throw new Error(cuerpo?.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelado) setFicha(data);
      } catch (err) {
        if (!cancelado) {
          console.error("[EditCarPanel] car-report:", err);
          setFichaError(err?.message || "Error de red");
          setFicha(null);
        }
      } finally {
        if (!cancelado) setFichaCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [selectedCarId]);

  // Al entrar sin coche elegido, abrir en el de HOY. Es lo que más veces se
  // viene a mirar, y así el panel arranca enseñando algo en vez de un
  // desplegable vacío.
  //
  // Se pide car-report SIN id, que ya resuelve hoy en el servidor: pedir el
  // calendario entero para quedarnos con un campo sería traer catorce días para
  // tirar trece. Silencioso si falla — es una comodidad, no una función: quien
  // no la note seguirá eligiendo a mano.
  useEffect(() => {
    if (selectedCarId) return;
    let cancelado = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch("/api/admin/car-report", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelado && data?.carId) onSelectCar?.(data.carId);
      } catch {
        // Silencio deliberado: ver arriba.
      }
    })();
    return () => { cancelado = true; };
    // Solo al montar sin selección: si se añade selectedCarId a las deps, al
    // deseleccionar un coche volvería a saltar al de hoy y no se podría vaciar
    // el formulario a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      form.file != null ||
      form.focus_x !== originalForm.focus_x ||
      form.focus_y !== originalForm.focus_y ||
      form.zoom_base !== originalForm.zoom_base ||
      form.tags !== originalForm.tags ||
      form.video_id !== originalForm.video_id
    );
  }, [form, originalForm, selectedCarId]);

  async function handleDelete() {
    if (isDeleting || !selectedCarId) return;
    setIsDeleting(true);
    setFeedback(null);
    try {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      if (!s) throw new Error("Sin sesión");

      const res = await fetch(
        `/api/admin/save-car?id=${encodeURIComponent(selectedCarId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${s.access_token}` },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      reloadCatalog().catch(() => {});
      setDeleteConfirm(false);
      if (typeof onDeleted === "function") onDeleted(selectedCarId);
    } catch (err) {
      console.error("[EditCarPanel] delete:", err);
      setDeleteConfirm(false);
      setFeedback({ type: "error", message: err?.message || "No se pudo borrar el coche." });
    } finally {
      setIsDeleting(false);
    }
  }

  // DDA Arquitectura B: pide a la IA que analice la foto guardada y rellena
  // zoom_base + punto focal con su sugerencia (queda dirty → se guarda con el
  // botón normal). Human-in-loop: el admin revisa antes de guardar. Analiza la
  // imagen YA guardada (form.img); si hay una foto nueva sin guardar, primero
  // hay que guardarla.
  async function handleAnalyze() {
    if (aiAnalyzing || !form.img) return;
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      if (!s) throw new Error("Sin sesión");

      const res = await fetch("/api/admin/analyze-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.access_token}`,
        },
        body: JSON.stringify({
          image_url: form.img,
          marca: form.marca,
          modelo: form.modelo,
          anio: form.anio,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setAiResult(data);
      // Aplica zoom + foco sugeridos al formulario (no guarda solo).
      setForm((prev) => ({
        ...prev,
        zoom_base: data.suggestedZoomBase,
        focus_x: data.focusX,
        focus_y: data.focusY,
      }));
    } catch (err) {
      console.error("[EditCarPanel] analyze:", err);
      setAiError(err?.message || "No se pudo analizar la imagen.");
    } finally {
      setAiAnalyzing(false);
    }
  }

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
      if (form.focus_x !== originalForm.focus_x) patch.focus_x = form.focus_x;
      if (form.focus_y !== originalForm.focus_y) patch.focus_y = form.focus_y;
      if (form.zoom_base !== originalForm.zoom_base) patch.zoom_base = form.zoom_base;
      // Se manda el array aunque quede vacío: `[]` significa "quítale todas las
      // etiquetas", y sin esto no habría forma de desetiquetar un coche.
      if (form.tags !== originalForm.tags) patch.tags = parseTagList(form.tags);
      // Igual que tags: se manda aunque quede vacío, porque "" es la única
      // forma de QUITARLE el vídeo a un coche.
      if (form.video_id !== originalForm.video_id) patch.video_id = form.video_id.trim();

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
        focus_x: typeof updated.focus_x === "number" ? updated.focus_x : 0.5,
        focus_y: typeof updated.focus_y === "number" ? updated.focus_y : 0.5,
        zoom_base:
          typeof updated.zoom_base === "number" ? updated.zoom_base : DEFAULT_ZOOM_BASE,
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

  // Notificar al shell (AdminTools) los cambios en tiempo real para mantener Preview sincronizado.
  useEffect(() => {
    // Evitamos notificar durante la carga inicial del coche para evitar machacar los datos reales en el shell.
    if (loadingCar || originalForm === initialForm) return;

    if (selectedCarId && typeof onFormChange === "function") {
      onFormChange(selectedCarId, {
        zoom_base: form.zoom_base,
        focus_x: form.focus_x,
        focus_y: form.focus_y,
        img: activePreview,
      });
    }
  }, [selectedCarId, loadingCar, originalForm, form.zoom_base, form.focus_x, form.focus_y, activePreview, onFormChange]);

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
                {pendingCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-amber-300">
                      📷 {pendingCount} sin imagen
                    </span>
                  </>
                )}
              </span>
            </>
          }
        >
          {pendingCount > 0 && (
            // Toggle de filtro: aparece SOLO si hay pendientes. Cuando no
            // hay nada que filtrar, no metemos chrome extra.
            <label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-[11px] uppercase tracking-widest text-muted">
              <input
                type="checkbox"
                checked={showOnlyPending}
                onChange={(e) => setShowOnlyPending(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-300"
              />
              Solo pendientes de imagen
            </label>
          )}
          <select
            value={selectedCarId}
            onChange={(e) => {
              if (typeof onSelectCar === "function") onSelectCar(e.target.value);
            }}
            disabled={isSubmitting || CARS.length === 0}
            className={selectClass}
          >
            <option value="">— Selecciona —</option>
            {visibleCars.map((c) => {
              const isUsed = usedCarIds.has(c.id);
              return (
                <option key={c.id} value={c.id}>
                  {c.image_ready === false ? "📷 " : ""}
                  {isUsed ? "📅 " : ""}
                  {c.marca} {c.modelo} ({c.anio}){isUsed ? " (Coche del día)" : ""}
                </option>
              );
            })}
          </select>
        </Field>

        {loadingCar && (
          <p className="animate-pulse text-xs uppercase tracking-widest text-muted">
            Cargando datos del coche...
          </p>
        )}

        {selectedCarId && !loadingCar && (
          <>
            {usedCarIds.has(selectedCarId) && (
              <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                📅 Este coche ya ha sido coche del día anteriormente y no se puede repetir en el calendario.
              </div>
            )}
            {/* Escritorio: identidad a la izquierda, imagen + zoom a la derecha. */}
            <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
            <div className="flex flex-col gap-5">
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

            <Field label="Etiquetas (temporadas)">
              <input
                type="text"
                value={form.tags}
                onChange={(e) => updateField("tags", e.target.value)}
                placeholder="grupo-b, rally"
                maxLength={300}
                disabled={isSubmitting}
                autoComplete="off"
                className={inputClass}
              />
              <span className="text-[11px] leading-relaxed text-muted">
                Separadas por comas. Solo sirven para que una Temporada Temática
                pueda filtrar por ellas — no se muestran al jugador ni salen del
                servidor. Úsalas para temas que no se deducen de marca, país o
                año (Grupo B, prototipos de Le Mans, coches de película).
              </span>
            </Field>

            <Field label="Vídeo (YouTube)">
              <input
                type="text"
                value={form.video_id}
                onChange={(e) => updateField("video_id", e.target.value)}
                placeholder="Pega el enlace del vídeo, o su ID"
                maxLength={200}
                disabled={isSubmitting}
                autoComplete="off"
                className={inputClass}
              />
              <span className="text-[11px] leading-relaxed text-muted">
                Pega el enlace tal cual (watch, youtu.be, shorts…): se guarda
                solo el ID. Aparece como «Ver el vídeo» sobre la foto del panel
                de resultado, al terminar la partida — nunca antes, porque el
                vídeo delata el coche. Vacío = sin vídeo, y el panel queda como
                siempre.
              </span>
            </Field>

            <Field label="Descripción (ES)">
              <DescriptionEsField
                value={form.description}
                onChange={(v) => updateField("description", v)}
                marca={form.marca}
                modelo={form.modelo}
                anio={form.anio}
                pais={form.pais}
                disabled={isSubmitting}
                inputClass={inputClass}
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
            </div>

            <div className="mt-5 flex flex-col gap-5 lg:mt-0">
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
              />
            </Field>

            {/* Asistente IA (DDA Arquitectura B): analiza la foto guardada y
                propone zoom inicial + punto focal en frío. Rellena el
                formulario; el admin revisa y guarda. */}
            <Field
              label={
                <>
                  Asistente de dificultad (IA)
                  <span className="ml-2 normal-case tracking-normal text-muted">
                    · analiza la foto y sugiere zoom + foco
                  </span>
                </>
              }
            >
              <AiAssistant
                analyzing={aiAnalyzing}
                result={aiResult}
                error={aiError}
                disabled={isSubmitting || !form.img}
                onAnalyze={handleAnalyze}
              />
            </Field>

            {/* Punto focal del zoom. La imagen activa es la nueva foto
                seleccionada (previewUrl) si la hay, o la actual guardada
                (form.img). Reseteamos el foco a 0.5/0.5 cuando el admin
                sube una foto nueva para que no arrastre coordenadas del
                coche anterior — pero solo en la primera selección, no
                cada vez que mueve el punto. */}
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
                src={activePreview || null}
                value={{ x: form.focus_x, y: form.focus_y }}
                onChange={({ x, y }) =>
                  setForm((prev) => ({ ...prev, focus_x: x, focus_y: y }))
                }
                zoomBase={form.zoom_base}
                disabled={isSubmitting}
              />
            </Field>

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
              <DifficultyIntel
                difficulty={difficulty}
                currentZoomBase={form.zoom_base}
                disabled={isSubmitting}
                onApply={(suggested) =>
                  setForm((prev) => ({ ...prev, zoom_base: suggested }))
                }
              />
            </Field>

            <Field label="Rendimiento del coche">
              <FichaRendimiento
                ficha={ficha}
                cargando={fichaCargando}
                error={fichaError}
              />
            </Field>

            {typeof onOpenPreview === "function" && (
              <button
                type="button"
                onClick={() =>
                  onOpenPreview(selectedCarId, {
                    zoom_base: form.zoom_base,
                    focus_x: form.focus_x,
                    focus_y: form.focus_y,
                    img: activePreview,
                  })
                }
                className="
                  rounded-xl border border-white/10 bg-black/40 px-4 py-3
                  text-sm font-semibold uppercase tracking-[0.18em] text-white
                  transition hover:border-accent
                "
              >
                Probar en preview →
              </button>
            )}
            </div>
            </div>
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
          disabled={isSubmitting || isDeleting || !selectedCarId || !dirty}
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

        {selectedCarId && !deleteConfirm && (
          <button
            type="button"
            onClick={() => setDeleteConfirm(true)}
            disabled={isSubmitting || isDeleting}
            className="
              h-10 w-full rounded-xl border border-red-400/30 bg-transparent
              text-sm uppercase tracking-[0.18em] text-red-400/70
              transition hover:border-red-400 hover:text-red-400
              disabled:cursor-not-allowed disabled:opacity-40
            "
          >
            Borrar coche
          </button>
        )}

        {selectedCarId && deleteConfirm && (
          <div className="rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-4 flex flex-col gap-3">
            <p className="text-sm text-red-300">
              ¿Seguro? Esta acción no se puede deshacer. Solo se pueden borrar
              coches que no tengan asignaciones en el calendario.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="
                  flex-1 h-10 rounded-xl bg-red-500 font-display text-sm
                  uppercase tracking-[0.18em] text-white transition
                  hover:bg-red-600 active:scale-[0.98]
                  disabled:cursor-not-allowed disabled:opacity-40
                "
              >
                {isDeleting ? "Borrando..." : "Sí, borrar"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                disabled={isDeleting}
                className="
                  flex-1 h-10 rounded-xl border border-white/10 bg-black/40
                  text-sm uppercase tracking-[0.18em] text-muted
                  transition hover:border-white/30 hover:text-white
                  disabled:cursor-not-allowed disabled:opacity-40
                "
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
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

// Sugerencia de zoom del bucle de telemetría (DDA Arq. A). Las MÉTRICAS ya no
// están aquí: se las llevó FichaRendimiento, que las lee en vivo desde
// daily_stats. Esto se queda solo con lo que sí sale de
// cars.suggested_zoom_base, que es otra cosa — human-in-loop: nada se aplica
// solo.
//
// Tener las mismas cifras en dos sitios y desde dos fuentes distintas era pedir
// que un día dijeran cosas diferentes y nadie se enterara.
function DifficultyIntel({ difficulty, currentZoomBase, onApply, disabled }) {
  const suggestedZoomBase = difficulty?.suggestedZoomBase ?? null;
  if (suggestedZoomBase == null) return null;

  const canApply = Math.abs(suggestedZoomBase - currentZoomBase) >= 0.1;
  if (!canApply) {
    return (
      <p className="mt-2 text-[11px] text-emerald-300/80">
        La telemetría sugiere {suggestedZoomBase.toFixed(1)}×, que es el valor actual.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onApply?.(suggestedZoomBase)}
      disabled={disabled}
      className="mt-2 self-start rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] uppercase tracking-widest text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Aplicar sugerencia: {suggestedZoomBase.toFixed(1)}×
    </button>
  );
}

// Caja de una cifra con su rótulo. La usa AiAssistant para la iconicidad y el
// zoom propuesto. Vivía aquí desde que la compartía con el bloque de
// dificultad; ese bloque se fue a FichaRendimiento (que tiene su propia
// `Cifra`, con el rótulo centrado), pero esta se queda porque el asistente de
// IA la sigue necesitando.
function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="font-display text-sm text-white">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-muted">{label}</div>
    </div>
  );
}

// Asistente IA (DDA Arq. B): botón de análisis + resultado. Al aplicar, el
// zoom y el foco ya quedan rellenos en el formulario (dirty); aquí solo se
// muestra qué propuso y por qué.
function AiAssistant({ analyzing, result, error, disabled, onAnalyze }) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onAnalyze}
        disabled={disabled || analyzing}
        className="self-start rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {analyzing ? "Analizando…" : "✨ Analizar con IA"}
      </button>

      {!result && !error && (
        <p className="text-[11px] text-muted">
          Mide cuán reconocible es el coche en la foto y rellena el zoom inicial
          y el punto focal. Analiza la imagen ya guardada.
        </p>
      )}

      {error && (
        <p className="text-[11px] text-red-300">{error}</p>
      )}

      {result && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
          <div className="grid grid-cols-2 gap-2 text-center">
            <Metric label="iconicidad" value={`${result.iconicidad}/10`} />
            <Metric label="zoom sugerido" value={`${result.suggestedZoomBase?.toFixed(1)}×`} />
          </div>
          {result.rasgoDistintivo && (
            <p className="text-[11px] text-white/80">
              Rasgo: <span className="text-white">{result.rasgoDistintivo}</span>
            </p>
          )}
          {result.razon && (
            <p className="text-[11px] text-muted">{result.razon}</p>
          )}
          <p className="text-[10px] text-emerald-300/80">
            Aplicado al zoom y al foco. Revisa y pulsa «Guardar cambios».
          </p>
        </div>
      )}
    </div>
  );
}
