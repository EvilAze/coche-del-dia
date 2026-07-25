package com.cochedeldia;

import android.webkit.JavascriptInterface;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.os.LocaleListCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/**
 * Puente para que el i18n del bundle (src/i18n) sepa qué idioma eligió el
 * usuario en el selector POR APP de Android (Ajustes → Aplicaciones → Coche del
 * Día → Idioma), que en Android 13+ enciende `localeConfig`.
 *
 * POR QUÉ HACE FALTA NATIVO, y no basta con navigator.language:
 *   La app ya tiene su propio selector de idioma (LanguageStrip → override en
 *   localStorage). El problema de convivencia es de PRECEDENCIA: si el override
 *   de la app manda siempre, el selector de Android no hace nada y no hay pista
 *   de por qué (un ajuste del sistema ignorado en silencio es peor que no
 *   ofrecerlo). Para resolverlo hay que distinguir "el usuario ELIGIÓ este
 *   idioma en Android" de "es el idioma por defecto del sistema" —y esa
 *   diferencia navigator.language NO la ve: en ambos casos vale lo mismo.
 *
 *   `AppCompatDelegate.getApplicationLocales()` SÍ la ve: devuelve la lista
 *   VACÍA si no hay elección explícita por app, y la elegida si la hay. Ese
 *   "vacío vs. elegido" es justo la señal que faltaba. (En API < 33 devuelve
 *   siempre vacío porque nunca llamamos a setApplicationLocales — así que en
 *   móviles viejos este puente no aporta nada y el idioma se resuelve como
 *   antes: override → navigator → defecto. Degradación limpia.)
 *
 * POR QUÉ LECTURA SÍNCRONA vía addJavascriptInterface, y no un @PluginMethod:
 *   El i18n resuelve el idioma al cargarse el módulo, ANTES del primer render y
 *   antes de que un puente asíncrono de Capacitor pudiera contestar. Un método
 *   @JavascriptInterface se llama de forma síncrona desde JS y devuelve el valor
 *   en el acto. Se registra en load() —no en el onCreate de la Activity— porque
 *   load() corre durante la inicialización del Bridge, ANTES de que el WebView
 *   cargue la página: registrarlo después no aparecería hasta una recarga
 *   (limitación documentada de addJavascriptInterface). Es el mismo patrón que
 *   usa el plugin SystemBars de Capacitor para su interfaz de safe-areas.
 *
 * SOLO LECTURA a propósito: no exponemos un setter que llame a
 * setApplicationLocales. Ese método provoca que el sistema recree/recargue la
 * Activity, lo que en mitad de una partida tiraría el estado del WebView. El
 * lado web sella el valor nativo cuando el usuario elige dentro de la app (ver
 * resolveLocale.js), así que la convivencia de los dos selectores se resuelve
 * entera con lecturas, sin tocar el estado del sistema.
 */
@CapacitorPlugin(name = "LocaleBridge")
public class LocaleBridgePlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        getBridge().getWebView().addJavascriptInterface(this, "CochePlatform");
    }

    /**
     * @return el subtag primario del idioma elegido por app ("en", "es"…), o ""
     *         si no hay elección explícita. R8 conserva este método por la regla
     *         de @JavascriptInterface de proguard-rules.pro.
     */
    @JavascriptInterface
    public String getPersistedLocale() {
        LocaleListCompat locales = AppCompatDelegate.getApplicationLocales();
        if (locales.isEmpty()) return "";
        Locale primero = locales.get(0);
        return primero != null ? primero.getLanguage() : "";
    }
}
