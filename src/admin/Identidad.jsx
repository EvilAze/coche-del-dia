// src/admin/Identidad.jsx
// Quién es esta fila: el nick encima, el correo debajo.
//
// POR QUÉ EXISTE: cada tabla del panel resolvía la identidad a su manera y
// ninguna enseñaba las dos cosas a la vez. La analítica hacía
// `username || maskEmail(email)` —o el nick, o el correo, nunca los dos—, así
// que para saber qué correo hay detrás de un nick había que ir a buscar el
// `title` con el ratón; y la auditoría solo enseñaba el correo, que es
// precisamente el identificador que NO aparece en la clasificación pública. El
// resultado es que las dos mitades del trabajo de moderación —ver a alguien en
// el ranking y actuar sobre su cuenta— no se podían cruzar a simple vista.
//
// EL CORREO SE ENMASCARA, y no es un descuido heredado: el panel se mira con
// gente al lado y acaba en capturas. Con el nick delante, `rub…@gmail.com`
// identifica de sobra; el correo entero sigue estando en el `title` y en los
// diálogos de confirmación, que es donde de verdad hace falta.

// Oculta parte del local del correo. Fuera de un componente para poder
// reutilizarla en los `window.confirm`, donde no se pinta JSX.
export function maskEmail(email) {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 3) return email;
  return `${local.slice(0, 3)}…@${domain}`;
}

// Etiqueta de una línea para diálogos y avisos: «nick (rub…@gmail.com)».
// Los `confirm` de moderación decían solo el correo, que obliga a recordar a
// quién corresponde justo en el momento de decidir.
export function etiquetaCuenta({ username, email }) {
  const correo = maskEmail(email);
  return username ? `${username} (${correo})` : correo;
}

export default function Identidad({ username, email, className = "" }) {
  return (
    // min-w-0 + truncate: sin esto un correo largo ensancha la tabla entera y
    // reaparece el scroll horizontal que estas tablas acaban de quitarse.
    <div className={`min-w-0 ${className}`} title={email || ""}>
      {username ? (
        <>
          <div className="truncate font-semibold text-white/90">{username}</div>
          <div className="truncate text-[10px] font-normal text-muted">
            {maskEmail(email)}
          </div>
        </>
      ) : (
        <>
          <div className="truncate font-semibold text-white/90">
            {maskEmail(email)}
          </div>
          {/* Sin nick no es un hueco: es información. Una cuenta sin
              display_name todavía no ha entrado en la clasificación. */}
          <div className="truncate text-[10px] font-normal italic text-muted/70">
            sin nick
          </div>
        </>
      )}
    </div>
  );
}
