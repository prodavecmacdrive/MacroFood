# responsive-layout

## Purpose

Adjust portrait and landscape layout values for game objects in `src/` to fix alignment or scaling issues.

## When to use

- Objects appear off-screen in landscape
- Portrait and landscape positions are not aligned
- UI elements scale incorrectly on different aspect ratios

## Triggers

- "fix layout"
- "object is off-screen in landscape"
- "adjust position for portrait"

## What it does

- Reads `px`/`py`/`lx`/`ly` and `pScaleX`/`pScaleY`/`lScaleX`/`lScaleY` values from the target component
- Uses breakpoint constants from `Scene.js` (`PORTRAIT_MAX_WIDTH = 700`, `LANDSCAPE_MAX_HEIGHT = 700`) as guidance
- Proposes practical property updates
- Applies the updated values to the relevant constructor call in `src/Game.js`
