# Reglas R8 propias de la app (release usa minifyEnabled + shrinkResources).
#
# El grueso de las keep rules NO vive aquí: cada plugin las publica vía
# `consumerProguardFiles` y R8 las aplica automáticamente.
#   - @capacitor/android           → mantiene todo lo que extiende
#                                    com.getcapacitor.Plugin y los métodos
#                                    anotados (@PluginMethod, @PermissionCallback…),
#                                    que Capacitor instancia por reflexión.
#   - androidx.credentials / GMS   → cada uno mantiene SU punto de entrada por
#     / okhttp                       reflexión y nada más (CredentialProvider-
#                                    PlayServicesImpl, RevocationBoundService,
#                                    PublicSuffixDatabase).
#
# LA EXCEPCIÓN: @capgo/capacitor-social-login. Sus reglas mantenían bibliotecas
# ENTERAS de terceros (okhttp3.**, androidx.credentials.**, gms.auth.**,
# com.facebook.** —con Facebook desactivado—), duplicando lo que esas librerías
# ya declaran bien y dejando 1.441 clases sin ofuscar: es lo que Play Console
# leía como «tasa de ofuscación baja». Su fichero se descarta en
# android/build.gradle (allí está la medición completa) y lo que esta app sí
# necesita de él se declara aquí abajo, a mano.
-keep class ee.forgr.capacitor.social.login.** { *; }
-keep class ee.forgr.capacitor.social.login.**$* { *; }
-keep class com.auth0.android.jwt.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

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
