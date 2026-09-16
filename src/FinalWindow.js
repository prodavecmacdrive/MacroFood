import Utils from "../core/framework/Utils";
import SETTINGS from "../final-window-settings.json";

export default class FinalWindow {
    constructor({ scene, container, onCta, onRetry }) {
        this._scene = scene;
        this._container = container;
        this._onCta = onCta;
        this._onRetry = onRetry;

        this._isWin = true;
        this._helperTimer = null;
        this._handTween = null;
        this._handPulsing = null;
        this._userInteracted = false;

        this._buildOverlay();
        this._buildBanner();
        this._buildButton();
        this._buildHelperHand();

        this.setVisible(false);
    }

    _buildOverlay() {
        const cfg = SETTINGS.overlay || { fillAlpha: 0.75, depth: 100 };
        this._overlay = this._scene.add.graphics();
        this._overlay.fillStyle(0x000000, cfg.fillAlpha !== undefined ? cfg.fillAlpha : 0.75);
        this._overlay.fillRect(-3000, -3000, 6000, 6000);
        this._overlay.setDepth(cfg.depth || 100);
        this._overlay.setAlpha(0);

        // Blocker image to catch all background pointers
        // Use any existing texture scaled up and transparent
        const sampleTex = this._scene.textures.exists('win_text') ? 'win_text' : (this._scene.textures.exists('conveyor') ? 'conveyor' : null);
        if (sampleTex) {
            this._overlayBlocker = this._scene.add.image(300, 500, sampleTex);
            this._overlayBlocker.setDisplaySize(6000, 6000);
            this._overlayBlocker.setOrigin(0.5, 0.5);
            this._overlayBlocker.setAlpha(0.001); // virtually invisible but interactive
            this._overlayBlocker.setDepth((cfg.depth || 100) + 1);
            this._overlayBlocker.setInteractive();
            this._overlayBlocker.on('pointerdown', (pointer) => {
                if (pointer && pointer.event && typeof pointer.event.stopPropagation === 'function') {
                    pointer.event.stopPropagation();
                }
                this._dismissHelperHand();
            });
            this._container.add(this._overlayBlocker);
        }
        this._container.add(this._overlay);
    }

    _resolveTexture(baseKey) {
        if (!baseKey) return null;
        const underscoreKey = baseKey.replace(/-/g, '_');
        const hyphenKey = baseKey.replace(/_/g, '-');

        if (this._scene.textures.exists(hyphenKey)) return hyphenKey;
        if (this._scene.textures.exists(underscoreKey)) return underscoreKey;

        // Dynamic base64 texture registration if not yet in cache
        if (typeof window !== 'undefined' && window.App && window.App.resources && window.App.resources.textures) {
            const rawB64 = window.App.resources.textures[underscoreKey] || window.App.resources.textures[hyphenKey];
            if (rawB64) {
                try {
                    this._scene.textures.addBase64(hyphenKey, rawB64);
                    this._scene.textures.addBase64(underscoreKey, rawB64);
                    return hyphenKey;
                } catch (e) {
                    console.warn('[FinalWindow] Failed to load base64 texture on demand:', baseKey, e);
                }
            }
        }
        return this._scene.textures.exists(baseKey) ? baseKey : (this._scene.textures.exists(underscoreKey) ? underscoreKey : null);
    }

    _buildBanner() {
        const tex = this._resolveTexture('win_text') || 'win_text';
        this._banner = this._scene.add.image(300, 310, tex);
        this._banner.setOrigin(0.5, 0.5);
        this._banner.setScale(0.72);
        this._banner.setDepth(105);
        this._banner.setAlpha(0);
        this._container.add(this._banner);
    }

    _buildButton() {
        const tex = this._resolveTexture('btn-play_next') || 'btn_play_next';
        this._btn = this._scene.add.image(300, 520, tex);
        this._btn.setOrigin(0.5, 0.5);
        this._btn.setScale(0.88);
        this._btn.setDepth(106);
        this._btn.setAlpha(0);
        this._btn.setInteractive({ useHandCursor: true });

        // Player Pointer Interaction (Real Press/Release)
        this._btn.on('pointerdown', () => {
            this._dismissHelperHand();
            this._setButtonPressed(true);
        });

        this._btn.on('pointerup', () => {
            this._setButtonPressed(false);
            this._handleCtaClick();
        });

        this._btn.on('pointerout', () => {
            this._setButtonPressed(false);
        });

        this._container.add(this._btn);
    }

    _buildHelperHand() {
        const tex = this._resolveTexture('helper_hand') || 'helper_hand';
        this._hand = this._scene.add.image(300, 520, tex);
        this._hand.setOrigin(0.2, 0.15); // Natural pointer finger touch point
        this._hand.setScale(0.55);
        this._hand.setDepth(115);
        this._hand.setAlpha(0);
        this._container.add(this._hand);
    }

    _setButtonPressed(pressed) {
        if (!this._btn || !this._btn.active) return;
        const currentScale = pressed ? 0.82 : 0.88;
        this._btn.setScale(currentScale);

        let targetKey;
        if (this._isWin) {
            targetKey = pressed ? 'btn-play_next_clicked' : 'btn-play_next';
        } else {
            targetKey = pressed ? 'btn-try_again_clicked' : 'btn-try_again';
        }

        const resolved = this._resolveTexture(targetKey);
        if (resolved) {
            this._btn.setTexture(resolved);
        }
    }

    setVisible(visible) {
        if (this._overlay) this._overlay.setVisible(visible);
        if (this._overlayBlocker) {
            this._overlayBlocker.setVisible(visible);
            if (this._overlayBlocker.input) {
                this._overlayBlocker.input.enabled = visible;
            }
        }
        if (this._banner) this._banner.setVisible(visible);
        if (this._btn) {
            this._btn.setVisible(visible);
            if (this._btn.input) {
                this._btn.input.enabled = visible;
            }
        }
        if (this._hand) this._hand.setVisible(visible);
    }

    show(isWin = true) {
        this._isWin = isWin;
        this._userInteracted = false;

        // Analytics tracking
        if (typeof window.trackAxonEvent === 'function') {
            window.trackAxonEvent(isWin ? 'CHALLENGE_SOLVED' : 'CHALLENGE_FAILED');
            window.trackAxonEvent('ENDCARD_SHOWN');
        }

        // Play appropriate sound effect
        try {
            const soundKey = isWin ? 'win_sound' : 'fail_sound';
            if (typeof window !== 'undefined' && window.App && window.App.resources && window.App.resources.audio && window.App.resources.audio.json) {
                const spritemap = window.App.resources.audio.json.spritemap || {};
                if (spritemap[soundKey]) {
                    const sound = this._scene.sound.addAudioSprite('sfx');
                    if (sound) sound.play(soundKey, { volume: 0.85 });
                }
            } else if (this._scene && this._scene.sound) {
                this._scene.sound.play(soundKey, { volume: 0.85 });
            }
        } catch (e) {
            console.warn('[FinalWindow] Sound play error:', e);
        }

        // Configure banner and button textures
        if (this._banner && this._banner.active) {
            const bannerTex = this._resolveTexture(isWin ? 'win_text' : 'fail_text');
            if (bannerTex) {
                this._banner.setTexture(bannerTex);
            }
        }

        if (this._btn && this._btn.active) {
            const btnTex = this._resolveTexture(isWin ? 'btn-play_next' : 'btn-try_again');
            if (btnTex) {
                this._btn.setTexture(btnTex);
            }
            this._btn.setScale(0.88);
        }

        this.setVisible(true);

        // Animate overlay
        this._scene.tweens.add({
            targets: this._overlay,
            alpha: 0.75,
            duration: 400,
            ease: 'Power2'
        });

        // Pop in banner
        this._banner.setScale(0.3);
        this._banner.setAlpha(0);
        this._scene.tweens.add({
            targets: this._banner,
            scale: 0.72,
            alpha: 1,
            duration: 450,
            ease: 'Back.Out'
        });

        // Pop in button
        this._btn.setScale(0.3);
        this._btn.setAlpha(0);
        this._scene.tweens.add({
            targets: this._btn,
            scale: 0.88,
            alpha: 1,
            duration: 450,
            delay: 150,
            ease: 'Back.Out'
        });

        // Start 3-second helper hand timer
        this._startHelperHandTimer();
    }

    _startHelperHandTimer() {
        if (this._helperTimer) {
            this._helperTimer.remove();
        }

        this._helperTimer = this._scene.time.delayedCall(3000, () => {
            if (this._userInteracted) return;
            this._animateHelperHand();
        });
    }

    _animateHelperHand() {
        if (!this._hand || !this._hand.active || this._userInteracted) return;

        const targetX = this._btn.x + 18;
        const targetY = this._btn.y + 24;

        // Start hand from off-screen bottom right
        this._hand.setPosition(targetX + 90, targetY + 140);
        this._hand.setScale(0.65);
        this._hand.setAlpha(0);

        // Move to button
        this._handTween = this._scene.tweens.add({
            targets: this._hand,
            x: targetX,
            y: targetY,
            alpha: 1,
            duration: 550,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                if (this._userInteracted || !this._hand.active) return;
                this._runHandTapCycle();
            }
        });
    }

    _runHandTapCycle() {
        if (this._userInteracted || !this._hand || !this._hand.active) return;

        // Simulated tap down
        this._scene.tweens.add({
            targets: this._hand,
            scale: 0.52,
            duration: 220,
            ease: 'Quad.easeInOut',
            onComplete: () => {
                if (this._userInteracted || !this._hand.active) return;
                // Swap button visual to clicked state during tap
                this._setButtonPressed(true);

                // Hold briefly then release
                this._scene.time.delayedCall(160, () => {
                    if (this._userInteracted || !this._hand.active) return;
                    this._setButtonPressed(false);

                    this._scene.tweens.add({
                        targets: this._hand,
                        scale: 0.62,
                        duration: 250,
                        ease: 'Quad.easeOut',
                        onComplete: () => {
                            if (this._userInteracted || !this._hand.active) return;
                            // Repeat tap after pause
                            this._scene.time.delayedCall(700, () => {
                                this._runHandTapCycle();
                            });
                        }
                    });
                });
            }
        });
    }

    _dismissHelperHand() {
        this._userInteracted = true;
        if (this._helperTimer) {
            this._helperTimer.remove();
            this._helperTimer = null;
        }
        if (this._handTween) {
            this._handTween.stop();
            this._handTween = null;
        }
        if (this._hand && this._hand.active) {
            this._scene.tweens.killTweensOf(this._hand);
            this._scene.tweens.add({
                targets: this._hand,
                alpha: 0,
                duration: 200,
                onComplete: () => {
                    if (this._hand && this._hand.active) {
                        this._hand.setVisible(false);
                    }
                }
            });
        }
    }

    _handleCtaClick() {
        const now = performance.now();
        if (this._lastCtaTime && now - this._lastCtaTime < 500) return;
        this._lastCtaTime = now;

        if (this._onCta) this._onCta();
    }
}

