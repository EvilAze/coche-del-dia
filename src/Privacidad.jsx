// src/Privacidad.jsx
// Página pública de Política de Privacidad. Cumple con los requisitos de
// la pantalla de consentimiento de Google OAuth: explica qué datos se
// recopilan, para qué, dónde se guardan, y cómo el usuario puede pedir
// su borrado.
//
// Acceso: /privacidad  (enrutado desde src/index.js)
//
// Diseño deliberadamente sobrio — jerarquía clara por tipografía y mucho aire
// para que sea legible y "serio".
//
// Migrada al sistema «Prensa del motor»: era la última pantalla que seguía en
// la paleta `neutral-*` sobre fondo oscuro, con acentos ámbar de un tema ya
// retirado. En una web que es un periódico, la letra pequeña legal es
// exactamente eso: letra pequeña, sobre el mismo papel que el resto.

import { useEffect } from "react";

// Dirección de contacto para solicitudes (borrado, dudas, etc.). Si
// cambias el correo del admin, sustitúyelo aquí. La dirección se sirve
// vía ImprovMX (forwarder gratuito) hacia el inbox real de Gmail —
// para el usuario final solo existe el correo con dominio propio.
const ADMIN_CONTACT_EMAIL = "soporte@cochedeldia.com";

// Fecha de última actualización del documento, en formato humano.
// IMPORTANTE: actualizar esta fecha CADA VEZ que cambies el contenido
// del documento. GDPR Art. 13 exige que el usuario sepa cuándo ha sido
// la última revisión de los términos que está aceptando implícitamente.
const LAST_UPDATED = "6 de agosto de 2026";

export default function Privacidad() {
  // Título de pestaña y meta-tag descriptivo. SÍ queremos que sea
  // indexable (es una página informativa pública, útil para SEO de
  // confianza), así que NO añadimos noindex.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Política de Privacidad · El Coche del Día";

    const metaDesc = document.querySelector('meta[name="description"]');
    const prevDesc = metaDesc?.getAttribute("content");
    if (metaDesc) {
      metaDesc.setAttribute("content", "Política de privacidad de El Coche del Día. Información sobre datos recopilados, cookies y derechos del usuario.");
    }

    const canonical = document.querySelector('link[rel="canonical"]');
    const prevCanonical = canonical?.getAttribute("href");
    if (canonical) {
      canonical.setAttribute("href", "https://cochedeldia.com/privacidad");
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
          <p className="pm-kicker">Documento legal</p>
          <h1 className="pm-title mt-2 !text-[26px] sm:!text-[32px]">
            Política de Privacidad
          </h1>
          <p className="mt-2 text-sm text-muted">
            Aplicación: <span className="pm-strong">El Coche del Día</span> ·
            Última actualización: {LAST_UPDATED}
          </p>
        </header>

        <main className="mt-8 space-y-8 text-sm leading-relaxed sm:text-[15px]">
          <Section title="1. Datos que recopilamos">
            <p>
              El Coche del Día únicamente recopila los siguientes datos personales,
              proporcionados por tu cuenta de Google en el momento del inicio
              de sesión:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-tinta">
              <li>Tu nombre.</li>
              <li>Tu dirección de correo electrónico.</li>
            </ul>
            <p className="mt-3 text-muted">
              No solicitamos, recopilamos ni almacenamos ningún otro dato
              personal por encima de los anteriores.
            </p>
          </Section>

          <Section title="2. Finalidad del tratamiento">
            <p>
              La única finalidad de estos datos es la creación de una cuenta
              de usuario en El Coche del Día que permita:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-tinta">
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
            <p className="mt-3 text-muted">
              Los datos no se utilizan para ninguna otra finalidad distinta
              de las indicadas.
            </p>
          </Section>

          <Section title="3. Almacenamiento y seguridad">
            <p>
              Los datos se almacenan de forma segura en la infraestructura de{" "}
              <span className="pm-strong">Supabase</span>, un proveedor
              de servicios de base de datos que aplica cifrado de los datos
              en reposo y en tránsito.
            </p>
            <p className="mt-3 text-muted">
              El Coche del Día aplica además políticas de control de acceso a nivel
              de fila (Row Level Security) para garantizar que cada usuario
              únicamente pueda consultar y modificar sus propios datos.
            </p>
          </Section>

          <Section title="4. Compartición con terceros">
            <p>
              El Coche del Día <span className="pm-strong">no comparte</span>,{" "}
              <span className="pm-strong">no vende</span> ni cede tu nombre
              o tu correo electrónico a terceros bajo ninguna circunstancia.
            </p>
            <p className="mt-3 text-muted">
              Tampoco utilizamos tu correo electrónico para enviar
              comunicaciones promocionales, publicitarias ni de ningún otro
              tipo. El Coche del Día no envía correos electrónicos a sus usuarios.
            </p>
          </Section>

          <Section title="5. Cookies y servicios técnicos">
            <p>
              El Coche del Día utiliza únicamente cookies{" "}
              <span className="pm-strong">estrictamente necesarias</span>{" "}
              para el funcionamiento del juego. Conforme al artículo 22.2
              de la LSSI y la Directiva ePrivacy, estas cookies no
              requieren consentimiento previo:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-tinta">
              <li>
                <span className="pm-strong">Cookie de sesión anónima:</span>{" "}
                firmada, permite contar tus intentos del día y mantener tu
                progreso sin necesidad de cuenta. Caduca cada 24 horas.
              </li>
              <li>
                <span className="pm-strong">
                  Cookies de autenticación (Supabase):
                </span>{" "}
                solo si inicias sesión con Google. Mantienen tu sesión
                activa entre visitas.
              </li>
            </ul>
            <p className="mt-3 text-muted">
              No utilizamos cookies publicitarias, de tracking de terceros
              ni de redes sociales.
            </p>
          </Section>

          <Section title="6. Servicios de terceros (sub-procesadores)">
            <p>
              Para operar el servicio confiamos en los siguientes
              proveedores técnicos. Todos ellos están sujetos a sus
              propias políticas de privacidad y a acuerdos de tratamiento
              de datos (DPA) cuando aplica.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-tinta">
              <li>
                <span className="pm-strong">Supabase</span> (alojado en
                AWS, regiones EU). Base de datos y autenticación. Recibe:
                tu identificador de cuenta, nombre, email y progreso de
                juego. Base legal: ejecución del contrato (Art. 6.1.b GDPR).
              </li>
              <li>
                <span className="pm-strong">Vercel</span> (alojamiento de
                la web). Recibe: tu dirección IP y user-agent durante las
                peticiones HTTP, como cualquier servidor web. Logs
                operacionales con retención corta. Base legal: interés
                legítimo en operar el sitio (Art. 6.1.f GDPR).
              </li>
              <li>
                <span className="pm-strong">Umami Analytics</span>{" "}
                (alojado en EU). Estadísticas agregadas de uso de la web.
                No usa cookies. No registra identificadores personales:
                solo página visitada y país aproximado derivado de la IP
                (que NO se almacena). Base legal: interés legítimo en
                medir tráfico anónimo (Art. 6.1.f GDPR).
              </li>
              <li>
                <span className="pm-strong">Sentry</span> (alojado en EU).
                Recibe automáticamente los errores que ocurren en tu
                navegador o en nuestros servidores, junto con el contexto
                técnico necesario para reproducirlos (URL, mensaje del
                error, stack trace). Aplicamos un filtrado previo
                automático que elimina tokens de seguridad, cabeceras de
                autorización y dirección de email antes de enviar el
                evento. Base legal: interés legítimo en garantizar la
                seguridad y la fiabilidad del servicio (Art. 6.1.f GDPR).
              </li>
            </ul>
            <p className="mt-3 text-muted">
              El Coche del Día no transfiere tus datos a terceros con fines
              comerciales ni publicitarios.
            </p>
          </Section>

          <Section title="7. Derecho de supresión (borrado de datos)">
            <p>
              Puedes eliminar tu cuenta TÚ MISMO y en cualquier momento, sin
              pedírselo a nadie: en tu perfil, dentro de{" "}
              <span className="pm-strong">Ajustes</span> →{" "}
              <span className="pm-strong">Eliminar cuenta</span>. El borrado es
              inmediato e irreversible.
            </p>
            <p className="mt-3">
              Se elimina tu identidad (nombre, correo y la conexión con tu cuenta
              de Google), tu nombre de jugador y tus suscripciones a avisos. El
              registro de partidas se conserva{" "}
              <span className="pm-strong">anonimizado</span>, sin ninguna
              referencia a ti, porque de él dependen las clasificaciones ya
              cerradas de otros jugadores.
            </p>
            <p className="mt-3 text-muted">
              El detalle completo del proceso está en{" "}
              <a
                href="/eliminar-cuenta"
                className="font-medium text-rojo underline decoration-rojo/40 underline-offset-4 transition hover:decoration-rojo"
              >
                cochedeldia.com/eliminar-cuenta
              </a>
              . Si no puedes acceder a tu cuenta, escribe a la dirección de la
              sección de contacto desde el correo con el que te registraste: la
              solicitud se atenderá en un plazo máximo de 30 días naturales.
            </p>
          </Section>

          <Section title="8. Contacto">
            <p>
              Para cualquier consulta relacionada con esta política, o para
              ejercer tus derechos de acceso, rectificación o supresión,
              puedes escribir a:
            </p>
            <p className="mt-3">
              <a
                href={`mailto:${ADMIN_CONTACT_EMAIL}`}
                className="font-medium text-rojo underline decoration-rojo/40 underline-offset-4 transition hover:decoration-rojo"
              >
                {ADMIN_CONTACT_EMAIL}
              </a>
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

// Pequeño wrapper para encabezado + cuerpo de cada sección. Centraliza
// el tracking, el peso y el spacing para que las 6 secciones queden
// perfectamente alineadas tipográficamente.
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
