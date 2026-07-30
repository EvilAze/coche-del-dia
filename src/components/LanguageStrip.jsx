// src/components/LanguageStrip.jsx
// Selector de idioma inline. Extraído del header (antes vivía dentro del
// UserPopover) para reutilizarlo en el modal de perfil (MyStats) y en el
// modal de login. Es la única superficie de cambio de idioma de la app,
// así que debe estar accesible tanto para logueados como anónimos.

import { useT, listLocales } from "../i18n";
import { haptic } from "../lib/haptics";

export default function LanguageStrip() {
  const { t, locale, setLocale } = useT();
  const options = listLocales();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[9px] uppercase tracking-widest text-muted">
        {t("header.language")}
      </span>
      <div className="flex gap-1">
        {options.map((opt) => {
          const active = opt.code === locale;
          return (
            <button
              key={opt.code}
              type="button"
              onClick={() => { haptic.selection(); setLocale(opt.code); }}
              // El chip del sistema (`pm-chip`), el mismo que filtra países en el
              // Archivo: filete de tinta, esquina viva y, al seleccionar, se
              // INVIERTE a tinta plena. Antes tenía su propio chip en utilidades
              // —`rounded-md`, filete blanco al 10%, fondo blanco al 2% y
              // `hover:text-white`—, heredado de cuando el fondo de la app era
              // oscuro: sobre el papel crema del modo día el filete no se veía y
              // el hover dejaba el idioma en BLANCO SOBRE PAPEL, o sea ilegible
              // justo al señalarlo. `aria-pressed` porque es un conmutador.
              className={`focus-ring pm-chip ${active ? "on" : ""}`}
              aria-pressed={active}
            >
              {opt.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
