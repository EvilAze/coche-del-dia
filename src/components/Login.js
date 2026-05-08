import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function Login() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  async function loginConGoogle() {
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });

    if (error) setErrorMessage(error.message);
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return <div className="text-sm text-muted">Cargando...</div>;
  }

  const user = session?.user;
  const nombre =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email;

  const avatar =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture;

  if (user) {
    return (
      <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-bg-tertiary p-3">
        {avatar && (
          <img
            src={avatar}
            alt={nombre}
            className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
          />
        )}

        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{nombre}</p>
          <p className="truncate text-xs text-muted">Sesión iniciada</p>
        </div>

        <button
          onClick={cerrarSesion}
          className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-[10px] uppercase tracking-[0.16em] text-muted transition hover:border-red-400 hover:text-red-400"
        >
          Salir
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <button
        onClick={loginConGoogle}
        className="flex w-full min-w-0 items-center justify-center gap-3 rounded-lg border border-border bg-white px-4 py-3 text-sm font-medium text-bg-primary transition hover:bg-zinc-100 active:scale-[0.98]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-base font-bold text-blue-600">
          G
        </span>
        <span className="min-w-0 truncate">Iniciar sesión con Google</span>
      </button>

      {errorMessage && (
        <p className="text-center text-xs text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
