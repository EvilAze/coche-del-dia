// src/EliminarCuenta.jsx
// Página pública de solicitud de borrado de cuenta.
//
// Acceso: /eliminar-cuenta (enrutado desde src/index.jsx)
//
// POR QUÉ EXISTE COMO PÁGINA WEB Y NO SOLO COMO BOTÓN EN LA APP: Google Play
// pide DOS caminos para lo mismo. Uno dentro de la app (lo cubre el carnet →
// «Eliminar cuenta») y otro en una URL pública que se pega en el formulario de
// Data safety y que tiene que funcionar SIN instalar nada — para quien ya
// desinstaló y quiere que sus datos se vayan igual. Esta es esa URL.
//
// Es hermana de /privacidad y comparte su voz: es letra pequeña legal, sobre el
// mismo papel que el resto del periódico. Va en español como aquella (las
// páginas legales del proyecto no pasan por i18n).
//
// LO QUE DICE ES LO QUE HACE api/delete-account.js. Si cambia el reparto de qué
// se borra y qué se conserva, esta página miente hasta que se actualice: es la
// declaración que Google contrasta contra el comportamiento real de la app.

import { useEffect } from "react";

// Misma dirección que /privacidad (ImprovMX → inbox real). Si cambia allí,
// cambia aquí.
const ADMIN_CONTACT_EMAIL = "soporte@cochedeldia.com";

const LAST_UPDATED = "6 de agosto de 2026";

export default function EliminarCuenta() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Eliminar tu cuenta · El Coche del Día";

    const metaDesc = document.querySelector('meta[name="description"]');
    const prevDesc = metaDesc?.getAttribute("content");
    if (metaDesc) {
      metaDesc.setAttribute(
        "content",
        "Cómo eliminar tu cuenta de El Coche del Día y qué datos se borran."
      );
    }

    const canonical = document.querySelector('link[rel="canonical"]');
    const prevCanonical = canonical?.getAttribute("href");
    if (canonical) {
      canonical.setAttribute("href", "https://cochedeldia.com/eliminar-cuenta");
    }

    return () => {
      document.title = prevTitle;
      if (metaDesc && prevDesc) metaDesc.setAttribute("content", prevDesc);
      if (canonical && prevCanonical) canonical.setAttribute("href", prevCanonical);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-papel font-serif text-tinta">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="border-b border-border pb-6">
          <p className="pm-kicker">Tu cuenta</p>
          <h1 className="pm-title mt-2 !text-[26px] sm:!text-[32px]">
            Eliminar tu cuenta
          </h1>
          <p className="mt-2 text-sm text-muted">
            Aplicación: <span className="pm-strong">El Coche del Día</span>{" "}
            (com.cochedeldia) · Última actualización: {LAST_UPDATED}
          </p>
        </header>

        <main className="mt-8 space-y-8 text-sm leading-relaxed sm:text-[15px]">
          <Section title="1. Desde la app o desde la web">
            <p>
              Es el camino directo y no hace falta escribir a nadie: el borrado
              es inmediato.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-tinta">
              <li>Abre El Coche del Día e inicia sesión con tu cuenta.</li>
              <li>Abre el menú y entra en tu perfil.</li>
              <li>
                Abajo del todo, en <span className="pm-strong">Ajustes</span>,
                pulsa <span className="pm-strong">Eliminar cuenta</span>.
              </li>
              <li>Confirma. La cuenta se borra en ese momento.</li>
            </ol>
          </Section>

          <Section title="2. Si ya no tienes la app instalada">
            <p>
              Puedes hacerlo igualmente desde el navegador en{" "}
              <a
                href="https://cochedeldia.com"
                className="font-medium text-rojo underline decoration-rojo/40 underline-offset-4 transition hover:decoration-rojo"
              >
                cochedeldia.com
              </a>
              , con los mismos pasos: es la misma cuenta.
            </p>
            <p className="mt-3 text-muted">
              Y si no puedes acceder a tu cuenta, escribe a la dirección de la
              sección 5 desde el correo con el que te registraste. Atendemos la
              solicitud en un plazo máximo de 30 días naturales.
            </p>
          </Section>

          <Section title="3. Qué se borra">
            <ul className="mt-1 list-disc space-y-1 pl-5 text-tinta">
              <li>
                Tu identidad: nombre, dirección de correo y la conexión con tu
                cuenta de Google. No podrás volver a iniciar sesión.
              </li>
              <li>
                Tu nombre de jugador, con lo que desapareces de la clasificación,
                del Salón de Campeones y de los perfiles públicos.
              </li>
              <li>Tus suscripciones a los avisos diarios.</li>
            </ul>
            <p className="mt-3 text-muted">
              El borrado es <span className="pm-strong">inmediato e
              irreversible</span>: no hay periodo de gracia ni forma de
              recuperar la cuenta después.
            </p>
          </Section>

          <Section title="4. Qué se conserva, y por qué">
            <p>
              El registro de las partidas jugadas (fecha, coche e intentos) se
              conserva <span className="pm-strong">sin ninguna referencia a
              ti</span>: sin nombre, sin correo y sin forma de volver a
              asociarlo a una persona.
            </p>
            <p className="mt-3 text-muted">
              El motivo es que las clasificaciones de meses y temporadas ya
              cerrados se calculan a partir de esas partidas. Si desaparecieran,
              un podio de hace medio año cambiaría de campeón y afectaría a
              jugadores que no han pedido nada. Al quedar anónimo, ese registro
              deja de ser un dato personal y solo sostiene el histórico del
              juego.
            </p>
          </Section>

          <Section title="5. Contacto">
            <p>
              Para solicitudes de borrado que no puedas completar tú, o para
              cualquier duda sobre este proceso:
            </p>
            <p className="mt-3">
              <a
                href={`mailto:${ADMIN_CONTACT_EMAIL}`}
                className="font-medium text-rojo underline decoration-rojo/40 underline-offset-4 transition hover:decoration-rojo"
              >
                {ADMIN_CONTACT_EMAIL}
              </a>
            </p>
            <p className="mt-3 text-muted">
              El tratamiento completo de tus datos está descrito en la{" "}
              <a
                href="/privacidad"
                className="font-medium text-rojo underline decoration-rojo/40 underline-offset-4 transition hover:decoration-rojo"
              >
                Política de Privacidad
              </a>
              .
            </p>
          </Section>
        </main>

        <footer className="mt-12 flex flex-col items-start gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            © {new Date().getFullYear()} El Coche del Día · Todos los derechos
            reservados.
          </p>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="
              focus-ring inline-flex items-center gap-2
              rounded-none border border-tinta bg-transparent
              px-4 py-2 font-body text-xs font-semibold uppercase tracking-[0.18em] text-tinta
              transition-colors
              hover:border-rojo hover:text-rojo
              active:translate-y-px
            "
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Volver al inicio
          </button>
        </footer>
      </div>
    </div>
  );
}

// Mismo wrapper de sección que /privacidad: las dos páginas legales tienen que
// leerse como el mismo documento.
function Section({ title, children }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-base font-black text-tinta sm:text-lg">
        {title}
      </h2>
      <div className="text-tinta">{children}</div>
    </section>
  );
}
