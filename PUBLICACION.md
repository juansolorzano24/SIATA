# Publicar la web y la app por enlace

La web y la app móvil comparten el mismo enlace. La interfaz se adapta al celular y ofrece añadir el acceso a la pantalla de inicio (PWA). No requiere Play Store ni App Store. El proveedor elegido es **Render, plan Free**. Se utilizará el enlace HTTPS que asigne Render; el dominio propio puede añadirse después.

## Publicación en Render

### 1. Crear el repositorio en GitHub

1. Usar el repositorio [juansolorzano24/SIATA](https://github.com/juansolorzano24/SIATA) creado para este geovisor.
2. Ejecutar `python tools/package_render.py` para preparar la carpeta `publicar-render/` y el archivo `dist/lluvia-aburra-render.zip`.
3. Subir **el contenido** de `publicar-render/` al repositorio, conservando las carpetas `data/`, `vendor/`, `icons/`, `tests/` y `tools/`. Los archivos `render.yaml`, `.python-version`, `requirements.txt` y `serve.py` deben quedar en la raíz del repositorio.
4. Si se usa el ZIP, descomprimirlo antes de subir los archivos. Subir únicamente el ZIP a GitHub no permite a Render ejecutar el proyecto.

La carpeta preparada incluye el geovisor actual y los tres archivos de datos necesarios. Los archivos originales de Iguana y las capas de expansión quedan en la carpeta de trabajo local.

### 2. Conectar Render

1. Crear tu cuenta en [Render](https://dashboard.render.com/register), completar personalmente el registro y la aceptación de sus condiciones.
2. En Render, elegir **New → Blueprint** y conectar el repositorio `SIATA` de GitHub. Al autorizar la conexión, seleccionar este repositorio. El nombre del servicio en Render será `lluvia-aburra`.
3. Revisar el servicio `lluvia-aburra` y comprobar que el plan seleccionado sea **Free ($0)**. `render.yaml` define el servidor Python, sus comandos de instalación y arranque y la comprobación de salud.
4. Crear el Blueprint y esperar a que el servicio aparezca como **Live**.
5. Abrir el enlace HTTPS real que muestra Render. El nombre del enlace puede incluir un sufijo; no se debe dar por publicado un enlace hasta verlo en el panel.

El archivo `.python-version` fija la familia Python 3.13. Render selecciona su última versión de mantenimiento disponible.

### Configuración manual alternativa

Si se usa **New → Web Service**, introducir:

| Campo | Valor |
|---|---|
| Repositorio | El repositorio que contiene este geovisor |
| Nombre | `lluvia-aburra` |
| Language / Runtime | Python 3 |
| Region | Virginia, USA |
| Root Directory | Vacío si los archivos están en la raíz |
| Build Command | `python -m pip install -r requirements.txt` |
| Start Command | `python serve.py` |
| Instance Type | **Free ($0)** |
| Health Check Path | `/healthz` |

Render proporciona `PORT` automáticamente. El proyecto no necesita una base de datos ni claves de SIATA.

### Límites del plan gratuito

- El servicio se suspende tras 15 minutos sin visitas y puede tardar aproximadamente un minuto en arrancar con la siguiente visita.
- Los cambios del catálogo guardados en el servidor se pierden al reiniciar o volver a desplegar. El proyecto incluye un catálogo de referencia y vuelve a consultar SIATA; no necesita un disco de pago.
- Las horas de servicio, las transferencias y las compilaciones tienen cuotas. Render también limita el volumen inusual de consultas externas.
- Los cambios enviados a la rama conectada de GitHub vuelven a desplegar la web automáticamente.

Referencias: [servicios web](https://render.com/docs/web-services), [Blueprints](https://render.com/docs/blueprint-spec), [Python](https://render.com/docs/python-version) y [límites gratuitos](https://render.com/docs/free).

## Qué necesita el alojamiento

- Un servicio que ejecute Python 3.10 o superior, o el contenedor Docker incluido.
- Servir el proyecto en la raíz del dominio, por ejemplo `https://lluvia.ejemplo.com/`.
- HTTPS válido, administrado por el proveedor o por un proxy inverso.
- Salida por HTTPS hacia `siata.gov.co`, `geoportal.siata.gov.co` y `datos.siata.gov.co`.
- Espacio de escritura en `data/` para renovar el catálogo. No requiere base de datos ni claves de SIATA.

Un alojamiento únicamente de archivos estáticos no puede ejecutar las consultas de datos que necesita este geovisor.

## Arranque de producción

```powershell
python -m pip install -r requirements.txt
python serve.py
```

El servidor usa el puerto de la variable `PORT`; por defecto, 8000. Escucha en todas las interfaces para que el proveedor pueda conectarlo a HTTPS. `Procfile` contiene el arranque para servicios compatibles.

También se puede desplegar el `Dockerfile` incluido. Solo incorpora los archivos públicos del visor y su servidor. El endpoint `/healthz` permite al proveedor comprobar que el servicio está funcionando.

## Comprobaciones al publicar

1. Abrir el enlace HTTPS desde computador y celular.
2. Comprobar la hora del radar y las estaciones en El Poblado, Belén y Guayabal.
3. Cambiar fecha y periodo del pronóstico.
4. En Android, abrir el enlace en Chrome y usar «Añadir al inicio» o la opción del navegador para instalar.
5. En iPhone, abrir el enlace en Safari y usar Compartir → Añadir a pantalla de inicio.
6. Abrir el acceso creado y comprobar que se muestra sin la barra de navegación.
7. Al desconectar Internet, debe aparecer el aviso de falta de conexión. El radar, las probabilidades y las lecturas actuales no se almacenan para mostrarlas como si fueran recientes.

El mapa base necesita conexión para descargar sus teselas. La app guarda su interfaz y su catálogo de referencia; la disponibilidad de lluvia en tiempo real depende de las fuentes SIATA.

## Mantenimiento

Al modificar los archivos de la interfaz, aumentar conjuntamente el número de versión en `index.html` y `service-worker.js`. La app ofrece un botón para aplicar una versión nueva cuando el navegador la detecta.

Se usa un proceso del servidor con consultas compartidas en memoria para reducir solicitudes a SIATA. Si aumenta el tráfico, dimensionar el servicio y evaluar una caché compartida antes de multiplicar los procesos.
