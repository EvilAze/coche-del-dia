// api/_lib/jwks-embebido.js
// Claves PÚBLICAS de firma del proyecto, congeladas en el repo como ÚLTIMO
// recurso. Copia literal de /auth/v1/.well-known/jwks.json, tomada el
// 2026-08-23.
//
// POR QUÉ EXISTE. La caché de tres niveles (memoria → Redis → endpoint) tenía
// una dependencia circular que solo se ve cuando ya te ha mordido: el endpoint
// del JWKS lo sirve EL MISMO GoTrue que se cae, y Redis solo se puede sembrar
// con una lectura de ese endpoint. O sea que durante la caída del 23 de agosto
// de 2026 los dos niveles nuevos estaban vacíos y no había forma de llenarlos:
//
//     [jwks] no se pudo refrescar: jwks superó el plazo de 5000 ms
//
// Con las claves aquí, una instancia en frío puede verificar identidades desde
// el primer milisegundo, sin red y sin haber hablado nunca con nadie.
//
// POR QUÉ ES SEGURO COMMITEARLAS, y en un repo PÚBLICO (regla 20). Son claves
// públicas: ya están publicadas en una URL abierta, llevan key_ops ["verify"]
// y no contienen material privado, así que sirven para COMPROBAR una firma y
// jamás para producirla. Y no dicen nada del coche del día, que es lo que la
// regla 20 protege.
//
// QUÉ PASA SI SUPABASE ROTA LAS CLAVES. Nada grave, y por eso esto es el
// último recurso y no el primero: un token firmado con una clave nueva trae un
//  que no está aquí, y eso fuerza el refresco por Redis/endpoint; si
// tampoco se puede, se cae al respaldo getUser() — el comportamiento de
// siempre. Nunca se acepta un token que no verifique.
//
// PARA ACTUALIZARLAS:
//   curl -s https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
// y pega el resultado abajo. No es urgente salvo que Supabase rote.

export default {
  "keys": [
    {
      "alg": "ES256",
      "crv": "P-256",
      "ext": true,
      "key_ops": [
        "verify"
      ],
      "kid": "821e5a42-897d-47a8-842b-ad57bae8f10e",
      "kty": "EC",
      "use": "sig",
      "x": "tCqKtgP1bvDNOlTFTXhe6FTiUHt2jWiWay5_VjPlL3A",
      "y": "DhTSsHtI5qeycOdWZ5CI6_-h1fg0XZc6NK1K2OKdeRg"
    },
    {
      "alg": "ES256",
      "crv": "P-256",
      "ext": true,
      "key_ops": [
        "verify"
      ],
      "kid": "e9d788ec-2517-45fa-aa4b-365b79eb5fb4",
      "kty": "EC",
      "use": "sig",
      "x": "9rI6hBOS3zXYe1K2NxzD-VQhwfE05ZWlnUiQPqhvB4Q",
      "y": "9XlLhUWMTMgZZxd0lgCIy56gouPbQpXjH03d-6a2uXw"
    },
    {
      "alg": "ES256",
      "crv": "P-256",
      "ext": true,
      "key_ops": [
        "verify"
      ],
      "kid": "e0c2b6f1-eed7-42f7-aa4e-583a314486b4",
      "kty": "EC",
      "use": "sig",
      "x": "h-uU5bVNB2MOEMy1tmeT_YOo8U037s7e_V-UG0FYLTo",
      "y": "ZnZHqypWRPOiA5nYmib2hyji4lQwiBLzJz2sIUT1EVg"
    }
  ]
};
