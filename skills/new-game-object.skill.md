# new-game-object

## Purpose

Scaffold a new game component under `src/` using the project’s portrait/landscape responsive pattern.

## When to use

- Add a new visual element to the scene
- Create a reusable UI object
- Build a new sprite or image-based component

## Triggers

- "add a new component"
- "create a new game object"
- "add a sprite to the scene"

## What it does

- Creates a new class that extends `Phaser.GameObjects.Image` or `Phaser.GameObjects.Sprite`
- Calls `Utils.addDefaultProperties` to enable portrait/landscape reactive props
- Wires constructor options for `px`/`py`/`lx`/`ly` and `pScaleX`/`pScaleY`/`lScaleX`/`lScaleY`
- Adds the object to the provided `container`
- Keeps object behavior consistent with `Background.js`, `Button.js`, and `Logo.js`
