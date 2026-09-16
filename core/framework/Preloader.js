import TRANSITION_SETTINGS from '../../transition-screen-settings.json';

export default class Preloader extends Phaser.Scene {
    constructor() {
        super({ key: 'Preloader' });
    }

    preload() {
    }


    create() {
        if (typeof window.trackAxonEvent === 'function') window.trackAxonEvent('LOADING');

        this.loaded = 0;
        this.audioLoaded = false;

        this.loadTotal = Object.keys(App.resources.textures).length + Object.keys(App.resources.spine).length;
        window.App.resources.sheets.json && this.loadTotal++;
        window.App.resources.audio.json && this.loadTotal++;

        for (let key in App.resources.textures) {
            this.textures.addBase64(key, window.App.resources.textures[key]);
            // Also register hyphenated alias if the key contains underscores
            if (key.includes('_')) {
                const hyphenKey = key.replace(/_/g, '-');
                this.textures.addBase64(hyphenKey, window.App.resources.textures[key]);
            }
            this.loaded++;
        }

        if (window.App.resources.sheets.json) {
            let shardsImg = new Image();
            shardsImg.onload = () => {
                this.textures.addAtlas('atlas', shardsImg, window.App.resources.sheets.json);
                this.loaded++;

                this.startGame();
            };
            shardsImg.src = window.App.resources.sheets.png;
        }

        if (window.App.resources.audio.json) {
            this.cache.json.add('sfx', window.App.resources.audio.json);

            let codec = window.App.resources.audio.m4a;
            if (!this.game.device.audio.m4a) codec = window.App.resources.audio.ogg;
            let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.decodeAudioData(this.base64ToArrayBuffer(codec), (buffer) => {
                if (this.audioLoaded) return;

                this.cache.audio.add('sfx', buffer);
                this.loaded++;

                this.audioLoaded = true;

                // Play background music once global audio is loaded
                if (window.App.resources.audio.json && !window.App.isMusicPlaying) {
                    let sound = this.game.sound.addAudioSprite('sfx');
                    const musicTrackKey = window.App.resources.audio.json.spritemap && window.App.resources.audio.json.spritemap['music'] ? 'music' : 'mucis';
                    sound.play(musicTrackKey, { loop: true, volume: 0.95 });
                    window.App.isMusicPlaying = true;
                    window.App.bgMusic = sound;
                }

                this.startGame();
            });

            setTimeout(() => {
                if (this.audioLoaded) return;
                this.loaded++;

                this.audioLoaded = true;

                this.startGame();
            }, 1000)
        }

        for (var key in App.resources.spine) {
            this._loadInlineSpine(key, App.resources.spine[key]);
        }

        this.startGame();
    }

    _loadInlineSpine(key, spineData) {
        console.log(`[Preloader] Starting load for inline Spine asset: '${key}'`);
        if (!spineData || !spineData.png || !spineData.atlas || !spineData.json) {
            console.warn(`[Preloader] Spine asset '${key}' is missing required data (png/atlas/json). Skipping.`);
            this.loaded++;
            this.startGame();
            return;
        }

        const pageNames = this._extractSpinePageNames(spineData.atlas, `${key}.png`);
        let remainingPages = pageNames.length;

        const finalize = () => {
            if (remainingPages > 0) {
                return;
            }

            const spineCache = this.cache.custom?.spine || this.cache.addCustom('spine');
            if (!spineCache.has(key)) {
                spineCache.add(key, {
                    preMultipliedAlpha: false,
                    data: spineData.atlas,
                    prefix: ''
                });
            }

            if (!this.cache.json.has(key)) {
                this.cache.json.add(key, JSON.parse(spineData.json));
            }

            console.log(`[Preloader] Successfully loaded and cached Spine asset: '${key}'`);
            this.loaded++;
            this.startGame();
        };

        if (remainingPages === 0) {
            finalize();
            return;
        }

        for (const pageName of pageNames) {
            if (this.textures.exists(pageName)) {
                remainingPages--;
                finalize();
                continue;
            }

            this._loadBase64Image(
                spineData.png,
                (image) => {
                    if (!this.textures.exists(pageName)) {
                        this.textures.addImage(pageName, image);
                    }

                    remainingPages--;
                    finalize();
                },
                () => {
                    console.warn(`[Preloader] spine texture failed for ${key}:${pageName}`);
                    remainingPages--;
                    finalize();
                }
            );
        }
    }

    _extractSpinePageNames(atlasText, fallbackPageName) {
        const lines = atlasText.split(/\r?\n/);
        const pageNames = [];

        for (let index = 0; index < lines.length - 1; index++) {
            const current = lines[index].trim();
            const next = lines[index + 1].trim();

            if (current && next.startsWith('size:')) {
                pageNames.push(current);
            }
        }

        if (pageNames.length === 0 && fallbackPageName) {
            pageNames.push(fallbackPageName);
        }

        return [...new Set(pageNames)];
    }

    _loadBase64Image(base64, onLoad, onError) {
        const image = new Image();
        image.onload = () => onLoad(image);
        image.onerror = onError;
        image.src = base64;
    }

    base64ToArrayBuffer(base64) {
        let binaryString = window.atob(base64);
        let len = binaryString.length;
        let bytes = new Uint8Array(len);

        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        return bytes.buffer;
    }

    startGame() {
        if (this.loaded !== this.loadTotal) return;

        this.loadTotal = -1;

        if (typeof window.trackAxonEvent === 'function') window.trackAxonEvent('LOADED');

        this.time.addEvent({
            delay: 250, callback: () => {
                document.getElementById('loader').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                if (typeof window.trackAxonEvent === 'function') window.trackAxonEvent('DISPLAYED');

                // Notify ad network SDK (e.g., Mintegral gameReady) to hide SDK loader overlay
                if (typeof window !== 'undefined' && window.App && window.App.networkInstance && typeof window.App.networkInstance.ready === 'function') {
                    window.App.networkInstance.ready();
                } else if (typeof window !== 'undefined' && typeof window.gameReady === 'function') {
                    window.gameReady();
                }

                if (typeof window.App.isDev === 'undefined') {
                    window.App.isDev = window.location && (
                        window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1' ||
                        window.location.port === '3080'
                    );
                }

                console.log('[Preloader] autoShowOnLaunchMs test', {
                    isDev: window.App.isDev,
                    autoShowOnLaunchMs: TRANSITION_SETTINGS.autoShowOnLaunchMs,
                    willShowTransition: window.App.isDev && TRANSITION_SETTINGS.autoShowOnLaunchMs > 0
                });

                if (window.App.isDev && TRANSITION_SETTINGS.autoShowOnLaunchMs > 0) {
                    this.time.delayedCall(TRANSITION_SETTINGS.autoShowOnLaunchMs, () => {
                        this.scene.start('TransitionScene');
                    });
                } else if (window.App.levelSelect) {
                    this.scene.start('TransitionScene');
                } else {
                    this.scene.start('Game', { sceneId: window.App.stateManager.getNextScene() });
                }
            }, callbackScope: this
        });
    }
}