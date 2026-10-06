// src/hooks/useAvisoDiario.js
// El estado del aviso diario para el interruptor del Perfil, igual en las dos
// plataformas: en la app es el recordatorio local de Capacitor
// (lib/notifications.js), en la web la suscripción push (lib/webpush.js).
//
//   disponible → hay con qué avisar aquí (app, o navegador con push).
//   activo     → null mientras se pregunta; luego true/false.
//   bloqueado  → el navegador tiene el permiso DENEGADO: el interruptor no
//                puede encender nada y la fila lo explica.
//   cambiar(v) → enciende o apaga; el estado final es el que el sistema deja,
//                no el que se pidió (un permiso negado devuelve el interruptor
//                a su sitio, en vez de dejarlo mintiendo).
import { useEffect, useState } from "react";
import { useT, getLocale } from "../i18n";
import { reminderCopy } from "../lib/reminderCopy";
import {
  isNative,
  avisosActivos,
  apagarAvisos,
  encenderAvisos,
  markAskedOptIn as marcarPreguntadoNativo,
} from "../lib/notifications";
import {
  isPushSupported,
  estaSuscrito,
  permisoNavegador,
  subscribe,
  unsubscribe,
  markAskedOptIn as marcarPreguntadoWeb,
} from "../lib/webpush";

export function useAvisoDiario(abierto = true) {
  const { t, tn } = useT();
  const nativo = isNative();
  const disponible = nativo || isPushSupported();
  const [activo, setActivo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);

  useEffect(() => {
    if (!abierto || !disponible) return undefined;
    let vivo = true;
    (nativo ? avisosActivos() : estaSuscrito())
      .then((v) => vivo && setActivo(Boolean(v)))
      .catch(() => vivo && setActivo(false));
    if (!nativo) setBloqueado(permisoNavegador() === "denied");
    return () => {
      vivo = false;
    };
  }, [abierto, disponible, nativo]);

  async function cambiar(encender) {
    if (ocupado || !disponible) return;
    setOcupado(true);
    try {
      if (nativo) {
        if (encender) {
          // Encenderlo aquí ES contestar a la invitación: que la tarjeta del
          // final de partida no vuelva a ofrecerlo.
          marcarPreguntadoNativo();
          setActivo(await encenderAvisos(reminderCopy(t, tn, 0)));
        } else {
          await apagarAvisos();
          setActivo(false);
        }
      } else if (encender) {
        marcarPreguntadoWeb();
        await subscribe(getLocale());
        setActivo(await estaSuscrito());
        setBloqueado(permisoNavegador() === "denied");
      } else {
        await unsubscribe();
        setActivo(await estaSuscrito());
      }
    } catch {
      setActivo(nativo ? await avisosActivos().catch(() => false) : await estaSuscrito());
    } finally {
      setOcupado(false);
    }
  }

  return { disponible, activo, ocupado, bloqueado, cambiar };
}
