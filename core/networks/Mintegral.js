import Network from './Network.js'

export default class Mintegral extends Network {
    constructor(callback) {
        super(callback);

        // Expose global public function window.gameStart as required by Mintegral SDK specification
        window.gameStart = () => {
            console.log('[Mintegral SDK] gameStart invoked');
            if (typeof window.App !== 'undefined') {
                window.App.isMintegralStarted = true;
                if (window.App.activeGame) {
                    const game = window.App.activeGame;
                    if (typeof game.ensureBackgroundMusic === 'function') {
                        game.ensureBackgroundMusic();
                    }
                    if (typeof game.startChallenge === 'function') {
                        game.startChallenge();
                    }
                }
            }
            if (typeof window.gameReady === 'function') {
                window.gameReady();
            }
        };

        // Expose global public function window.gameClose as required by Mintegral SDK specification
        window.gameClose = () => {
            console.log('[Mintegral SDK] gameClose invoked');
            if (typeof window.App !== 'undefined') {
                if (window.App.bgMusic && typeof window.App.bgMusic.stop === 'function') {
                    try {
                        window.App.bgMusic.stop();
                    } catch (e) {
                        console.warn('[Mintegral SDK] Error stopping bgMusic on gameClose:', e);
                    }
                }
                if (window.App.activeGame && window.App.activeGame.sound) {
                    try {
                        window.App.activeGame.sound.mute = true;
                        window.App.activeGame.sound.stopAll();
                    } catch (e) {
                        console.warn('[Mintegral SDK] Error silencing sounds on gameClose:', e);
                    }
                }
            }
        };
    }

    ready() {
        if (typeof window.gameStart === 'function') {
            window.gameStart();
        } else if (typeof window.gameReady === 'function') {
            window.gameReady();
        }
    }

    complete() {
        if (typeof window.gameEnd === 'function') {
            window.gameEnd();
        }
    }

    openStore() {
        if (typeof window.install === 'function') {
            window.install();
        }
        if (window.mraid && typeof window.mraid.open === 'function') {
            try {
                window.mraid.open(this.getUrl());
            } catch (e) {
                console.warn('[Mintegral SDK] window.mraid.open failed:', e);
            }
        } else {
            try {
                if (window.top && window.top.open) {
                    window.top.open(this.getUrl());
                } else {
                    window.open(this.getUrl(), '_blank');
                }
            } catch (e) {
                try {
                    window.open(this.getUrl(), '_blank');
                } catch (err) {
                    console.warn('[Mintegral SDK] openStore fallback failed:', err);
                }
            }
        }
    }
}