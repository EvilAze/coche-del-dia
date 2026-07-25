package com.cochedeldia;

import android.os.Bundle;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Único motivo de existir de este override: pintar el fondo del WebView con
     * el color que toca según el modo del sistema.
     *
     * El problema: `android.backgroundColor` de capacitor.config.json es un hex
     * ESTÁTICO. Está en papel (#f3eee1) porque es el tema por defecto, así que
     * quien juega en edición de noche se comía un destello crema en cada
     * arranque en frío y en cada overscroll — justo lo que el anti-FOUC inline
     * de index.html evita en la web, pero que ahí no alcanza: el color de fondo
     * del WebView lo fija el nativo antes de que exista una sola línea de CSS.
     *
     * @color/cdd_window_bg resuelve a papel o a grafito vía values-night, igual
     * que ya hacía el splash con drawable-night. Se resuelve por el modo oscuro
     * del SO, no por el override manual de localStorage ("cdd-tema"), que el
     * nativo no puede leer. Es la misma aproximación que el splash y acierta en
     * el caso normal (tema siguiendo al sistema); si alguien fuerza el tema
     * contrario al del SO, lo peor que pasa es el destello que había antes, y
     * solo para esa combinación.
     *
     * Va DESPUÉS de super.onCreate() a propósito: es ahí donde el Bridge crea
     * el WebView y le aplica el color de la config, así que antes no existe
     * nada que repintar.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin ANTES de super.onCreate(): el Bridge se construye
        // dentro de super y ahí llama al load() de cada plugin, que es donde
        // LocaleBridgePlugin engancha su interfaz JS. Registrarlo después
        // llegaría tarde (el WebView ya habría empezado a cargar la página).
        registerPlugin(LocaleBridgePlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.cdd_window_bg));
        }
    }
}
