# Lluvia Aburrá · Geovisor con datos SIATA

Geovisor independiente para computador y celular. Reúne radar, lluvia medida, pronóstico por zonas, estaciones y series históricas del Valle de Aburrá. Los datos originales pertenecen a AMVA–SIATA.

## Abrir en este computador

Desde la carpeta del proyecto:

```powershell
python server.py 8765
```

Abrir [el geovisor local](http://127.0.0.1:8765/). Requiere Python 3.10 o superior y conexión a las fuentes de SIATA. Leaflet y los iconos se incluyen en el proyecto; no dependen de una CDN.

El servidor local escucha únicamente en este computador. Si el puerto ya está ocupado, cerrar la instancia anterior antes de iniciarlo de nuevo.

## Radar y datos de lluvia

- **Radar de lluvia SIATA** muestra el barrido PNG completo del [directorio operativo](https://siata.gov.co/data/radar/10_DBZH/) con los límites del [KML oficial del radar](https://siata.gov.co/kml/00_Radar/Ultimo_Barrido/AreaMetropolitanaRadar_10_120_DBZH.kml). No se recorta la imagen ni se eliminan píxeles según su color. Se conserva su transparencia y se aplica opacidad a la capa.
- El visor abre solo con el radar sobre el mapa base. Los puntos se activan desde las capas **Pluviómetros SIATA** y **Otras estaciones SIATA**, inicialmente desmarcadas. Filtrar o consultar el catálogo no activa estas capas. Los pluviómetros incluyen el catálogo y la [red operativa del geoportal](https://geoportal.siata.gov.co/fastgeoapi/geodata/geodataJson/3/pluvios_v2): azul indica lluvia medida, blanco 0 mm y gris una lectura reciente sin confirmar. La medición es el acumulado de los últimos 15 minutos; cada ficha muestra la fecha y hora de Medellín.
- El selector de comunas y corregimientos permite consultar **El Poblado, Belén y Guayabal**, entre los 21 sectores de Medellín, sin dibujar un contorno al seleccionar un lugar. El barrido de radar se muestra completo sobre toda Medellín, independientemente del sector seleccionado. Al tocar el mapa se muestran el pronóstico de la zona, las estaciones cercanas y sus lecturas. Los datos de una estación son puntuales; no representan una medición en cada calle.
- Los colores del radar representan reflectividad, no porcentajes de probabilidad ni mm medidos en el suelo. Un lugar sin color no confirma ausencia de lluvia.
- La leyenda empieza oculta. El botón «Mostrar leyenda» permite abrirla y «Ocultar leyenda» la cierra; su formato compacto se adapta a computador y celular. Sigue la [escala oficial de SIATA para reflectividad DBZH](https://siata.gov.co/siata_nuevo/application/assets/images/AreaMetropolitanaRadar_DBZH.png?v=0.0.1), verificada el 5 de octubre de 2026: 0–20 dBZ intensidad baja, 20–40 moderada, 40–60 alta y 60–80 muy alta o posible granizo. El enlace procede de los metadatos oficiales de la capa «Reflectividad 1°» (`C_00000000000000000000224`), cuyo raster corresponde al producto `10_120_DBZH`. La paleta se representa como una escala continua. El color por sí solo no confirma granizo.

## Pronóstico y estaciones

- El pronóstico consulta las 13 zonas publicadas por SIATA. Usa los límites reales del [KML meteorológico oficial](https://siata.gov.co/kml/Pronostico%20%28Experimental%29/Meteorologico.kml); Palmitas usa su [polígono de corregimiento](https://siata.gov.co/kml/04_Divisiones/04_Medellin/Corregimientos.kml). Medellín Centro cubre las comunas urbanas, incluyendo El Poblado, Belén y Guayabal; Oriente y Occidente cubren las respectivas zonas de ladera.
- El mapa temático llena cada zona según **BAJA, MEDIA o ALTA** para la fecha y el periodo seleccionados. Una zona sin producto vigente aparece sin categoría. SIATA entrega categorías cualitativas; no se calculan porcentajes adicionales.
- Las coordenadas del catálogo se completan con las tablas oficiales de las siete redes en [datos.siata.gov.co](https://datos.siata.gov.co/). Los registros sin ubicación publicada permanecen disponibles en la lista.
- Se integran lecturas operativas de lluvia, nivel, meteorología y PM2.5 cuando la fuente las entrega. Las fichas enlazan a la fuente original y a sus archivos históricos. Los históricos pueden tener meses de diferencia respecto de la fecha actual.
- Las capas de área de expansión e Iguana no forman parte del visor.

## Actualización y disponibilidad

| Producto | Consulta del visor | Criterio de vigencia |
|---|---|---|
| Radar | Cada 5 minutos | Ocultar barridos de más de 30 minutos |
| Lecturas operativas | Cada 5 minutos | Lluvia, nivel y meteorología: hasta 20 minutos; aire: hasta 90 minutos |
| Pronóstico | Cada 30 minutos | Fecha y periodo publicados por la fuente |
| Catálogo de históricos | Cada hora | Mostrar su fecha de consulta |

Estos intervalos son del visor; no garantizan que SIATA publique un producto nuevo con la misma frecuencia. El botón **Actualizar** consulta las fuentes, con un límite mínimo por producto para evitar solicitudes repetidas. Al volver a una pestaña se revisan los datos.

La app almacena su interfaz y un catálogo de referencia. No guarda radar, probabilidades ni lecturas actuales para servirlos sin conexión. Al perder conexión se avisa y se retiran los productos actuales.

## Web y app por enlace

La vista móvil usa el mapa completo, controles táctiles y un panel de capas que se puede abrir y cerrar. Desde el mismo enlace HTTPS, se puede usar como web o añadir a la pantalla de inicio en Android y iPhone. No necesita publicación en tiendas.

Para publicar en **Render, plan Free**, seguir [PUBLICACION.md](PUBLICACION.md). `render.yaml` configura el servicio web y la comprobación `/healthz`; `.python-version` fija Python 3.13. El proyecto incluye un servidor WSGI con Waitress, `Dockerfile` y `Procfile`. El dominio propio puede añadirse después.

`python tools/package_render.py` prepara la carpeta `publicar-render/` y el ZIP `dist/lluvia-aburra-render.zip` para subir el proyecto a GitHub. Incluye el visor actual y los datos necesarios para desplegarlo.

## Verificación

```powershell
python -m unittest discover -s tests -v
node --test tests/coverage.test.js tests/pwa.test.js
```

Las pruebas comprueban cobertura en los sectores solicitados, lecturas válidas de cero, fechas de datos, conservación de la imagen original, acceso a archivos públicos y exclusión de los productos actuales de la caché de la app.

Para regenerar los polígonos desde SIATA: `python tools/import_siata_geography.py`. Los archivos importados conservan la fuente y la fecha de importación. Los iconos se pueden regenerar con `tools/create_icons.py` y Pillow.

Fuente y condiciones: [Repositorio SIATA](https://datos.siata.gov.co/) y [términos de uso](https://datos.siata.gov.co/dataset.xhtml?persistentId=doi%3A10.83041%2F1CJGDM). Este visor no emite alertas oficiales.
