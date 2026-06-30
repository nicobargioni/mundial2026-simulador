# ⚽ Simulador Mundial 2026

Un simulador del Mundial 2026 que corre **100% en el navegador** (sin servidor, sin backend).
Rankea a cada selección con **Elo**, le pone goles con un modelo **Dixon-Coles** y juega el torneo
que falta miles de veces con **Monte Carlo**. Mirá el bracket llenarse partido a partido y entendé
cómo funciona con tres paneles interactivos.

🔗 **Demo:** https://nicobargioni.github.io/mundial2026-simulador/

## Qué hace

- **Simular el Mundial** → anima la ronda de 32 → final, con marcadores sorteados por el modelo.
- **Tirar 10.000 veces** → muestra la probabilidad de campeón de cada selección.
- **Paneles educativos** en vivo: Elo (fuerza → probabilidad), Monte Carlo (convergencia), Dixon-Coles (marcadores).

## Editar la estética

Todo el look se controla desde **`styles.css`**, en el bloque `:root` de arriba:

```css
:root{
  --ground:#0a1410;   /* fondo */
  --gold:#f0c24b;     /* acento campeón */
  --mint:#46c08a;     /* barras / ganador */
  ...
}
```

**Para poner un fondo mundialista propio** (una foto): agregá el archivo (p.ej. `fondo.jpg`) al repo y
reemplazá la regla `body{ background:... }` por:

```css
body{ background:url("fondo.jpg") center/cover fixed, var(--ground); }
```

La tipografía se cambia en las variables `--font-head` / `--font-body`.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | estructura de la página |
| `styles.css` | **toda la estética** (editá acá) |
| `sim.js` | motor de simulación + interacción |
| `data.js` | fuerzas de los equipos + bracket (generado por el modelo) |

`data.js` se regenera desde el análisis con `export_web_data.py` (no hace falta tocarlo a mano).

## Límites honestos

Cancha neutral, sin lesiones ni convocatorias. Es un mapa de probabilidades, no una bola de cristal.
Datos de partidos internacionales 1872→2026. Estado del torneo al 29-jun-2026.
