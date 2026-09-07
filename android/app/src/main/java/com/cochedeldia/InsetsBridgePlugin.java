package com.cochedeldia;

import android.view.View;
import android.webkit.JavascriptInterface;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Publica los insets del sistema (barra de estado, barra de gestos, recorte de
 * pantalla) como las variables CSS `--safe-area-inset-*` que ya consume
 * index.css en sus catorce sitios. NO toca el tamaño del WebView.
 *
 * POR QUÉ HACE FALTA, y por qué no vale el `env()` del navegador.
 *   La app apaga la gestión de insets de Capacitor
 *   (`plugins.SystemBars.insetsHandling: "disable"`, ver regla 18h de
 *   CLAUDE.md): ese listener le metía al PADRE del WebView un `padding-bottom`
 *   igual a la altura del teclado, la ventana pasaba de 780 a 490 y el pliego
 *   entero se recomponía con la fotografía dentro. Apagarlo fue lo correcto.
 *
 *   La contrapartida quedó escrita allí mismo: apagarlo apaga también la
 *   inyección de `--safe-area-inset-*`, y quien sostiene los insets pasa a ser
 *   el `env()` nativo de respaldo. Eso resultó ser verdad SOLO A MEDIAS, y de
 *   la forma más difícil de ver: en el WebView de Android `env(safe-area-inset-
 *   top)` devuelve el valor bueno (medido: 53px) mientras que
 *   `env(safe-area-inset-bottom)` devuelve **0**. Chromium no arregló las
 *   safe-areas hasta la versión 140 —el propio código de Capacitor tiene esa
 *   constante, `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX`— y el WebView de un móvil
 *   cualquiera puede llevar meses por detrás. Resultado: la última fila de la
 *   lista de marcas y el reloj de cierre se dibujaban DEBAJO de la barra de
 *   gestos. El top se veía bien, que es lo que hacía que el fallo pareciera
 *   otra cosa.
 *
 * LO QUE HACE, Y SOBRE TODO LO QUE NO HACE.
 *   Escucha los insets y publica sus valores. Devuelve el objeto de insets tal
 *   cual, sin consumirlo, y no llama a `setPadding` en ninguna vista: el WebView
 *   sigue siendo edge-to-edge y sigue midiendo la pantalla entera pase lo que
 *   pase. Quien reparte el hueco es el CSS, como ya hacía. Esa es exactamente
 *   la línea que la regla 18h no quiere que se vuelva a cruzar.
 *
 * DOS CAMINOS PARA EL MISMO DATO, y los dos hacen falta:
 *   · EMPUJE — al llegar un inset nuevo (arranque, girar el móvil, cambiar de
 *     navegación por gestos a tres botones) se escribe en el documento.
 *   · TIRÓN — `leer()`, síncrono vía addJavascriptInterface, para que el web lo
 *     pida al arrancar. Hace falta porque el estilo en línea NO sobrevive a una
 *     recarga de la página, y esta app recarga sola (cambio de día, coche
 *     cambiado): sin el tirón, la primera pantalla tras recargar volvería a
 *     dibujarse bajo la barra hasta el siguiente evento de layout.
 *
 * Se registra en load() y no en el onCreate de la Activity por lo mismo que
 * LocaleBridgePlugin: `addJavascriptInterface` tiene que estar puesto ANTES de
 * que el WebView cargue la página o no aparece hasta una recarga.
 */
@CapacitorPlugin(name = "InsetsBridge")
public class InsetsBridgePlugin extends Plugin {

    /** Últimos insets conocidos, ya en píxeles CSS (dp). */
    private int top = 0;
    private int right = 0;
    private int bottom = 0;
    private int left = 0;

    @Override
    public void load() {
        getBridge().getWebView().addJavascriptInterface(this, "CddInsets");

        View contenedor = (View) getBridge().getWebView().getParent();
        if (contenedor == null) return;

        ViewCompat.setOnApplyWindowInsetsListener(contenedor, (v, insets) -> {
            // Barras del sistema + recorte de pantalla: el hueco que de verdad
            // no es nuestro. El teclado NO entra en la cuenta a propósito — se
            // superpone al WebView sin redimensionarlo, y hacer bailar estas
            // variables al abrirlo movería el pliego entero por nada.
            Insets huecos = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float densidad = getContext().getResources().getDisplayMetrics().density;
            top = Math.round(huecos.top / densidad);
            right = Math.round(huecos.right / densidad);
            bottom = Math.round(huecos.bottom / densidad);
            left = Math.round(huecos.left / densidad);
            publicar();
            // Sin consumir: lo que haya debajo sigue recibiendo lo suyo.
            return insets;
        });

        // El listener solo se dispara cuando el sistema reparte insets, y esa
        // primera vuelta puede haber pasado ya. Se pide explícitamente.
        ViewCompat.requestApplyInsets(contenedor);
    }

    /** Escribe las cuatro variables en el documento, si ya hay documento. */
    private void publicar() {
        getBridge()
            .executeOnMainThread(() -> {
                if (getBridge() == null || getBridge().getWebView() == null) return;
                String js = String.format(
                    java.util.Locale.US,
                    "try{var e=document.documentElement.style;" +
                    "e.setProperty('--safe-area-inset-top','%dpx');" +
                    "e.setProperty('--safe-area-inset-right','%dpx');" +
                    "e.setProperty('--safe-area-inset-bottom','%dpx');" +
                    "e.setProperty('--safe-area-inset-left','%dpx');}catch(err){}",
                    top,
                    right,
                    bottom,
                    left
                );
                getBridge().getWebView().evaluateJavascript(js, null);
            });
    }

    /**
     * Lectura SÍNCRONA para el arranque del bundle: "top,right,bottom,left" en
     * píxeles CSS. Ver el bloque de arriba sobre por qué no basta con el empuje.
     */
    @JavascriptInterface
    public String leer() {
        return top + "," + right + "," + bottom + "," + left;
    }
}
