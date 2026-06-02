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
              className={`
                focus-ring
                rounded-md border px-2 py-0.5 text-[11px] font-medium
                transition-colors duration-150
                ${active
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-white/10 bg-white/[0.02] text-muted hover:text-white"}
              `}
            >
              {opt.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
