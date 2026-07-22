# Reglas R8 propias de la app (release usa minifyEnabled + shrinkResources).
#
# El grueso de las keep rules NO vive aquí: cada plugin las publica vía
# `consumerProguardFiles` y R8 las aplica automáticamente.
#   - @capacitor/android           → mantiene todo lo que extiende
#                                    com.getcapacitor.Plugin y los métodos
#                                    anotados (@PluginMethod, @PermissionCallback…),
#                                    que Capacitor instancia por reflexión.
#   - @capgo/capacitor-social-login → mantiene GMS Auth, androidx.credentials,
#                                    OkHttp y sus propias clases.
# Aquí solo va lo específico de esta app.

# La app entera es una WebView que habla con el nativo por el puente de
# Capacitor. Cualquier método expuesto a JS se invoca por nombre desde
# JavaScript, así que R8 no puede verlo usado y lo borraría.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor lee las anotaciones de los plugins en runtime para construir el
# registro de métodos: sin estos atributos el puente se queda vacío y la app
# arranca pero ningún plugin responde (fallo silencioso solo en release).
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Trazas de Sentry/Play Console legibles. R8 sigue ofuscando; solo conserva
# fichero y línea, y borra el nombre del .java original.
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# Facebook/Apple/Twitter están desactivados en capacitor.config.json, así que
# el plugin compila contra sus stubs (src/facebookStubs). Silencia los avisos
# de referencias a clases del SDK real que ya no empaquetamos.
-dontwarn com.facebook.**
