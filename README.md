# StickerExplosion — Playable Ad

A Webpack-based framework for building self-contained HTML5 playable ads powered by Phaser 3. Outputs a single inlined HTML file per ad network, with all assets (textures, sprite sheets, fonts, audio, Spine animations) base64-encoded and compressed at build time.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Assets](#assets)
- [Development](#development)
- [Production Build](#production-build)
- [Supported Networks](#supported-networks)
- [Multi-Version Support](#multi-version-support)
- [Framework Overview](#framework-overview)
- [Adding Game Logic](#adding-game-logic)
- [Recommended Agent Skills](#recommended-agent-skills)

---

## Project Structure

```
├── config.js               # Main project config (name, networks, versions, asset lists)
├── package.json
├── webpack.dev.config.js
├── webpack.prod.config.js
├── assets/
│   ├── audio/              # Source MP3 files
│   ├── fonts/              # Source TTF files
│   ├── imagemap/           # (reserved)
│   ├── sheets/             # Source PNG/JPG images for atlas packing
│   ├── spine/              # Spine animation files (.png, .json, .atlas)
│   └── textures/           # Source PNG/JPG individual textures
├── core/
│   ├── builder/            # Webpack plugin + asset pipeline (Node.js)
│   │   ├── Index.js        # BuilderPlugin — orchestrates the full build
│   │   ├── Textures.js     # Compresses & base64-encodes individual textures
│   │   ├── Sheets.js       # Packs sprites into atlas, compresses, base64-encodes
│   │   ├── Fonts.js        # Embeds TTF fonts as base64 @font-face
│   │   ├── Audio.js        # Converts MP3s → audiosprite (m4a + ogg), base64-encodes
│   │   └── Spine.js        # Compresses & base64-encodes Spine assets
│   ├── framework/          # Runtime Phaser code
│   │   ├── App.js          # Phaser.Game bootstrap, resize handling, network init
│   │   ├── Preloader.js    # Phaser Scene — loads all base64 resources into cache
│   │   ├── Utils.js        # Portrait/landscape reactive properties (pos, scale, etc.)
│   │   └── components/
│   │       ├── Scene.js    # Base Phaser.Scene with mainContainer and responsive layout
│   │       ├── BitmapMask.js
│   │       ├── GeometryMask.js
│   │       └── Debug.js
│   ├── libs/               # Bundled JS libraries (Phaser, SpinePlugin)
│   ├── networks/           # Ad network SDK wrappers
│   │   ├── Network.js      # Base class (openStore, addClickToStore, getUrl)
│   │   ├── Applovin.js
│   │   ├── Facebook.js
│   │   ├── Google.js
│   │   ├── IronSource.js
│   │   ├── Liftoff.js
│   │   ├── TikTok.js
│   │   ├── UnityAds.js
│   │   └── Vungle.js
│   └── template/           # HTML shell templates
│       ├── mraid.html      # Used by most networks
│       ├── dapi.html       # Used by IronSource (DAPI)
│       ├── font.html       # @font-face snippet template
│       └── config.json     # TikTok ad config
├── src/                    # Game-specific source code (edit these)
│   ├── Game.js             # Main game scene
│   ├── Background.js
│   ├── Button.js
│   ├── Logo.js
│   └── GameStartedText.js
└── temp/                   # Scratch directory used during build (auto-created)
```

---

## Prerequisites

- **Node.js** 14+ and npm
- **FFmpeg** — required for audio sprite generation (installed automatically via `@ffmpeg-installer/ffmpeg`)

---

## Installation

```bash
npm install
```

---

## Configuration

Edit `config.js` at the project root:

```js
module.exports = {
    name: 'MyAd',                        // Ad title, used in filenames
    networks: ['Applovin', 'Facebook'],  // Networks to build for (production)
    customPhaser: true,                  // Use phaser-custom.min.js (smaller build)
    compressAtlas: true,                 // Compress sprite atlas (pngquant + mozjpeg)
    compressTexture: true,               // Compress individual textures
    compressAudio: true,                 // Compress audio to 32 kbps (false = 128 kbps)
    ios: 'https://apps.apple.com/...',   // iOS store URL
    android: 'https://play.google.com/...', // Android store URL
    currentVersion: 'v_1',              // Active version in dev mode
    versions: {
        v_1: {
            audio:    [],   // Audio file names (without extension) included in v_1
            fonts:    [],   // Font file names (without .ttf) included in v_1
            sheets:   [],   // Sprite names (without extension) included in v_1
            textures: []    // Texture names (without extension) included in v_1
        }
    }
};
```

**Version asset lists** control which files from each asset folder are included in a given version. An asset not listed in *any* version is included in all versions. An asset listed in a different version is excluded from the current one.

---

## Assets

Place source files in the corresponding `assets/` subdirectory before running a build.

| Type | Folder | Format | Notes |
|---|---|---|---|
| Individual textures | `assets/textures/` | PNG, JPG | Compressed with pngquant/mozjpeg |
| Sprite sheet frames | `assets/sheets/` | PNG, JPG | Packed into a single atlas automatically |
| Fonts | `assets/fonts/` | TTF | Embedded as `@font-face` |
| Audio | `assets/audio/` | MP3 | Converted to m4a + ogg audiosprite |
| Spine animations | `assets/spine/` | PNG + JSON + atlas | Requires SpinePlugin |

All assets are inlined as base64 strings into `window.App.resources.*` in the final HTML.

---

## Development

```bash
npm run dev
```

- Starts `webpack-dev-server` on **http://localhost:3080**
- Automatically opens the browser on first build
- Uses `config.currentVersion` to select assets
- Game code is served as a separate `main.js` script (fast rebuilds)
- Network defaults to the first entry in `config.networks`

---

## Production Build

```bash
npm run prod
```

- Outputs to `dist/<version>/`
- For each version and each network, a fully self-contained HTML file is generated with all assets and game code inlined
- Network-specific output formats:

| Network | Output |
|---|---|
| Google | `<name>(Adwords).zip` containing `index.html` |
| TikTok | `<name>(TikTok).zip` containing `index.html` + `config.json` |
| Vungle | `<name>(Vungle)/ad.html` folder |
| All others | `<name>(<Network>).html` single file |

---

## Supported Networks

`Applovin`, `Facebook`, `Google`, `IronSource`, `Liftoff`, `TikTok`, `UnityAds`, `Vungle`

Add or remove entries in `config.networks` to control which networks are built.

---

## Multi-Version Support

Define multiple versions in `config.versions` to build A/B variants in a single production run:

```js
versions: {
    v_1: { textures: ['bg_blue'], audio: [], fonts: [], sheets: [] },
    v_2: { textures: ['bg_red'], audio: [], fonts: [], sheets: [] }
}
```

Each version gets its own subfolder in `dist/`, and all networks are built for every version sequentially.

---

## Framework Overview

### Responsive Layout — `Utils.js`

Game objects receive portrait/landscape reactive setters via `Utils.addDefaultProperties`. Supported reactive properties:

| Property pair | Effect |
|---|---|
| `px` / `lx`, `py` / `ly` | Position in portrait / landscape |
| `pScaleX` / `lScaleX`, `pScaleY` / `lScaleY` | Scale |
| `pAngle` / `lAngle` | Rotation |
| `pAlpha` / `lAlpha` | Opacity |
| `pVisible` / `lVisible` | Visibility |
| `pImage` / `lImage` | Texture swap |
| `align` | Anchor point (`Top`, `Bottom`, `Left`, `Right`, `Center`) |

### Network Abstraction — `Network.js`

All network classes extend `Network`. Key methods:

- `network.addClickToStore(obj)` — makes any Phaser GameObject open the store on tap
- `network.openStore()` — navigates to the correct store URL based on device OS
- `network.complete()` — override in network subclass to fire the "ad completed" SDK event

### Scene Base Class — `Scene.js`

Extends `Phaser.Scene`. Provides:
- `this.mainContainer` — root container; add all display objects here
- Auto-mutes audio until first pointer interaction
- Static breakpoint constants: `PORTRAIT_MAX_WIDTH`, `LANDSCAPE_MAX_HEIGHT`, etc.

---

## Adding Game Logic

Edit files in `src/`. The entry point is `src/Game.js` which extends `Scene`.

```js
// src/Game.js
export default class Game extends ParentScene {
    create() {
        this.initScene();
    }
    initScene() {
        // Create display objects here using core components
    }
    onCta() {
        network.complete();      // fire ad-complete event
        network.openStore();     // open store
    }
}
```
