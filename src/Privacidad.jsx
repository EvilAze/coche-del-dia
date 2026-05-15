// src/Privacidad.jsx
// Página pública de Política de Privacidad. Cumple con los requisitos de
// la pantalla de consentimiento de Google OAuth: explica qué datos se
// recopilan, para qué, dónde se guardan, y cómo el usuario puede pedir
// su borrado.
//
// Acceso: /privacidad  (enrutado desde src/index.js)
//
// Diseño deliberadamente sobrio — fondo neutro oscuro, jerarquía clara
// por tipografía y mucho aire blanco para que sea legible y "serio".

import { useEffect } from "react";

// Dirección de contacto para solicitudes (borrado, dudas, etc.). Si
// cambias el correo del admin, sustitúyelo aquí.
const ADMIN_CONTACT_EMAIL = "ievilaze@gmail.com";

// Fecha de última actualización del documento, en formato humano.
const LAST_UPDATED = "16 de mayo de 2026";

export default function Privacidad() {
  // Título de pestaña y meta-tag descriptivo. SÍ queremos que sea
  // indexable (es una página informativa pública, útil para SEO de
  // confianza), así que NO añadimos noindex.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Política de Privacidad · CarGuessr";
    return () => {
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-neutral-900 text-neutral-200">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="border-b border-neutral-800 pb-6">
          <p className="text-[10px] uppercase tracking-[0.28em] text-amber-500">
            Documento legal
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Política de Privacidad
          </h1>
          <p className="mt-2 text-sm text-neutral-400">
            Aplicación: <span className="text-neutral-200">CarGuessr</span> ·
            Última actualización: {LAST_UPDATED}
          </p>
        </header>

        <main className="mt-8 space-y-8 text-sm leading-relaxed sm:text-[15px]">
          <Section title="1. Datos que recopilamos">
            <p>
              CarGuessr únicamente recopila los siguientes datos personales,
              proporcionados por tu cuenta de Google en el momento del inicio
              de sesión:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-neutral-300">
              <li>Tu nombre.</li>
              <li>Tu dirección de correo electrónico.</li>
            </ul>
            <p className="mt-3 text-neutral-400">
              No solicitamos, recopilamos ni almacenamos ningún otro dato
              personal por encima de los anteriores.
            </p>
          </Section>

          <Section title="2. Finalidad del tratamiento">
            <p>
              La única finalidad de estos datos es la creación de una cuenta
              de usuario en CarGuessr que permita:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-neutral-300">
              <li>
                Guardar tu progreso de juego (intentos, victorias, derrotas).
              </li>
              <li>
                Mantener tu colección personal en el Garaje (álbum de coches
                adivinados).
              </li>
              <li>
                Registrar tu puntuación en el ranking diario y global.
              </li>
            </ul>
            <p className="mt-3 text-neutral-400">
              Los datos no se utilizan para ninguna otra finalidad distinta
              de las indicadas.
            </p>
          </Section>

          <Section title="3. Almacenamiento y seguridad">
            <p>
              Los datos se almacenan de forma segura en la infraestructura de{" "}
              <span className="text-neutral-100">Supabase</span>, un proveedor
              de servicios de base de datos que aplica cifrado de los datos
              en reposo y en tránsito.
            </p>
            <p className="mt-3 text-neutral-400">
              CarGuessr aplica además políticas de control de acceso a nivel
              de fila (Row Level Security) para garantizar que cada usuario
              únicamente pueda consultar y modificar sus propios datos.
            </p>
          </Section>

          <Section title="4. Compartición con terceros">
            <p>
              CarGuessr <span className="text-white">no comparte</span>,{" "}
              <span className="text-white">no vende</span> ni cede tu nombre
              o tu correo electrónico a terceros bajo ninguna circunstancia.
            </p>
            <p className="mt-3 text-neutral-400">
              Tampoco utilizamos tu correo electrónico para enviar
              comunicaciones promocionales, publicitarias ni de ningún otro
              tipo. CarGuessr no envía correos electrónicos a sus usuarios.
            </p>
          </Section>

          <Section title="5. Derecho de supresión (borrado de datos)">
            <p>
              Puedes solicitar la eliminación íntegra de tu cuenta y de
              todos los datos asociados (estadísticas, garaje, historial de
              partidas) en cualquier momento.
            </p>
            <p className="mt-3 text-neutral-400">
              Para ejercer este derecho, envía un correo electrónico a la
              dirección indicada en la sección de contacto, identificando
              la cuenta que deseas suprimir. La solicitud se atenderá en un
              plazo máximo de 30 días naturales.
            </p>
          </Section>

          <Section title="6. Contacto">
            <p>
              Para cualquier consulta relacionada con esta política, o para
              ejercer tus derechos de acceso, rectificación o supresión,
              puedes escribir a:
            </p>
            <p className="mt-3">
              <a
                href={`mailto:${ADMIN_CONTACT_EMAIL}`}
                className="font-medium text-amber-400 underline decoration-amber-700 underline-offset-4 transition hover:text-amber-300"
              >
                {ADMIN_CONTACT_EMAIL}
              </a>
            </p>
          </Section>
        </main>

        <footer className="mt-12 flex flex-col items-start gap-4 border-t border-neutral-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-neutral-500">
            © {new Date().getFullYear()} CarGuessr · Todos los derechos
            reservados.
          </p>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="
              inline-flex items-center gap-2
              rounded-lg border border-neutral-700 bg-neutral-800
              px-4 py-2 text-sm font-medium text-neutral-200
              transition-colors
              hover:border-neutral-500 hover:bg-neutral-700 hover:text-white
              active:scale-95
              focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500
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

// Pequeño wrapper para encabezado + cuerpo de cada sección. Centraliza
// el tracking, el peso y el spacing para que las 6 secciones queden
// perfectamente alineadas tipográficamente.
function Section({ title, children }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-white sm:text-lg">
        {title}
      </h2>
      <div className="text-neutral-300">{children}</div>
    </section>
  );
}
