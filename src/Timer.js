import Utils from "../core/framework/Utils";
import SETTINGS from "../game-timer.json";

/**
 * Timer (Stopwatch)
 * -----------------
 * Displays a stopwatch in the upper-right corner of the screen.
 * Layout inside the container:
 *   timer_bg     – background face of the stopwatch
 *   timer_btn    – crown button sitting at the top edge of timer_bg
 *   timer_arrow_s  – seconds hand  (1 full rotation / 60 s), origin at base = clock centre
 *   timer_arrow_ms – ms/fast hand  (1 full rotation / 1 s),  origin just above clock centre
 *
 * Usage:
 *   const timer = new Timer({ scene, container, onTimeout: () => showFinalWindow() });
 *   timer.start();       // simulates button press, then begins ticking
 *   timer.stopAndReset(); // on level win – freeze + reset hands to 12-o'clock
 *   timer.stop();        // on any other game-over without resetting visuals
 */
export default class Timer extends Phaser.GameObjects.Container {
    constructor({ scene, container, onTimeout, onNearEnd, gameFinalTime }) {
        super(scene, 0, 0);

        this._onTimeout = onTimeout;
        this._onNearEnd = onNearEnd;
        this._gameFinalTime = gameFinalTime;
        this._elapsedMs = 0;
        this._running = false;
        this._triggered = false;
        this._nearEndFired = false;

        this._build();

        container.add(this);
        this.setDepth(SETTINGS.depth);

        // ── Responsive positioning & scaling ──────────────────────────────────
        this.addProperties(['pos', 'scale']);
        this.setAlign('Center');
        this.px = 0;
        this.py = 0;
        this.lx = 0;
        this.ly = 0;
        this.pScaleX = 1;
        this.pScaleY = 1;
        this.lScaleX = 1;
        this.lScaleY = 1;
        this.alpha = 0;

        this._rotationTimeline = null;
        this._rotationShake = null;
        this._rotationActive = false;
        this._finalZoomActive = false;
        this._timeoutSequenceActive = false;

        // ── Per-frame tick ────────────────────────────────────────────────────
        // Capture scene ref — Phaser nulls out this.scene before firing shutdown
        const sceneRef = this.scene;
        sceneRef.events.on('update', this._tick, this);
        sceneRef.events.once('shutdown', () => {
            sceneRef.events.off('update', this._tick, this);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Construction
    // ─────────────────────────────────────────────────────────────────────────

    _build() {
        const cfg = SETTINGS;

        // Background
        this._bg = this.scene.add.image(0, 0, 'timer_bg');
        this._bg.setDepth(cfg.bg.depth);
        this.add(this._bg);

        // Countdown text above the clock face
        const textStyle = {
            fontFamily: cfg.text.fontFamily,
            fontSize: `${cfg.text.fontSize}px`,
            color: cfg.text.color,
            stroke: cfg.text.stroke,
            strokeThickness: cfg.text.strokeThickness
        };
        if (cfg.text.backgroundColor) {
            textStyle.backgroundColor = cfg.text.backgroundColor;
        }

        this._countdownText = this.scene.add.text(cfg.text.offsetX, cfg.text.offsetY, '', textStyle)
            .setOrigin(0.5, 0.5)
            .setDepth(cfg.text.depth);

        if (typeof cfg.text.alpha === 'number') {
            this._countdownText.setAlpha(cfg.text.alpha);
        }

        this.add(this._countdownText);

        // Crown button – bottom-centre anchored to the top edge of the bg
        this._btnBaseX = cfg.btn.offsetX || 0;
        this._btnBaseY = -this._bg.height * 0.5 + cfg.btn.topOffsetY;
        this._btn = this.scene.add.image(this._btnBaseX, this._btnBaseY, 'timer_btn');
        this._btn.setOrigin(0.52, 0.7);
        this._btn.setDepth(cfg.btn.depth);
        this.add(this._btn);

        // Seconds hand – rotate around its own center
        this._arrowS = this.scene.add.image(cfg.arrowS.offsetX, cfg.arrowS.offsetY + cfg.clockCenterOffsetY, 'timer_arrow_s');
        this._arrowS.setOrigin(0.5, 0.5);
        this._arrowS.setDepth(cfg.arrowS.depth);
        this.add(this._arrowS);

        // Milliseconds hand – rotate around its own center
        this._arrowMs = this.scene.add.image(cfg.arrowMs.offsetX, cfg.arrowMs.offsetY + cfg.clockCenterOffsetY, 'timer_arrow_ms');
        this._arrowMs.setOrigin(0.5, 0.5);
        this._arrowMs.setDepth(cfg.arrowMs.depth);
        this.add(this._arrowMs);

        this.sort('depth');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /** Reset state, play button-press animation, then start ticking. */
    start(onStarted) {
        this._reset();
        this._prepareIntroState();
        this._playAppearance(() => {
            this._simulateButtonClick(() => {
                this._animateToFinalPosition(() => {
                    this._running = true;
                    if (onStarted) onStarted();
                });
            });
        });
    }

    /** Freeze the timer without resetting the visuals (game over / loss). */
    stop() {
        this._running = false;
    }

    /** Freeze and reset hands to 12-o'clock (level completed). */
    stopAndReset() {
        this._running = false;
        this._reset();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    _reset() {
        this._elapsedMs = 0;
        this._triggered = false;
        this._running = false;
        this._nearEndFired = false;
        this._lastDisplayedSeconds = Math.ceil((this._gameFinalTime * 10) / 1000);
        this._arrowS.rotation = 0;
        this._arrowMs.rotation = 0;
        this.rotation = 0;
        this._rotationActive = false;
        this._finalZoomActive = false;
        this._timeoutSequenceActive = false;
        if (this._rotationTimeline) {
            this._rotationTimeline.stop();
            this._rotationTimeline = null;
            this._rotationShake = null;
        }
        this.setVisible(true);
        this._updateCountdownText(this._lastDisplayedSeconds);
        this.scene.tweens.killTweensOf(this._btn);
        this.scene.tweens.killTweensOf(this._countdownText);
        this.scene.tweens.killTweensOf(this);
        this._bg.clearTint();
        this._btn.y = this._btnBaseY;
        this._btn.rotation = 0;
    }

    _prepareIntroState() {
        const cfg = SETTINGS.appearance;
        this.setAlign('Center');
        this.px = 0;
        this.py = 0;
        this.lx = 0;
        this.ly = 0;
        this.pScaleX = cfg.initialScale;
        this.pScaleY = cfg.initialScale;
        this.lScaleX = cfg.initialScale;
        this.lScaleY = cfg.initialScale;
        this.alpha = 0;
        this.rotation = 0;
    }

    /** Simulate a physical button press: move crown down, rotate, then return. */
    _simulateButtonClick(onComplete) {
        const cfg = SETTINGS.btn;
        const origY = this._btnBaseY;
        this.scene.tweens.add({
            targets: this._btn,
            y: origY + cfg.pressOffsetY,
            duration: cfg.pressDurationMs,
            ease: 'Cubic.Out',
            yoyo: true
        });

        this.scene.tweens.add({
            targets: this,
            rotation: cfg.pressRotationDeg * Math.PI / 180,
            duration: Math.max(cfg.pressDurationMs, cfg.pressRotationDurationMs),
            ease: 'Cubic.Out',
            yoyo: true,
            onComplete
        });
    }

    /** Called every scene frame via the 'update' event. */
    _tick(time, delta) {
        if (!this._running) return;

        this._elapsedMs += delta;

        // timer_arrow_ms : 1 full rotation (2π rad) every 1 000 ms
        this._arrowMs.rotation = (this._elapsedMs / 1000) * Math.PI * 2;
        // timer_arrow_s  : 1 full rotation (2π rad) every 60 000 ms
        this._arrowS.rotation = (this._elapsedMs / 60000) * Math.PI * 2;

        const remainingMs = Math.max(0, this._gameFinalTime * 10 - this._elapsedMs);
        const remainingSeconds = Math.ceil(remainingMs / 1000);

        if (remainingSeconds !== this._lastDisplayedSeconds) {
            this._lastDisplayedSeconds = remainingSeconds;
            this._updateCountdownText(remainingSeconds);
            if (remainingSeconds > 0) {
                this._twitchCountdownText();
            }

            if (remainingSeconds > 0 && remainingSeconds <= SETTINGS.warning.thresholdSeconds) {
                this._flashWarning();
                this._twitchTimer();
            }
        }

        if (!this._finalZoomActive && remainingMs > 0 && remainingMs <= 1000) {
            this._startFinalZoomToCenter();
        }

        if (!this._rotationActive && remainingMs <= 2000) {
            this._rotationActive = true;
            this._startFinalRotation();
        }

        if (!this._nearEndFired && remainingMs <= 2000 && remainingMs > 0) {
            this._nearEndFired = true;
            if (this._onNearEnd) {
                this._onNearEnd();
            }
        }

        // gameFinalTime is stored in centiseconds (* 10 converts to ms)
        if (!this._triggered && this._elapsedMs >= this._gameFinalTime * 10) {
            this._triggered = true;
            this._running = false;
            this._startTimeoutSequence();
        }
    }

    _updateCountdownText(seconds) {
        this._countdownText.setText(`${seconds}`);
    }

    _playAppearance(onComplete) {
        const cfg = SETTINGS.appearance;

        this.scene.tweens.add({
            targets: this,
            alpha: 1,
            duration: cfg.fadeDurationMs,
            ease: 'Linear'
        });

        this.scene.tweens.add({
            targets: this,
            scaleX: cfg.overshootScale,
            scaleY: cfg.overshootScale,
            duration: cfg.bounceDurationMs,
            ease: 'Back.Out',
            yoyo: true,
            onComplete
        });
    }

    _animateToFinalPosition(onComplete) {
        const cfg = SETTINGS.appearance;
        const isPortrait = this.scene.game.size.isPortrait;
        const orientationScale = SETTINGS.timerScale || SETTINGS.scale || { portrait: 1, landscape: 1 };
        const targetScale = SETTINGS.globalScale * (isPortrait ? orientationScale.portrait : orientationScale.landscape);
        const targetX = this._getFinalX(isPortrait);
        const targetY = this._getFinalY(isPortrait);

        this.scene.tweens.add({
            targets: this,
            x: targetX,
            y: targetY,
            duration: cfg.repositionDurationMs,
            ease: cfg.repositionEase,
            onComplete: () => {
                this.setAlign(SETTINGS.container.align);
                this.px = SETTINGS.container.portraitX;
                this.py = SETTINGS.container.portraitY;
                this.lx = SETTINGS.container.landscapeX;
                this.ly = SETTINGS.container.landscapeY;
                this.pScaleX = SETTINGS.globalScale * orientationScale.portrait;
                this.pScaleY = SETTINGS.globalScale * orientationScale.portrait;
                this.lScaleX = SETTINGS.globalScale * orientationScale.landscape;
                this.lScaleY = SETTINGS.globalScale * orientationScale.landscape;
                if (onComplete) onComplete();
            }
        });

        this.scene.tweens.add({
            targets: this,
            scaleX: targetScale,
            scaleY: targetScale,
            duration: cfg.repositionDurationMs,
            ease: cfg.repositionEase
        });
    }

    _getFinalX(isPortrait) {
        const size = this.scene.game.size;
        let alignX = size.x;
        const align = SETTINGS.container.align;
        if (align.includes('Left')) alignX = size.left;
        else if (align.includes('Rigth') || align.includes('Right')) alignX = size.right;
        return alignX + (isPortrait ? SETTINGS.container.portraitX : SETTINGS.container.landscapeX);
    }

    _getFinalY(isPortrait) {
        const size = this.scene.game.size;
        let alignY = size.y;
        const align = SETTINGS.container.align;
        if (align.includes('Top')) alignY = size.top;
        else if (align.includes('Bottom')) alignY = size.bottom;
        return alignY + (isPortrait ? SETTINGS.container.portraitY : SETTINGS.container.landscapeY);
    }

    _twitchCountdownText() {
        const cfg = SETTINGS.text;
        this.scene.tweens.killTweensOf(this._countdownText);
        this.scene.tweens.add({
            targets: this._countdownText,
            scaleX: cfg.twitchScale,
            scaleY: cfg.twitchScale,
            duration: cfg.twitchDurationMs,
            ease: 'Power1',
            yoyo: true
        });
    }

    _twitchTimer() {
        const cfg = SETTINGS.warning;
        this.scene.tweens.killTweensOf(this);
        const startScaleX = this.scaleX;
        const startScaleY = this.scaleY;
        this.scene.tweens.add({
            targets: this,
            scaleX: startScaleX * cfg.twitchScale,
            scaleY: startScaleY * cfg.twitchScale,
            duration: cfg.twitchDurationMs,
            ease: 'Power1',
            yoyo: true
        });
    }

    _startFinalZoomToCenter() {
        const cfg = SETTINGS.finalCountdown || {};
        const size = this.scene.game.size;
        const centerOffsetX = cfg.centerOffsetX || 0;
        const centerOffsetY = cfg.centerOffsetY || 0;
        const targetScaleX = this.scaleX * (cfg.zoomScaleMultiplier || 1.8);
        const targetScaleY = this.scaleY * (cfg.zoomScaleMultiplier || 1.8);

        this._finalZoomActive = true;
        this.scene.tweens.killTweensOf(this);

        this.scene.tweens.add({
            targets: this,
            x: size.x + centerOffsetX,
            y: size.y + centerOffsetY,
            scaleX: targetScaleX,
            scaleY: targetScaleY,
            duration: cfg.zoomDurationMs || 240,
            ease: cfg.zoomEase || 'Back.Out',
            onComplete: () => {
                this.px = centerOffsetX;
                this.py = centerOffsetY;
                this.lx = centerOffsetX;
                this.ly = centerOffsetY;
                this.pScaleX = targetScaleX;
                this.pScaleY = targetScaleY;
                this.lScaleX = targetScaleX;
                this.lScaleY = targetScaleY;
                this.setAlign('Center');
            }
        });
    }

    _startTimeoutSequence() {
        const cfg = SETTINGS.finalCountdown || {};
        const pulseDurationMs = cfg.timeoutSequenceDurationMs || 1000;
        const pulseHalfDurationMs = pulseDurationMs / 2;
        const pulseScaleMultiplier = cfg.timeoutPulseScaleMultiplier || 1.14;
        const textScaleMultiplier = cfg.timeoutTextScaleMultiplier || 1.18;
        const twitchAngleRad = (cfg.timeoutTwitchAngleDeg || 8) * Math.PI / 180;

        if (this._timeoutSequenceActive) return;
        this._timeoutSequenceActive = true;

        if (this._rotationTimeline) {
            this._rotationTimeline.stop();
            this._rotationTimeline = null;
            this._rotationShake = null;
        }

        this.scene.tweens.killTweensOf(this);
        this.scene.tweens.killTweensOf(this._countdownText);
        this.rotation = 0;
        this._updateCountdownText(0);

        Utils.addAudio(this.scene, 'fail', cfg.failSoundVolume || 1);

        const startScaleX = this.scaleX;
        const startScaleY = this.scaleY;
        this.scene.tweens.add({
            targets: this,
            scaleX: startScaleX * pulseScaleMultiplier,
            scaleY: startScaleY * pulseScaleMultiplier,
            duration: pulseHalfDurationMs,
            ease: cfg.timeoutPulseEase || 'Sine.InOut',
            yoyo: true,
            onComplete: () => this._fadeOutAfterTimeout()
        });

        this.scene.tweens.add({
            targets: this,
            rotation: twitchAngleRad,
            duration: pulseDurationMs / 4,
            ease: 'Sine.InOut',
            yoyo: true,
            repeat: 1,
            onComplete: () => {
                this.rotation = 0;
            }
        });

        this.scene.tweens.add({
            targets: this._countdownText,
            scaleX: textScaleMultiplier,
            scaleY: textScaleMultiplier,
            duration: pulseHalfDurationMs,
            ease: 'Sine.InOut',
            yoyo: true
        });
    }

    _fadeOutAfterTimeout() {
        const cfg = SETTINGS.finalCountdown || {};

        this.scene.tweens.add({
            targets: this,
            alpha: 0,
            duration: cfg.timeoutFadeDurationMs || 260,
            ease: cfg.timeoutFadeEase || 'Linear',
            onComplete: () => {
                this.setVisible(false);
                if (this._onTimeout) {
                    this._onTimeout();
                }
            }
        });
    }

    _startFinalRotation() {
        const cfg = SETTINGS.warning;
        const angleDeg = cfg.rotationAngleDeg || 10;
        const stepDurationMs = cfg.rotationStepDurationMs || 100;
        const steps = cfg.rotationSteps || 20;

        if (!this.scene || !this.scene.tweens) return;
        if (this._rotationTimeline) {
            this._rotationTimeline.stop();
            this._rotationTimeline = null;
        }

        this._rotationShake = { angle: 0 };
        const timeline = this.scene.tweens.createTimeline();

        for (let i = 0; i < steps; i += 1) {
            const direction = (i % 2 === 0) ? 1 : -1;
            timeline.add({
                targets: this._rotationShake,
                angle: angleDeg * direction,
                duration: stepDurationMs,
                ease: 'Linear',
                onUpdate: () => {
                    this.rotation = this._rotationShake.angle * Math.PI / 180;
                }
            });
        }

        timeline.setCallback('onComplete', () => {
            this.rotation = 0;
            this._rotationTimeline = null;
            this._rotationShake = null;
        });

        this._rotationTimeline = timeline;
        timeline.play();
    }

    _flashWarning() {
        const cfg = SETTINGS.warning;
        this._bg.setTint(parseInt(cfg.blinkColor.replace('#', ''), 16));
        this.scene.time.delayedCall(cfg.blinkDurationMs, () => {
            if (this._bg && this._bg.clearTint) {
                this._bg.clearTint();
            }
        });
    }
}
