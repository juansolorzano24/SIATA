# Estadísticas privadas de visitas

El geovisor integra Umami Cloud. Las estadísticas se consultan entrando en [Umami](https://cloud.umami.is/login) con la cuenta propietaria del sitio «Lluvia Valle de Aburrá». No habilitar «Share URL» si se desea conservar privado el informe.

## Activación en Render

En el servicio SIATA → Environment agregar:

- `UMAMI_WEBSITE_ID`: el identificador público que aparece en el código de seguimiento de Umami.
- `UMAMI_DOMAINS`: `siata.onrender.com` (es el valor predeterminado; actualizar si cambia el dominio).

Guardar los cambios y desplegar. El identificador del sitio es público, como en cualquier código de seguimiento. No introducir contraseñas, tokens de API ni credenciales del panel en el repositorio o en estas variables.

`/api/analytics/config` indica `enabled: true` cuando la configuración es válida. No confirma que Umami haya recibido una visita: eso se comprueba en su panel después de abrir la web. Sin ID válido la integración permanece desactivada. La política de seguridad autoriza exclusivamente el script de `https://cloud.umami.is` y el envío a `https://gateway.umami.is` cuando está configurada.

## Consultar las últimas 24 horas

Abrir el sitio en el panel de Umami y seleccionar un periodo de las últimas 24 horas o un intervalo personalizado equivalente. «Hoy» corresponde al día calendario, y puede ser diferente. Configurar/verificar la zona horaria del panel para interpretar las horas locales de Medellín (UTC−5).

- **Views / vistas**: aperturas de la página, incluidas recargas.
- **Visitors / visitantes**: estimación de visitantes distintos según las sesiones anónimas de Umami; no identifica personas ni distingue perfectamente redes o dispositivos compartidos.
- **Visits / visitas**: grupos de actividad definidos por Umami; no equivalen a personas.
- **Countries / Regions / Cities**: procedencia aproximada por conexión a Internet. La ciudad puede faltar o ser imprecisa por redes móviles, VPN u otros factores.
- **Devices / Referrers**: tipo de dispositivo y sitio desde el cual se accedió, si el navegador permite conocerlo. Aquí solo enviamos el origen del enlace, sin su ruta o parámetros.

No hay datos anteriores a la activación. Bloqueadores, solicitudes de privacidad, desconexiones y la exclusión voluntaria pueden reducir los conteos. Las comprobaciones hechas en producción también pueden contar como visitas. Las pruebas locales no envían datos a Umami.

## Privacidad y funcionamiento

Se envía una sola vista por apertura de la página. Se excluyen parámetros, fragmentos de URL, búsquedas, coordenadas, estaciones seleccionadas, eventos personalizados y métricas de rendimiento. No se solicita GPS ni se configura grabación de sesiones. Umami procesa la IP de conexión para estimar ubicación y sesiones; [su documentación](https://docs.umami.is/docs/metric-definitions) indica que no la almacena.

El botón «Privacidad y estadísticas» explica la medición y permite excluir este navegador. La preferencia se guarda localmente; el envío comprueba la preferencia inmediatamente antes de cada solicitud. Se respetan Do Not Track y Global Privacy Control. Los datos se almacenan en Umami, por lo que no se pierden con los reinicios del servicio gratuito de Render. El mapa sigue funcionando si el proveedor de estadísticas falla.

Según el [plan Hobby](https://umami.is/pricing), consultado el 5 de octubre de 2026, se incluyen un sitio, 100.000 eventos por mes y seis meses de retención. Comprobar el plan seleccionado y sus límites en la cuenta; no es necesario iniciar una prueba de pago para esta integración.
