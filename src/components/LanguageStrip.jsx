// src/components/LanguageStrip.jsx
// El idioma, en la puerta de entrada (LoginModal): es donde lo busca quien aún
// no tiene perfil ni ha abierto el menú. Es el MISMO conmutador segmentado que
// el Perfil y el Menú (Ajustes.jsx), en una tira suelta en vez de en una fila
// de lista, porque aquí va al pie de un diálogo y no dentro de un grupo.
import { useT, listLocales } from "../i18n";
import { Segmentado } from "./Ajustes";

export default function LanguageStrip() {
  const { t, locale, setLocale } = useT();
  return (
    <div className="idioma-tira">
      <span>{t("header.language")}</span>
      <Segmentado
        etiqueta={t("header.language")}
        valor={locale}
        onCambio={setLocale}
        opciones={listLocales().map((o) => [o.code, o.name])}
      />
    </div>
  );
}
