export default class HelperSystem {
    constructor(scene) {
        this.scene = scene;
        this.timeout = this.scene.SETTINGS.game.helperTimeout || 3000;
        this.timerEvent = null;
        this.firstTrigger = true;
        
        this.overlay = null;
        this.hand = null;
        this.ghost = null;
        this.isHelperActive = false;
        
        this.startTimer();
    }
    
    startTimer() {
        this.stopTimer();
        this.timerEvent = this.scene.time.addEvent({
            delay: this.timeout,
            callback: this.triggerHelper,
            callbackScope: this,
            loop: false
        });
    }
    
    stopTimer() {
        if (this.timerEvent) {
            this.timerEvent.remove();
            this.timerEvent = null;
        }
        this.hideHelper();
    }
    
    resetTimer() {
        this.hideHelper();
        this.startTimer();
    }
    
    triggerHelper() {
        if (this.scene.gameOver || this.isHelperActive) return;
        
        const validPair = this.findValidPair();
        if (!validPair) return; // No moves available
        
        this.isHelperActive = true;
        this._currentTweens = [];
        this.playHelperAnimation(validPair.source, validPair.target);
    }
    
    tweenPromise(config) {
        return new Promise((resolve, reject) => {
            if (!this.isHelperActive) return reject('aborted');
            const tween = this.scene.tweens.add({
                ...config,
                onComplete: () => {
                    if (config.onComplete) config.onComplete();
                    resolve();
                }
            });
            this._currentTweens.push(tween);
        });
    }
    
    async playHelperAnimation(source, target) {
        if (!this.isHelperActive) return;
        
        // Cleanup old
        if (this.ghost) { this.ghost.destroy(); this.ghost = null; }
        if (this.hand) { this.hand.destroy(); this.hand = null; }
        this._currentTweens = [];
        
        // Build Ghost (looks exactly like the source bubble)
        this.ghost = this.scene.add.container(source.container.x, source.container.y);
        const ghostBg = this.scene.add.sprite(0, 0, source.bg.texture.key);
        ghostBg.setDisplaySize(source.bg.displayWidth || 110, source.bg.displayHeight || 110);
        this.ghost.add(ghostBg);
        
        if (source.contentElements) {
            source.contentElements.forEach(el => {
                if (el.type === 'Text') {
                    const t = this.scene.add.text(el.x, el.y, el.text, {
                        fontFamily: 'tt rounds neue trial bold',
                        fontSize: el.style.fontSize || '24px',
                        color: '#ffffff',
                        fontStyle: 'bold',
                        align: 'center',
                        stroke: '#000000',
                        strokeThickness: el.style.strokeThickness || 3
                    });
                    t.setOrigin(el.originX, el.originY);
                    t.setScale(el.scaleX, el.scaleY);
                    this.ghost.add(t);
                } else if (el.type === 'Sprite') {
                    const s = this.scene.add.sprite(el.x, el.y, el.texture.key);
                    s.setOrigin(el.originX, el.originY);
                    s.setScale(el.scaleX, el.scaleY);
                    this.ghost.add(s);
                }
            });
        }
        this.ghost.setScale(source.baseScale || 1);
        this.ghost.setDepth(195);
        this.ghost.setAlpha(0);
        this.scene.mainContainer.add(this.ghost);
        
        // Build Hand
        this.hand = this.scene.add.sprite(source.container.x + 20, source.container.y + 20, 'helper_hand');
        this.hand.setOrigin(0, 0);
        this.hand.setDepth(200);
        this.hand.setScale(0.17); // 3x smaller scale
        this.hand.setAlpha(0);
        this.scene.mainContainer.add(this.hand);
        
        try {
            // 1. Hand fades in
            await this.tweenPromise({ targets: this.hand, alpha: 1, duration: 300 });
            
            // 2. Hand presses (scale down)
            await this.tweenPromise({ targets: this.hand, scale: 0.14, duration: 200, ease: 'Sine.easeOut' });
            
            // 3. Ghost appears (bubble grabbed)
            this.ghost.setAlpha(0.6);
            
            // 4. Drag to target
            const p0 = { x: source.container.x, y: source.container.y };
            const p1 = { x: (source.container.x + target.container.x) / 2, y: Math.min(source.container.y, target.container.y) - 100 };
            const p2 = { x: target.container.x, y: target.container.y };
            
            const getQuadraticBezier = (t) => {
                const oneMinusT = 1 - t;
                return {
                    x: oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
                    y: oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y
                };
            };
            
            await new Promise((resolve, reject) => {
                if (!this.isHelperActive) return reject('aborted');
                const dragTween = this.scene.tweens.addCounter({
                    from: 0,
                    to: 1,
                    duration: 1000,
                    ease: 'Sine.easeInOut',
                    onUpdate: (tween) => {
                        const vec = getQuadraticBezier(tween.getValue());
                        if (this.ghost) {
                            this.ghost.x = vec.x;
                            this.ghost.y = vec.y;
                        }
                        if (this.hand) {
                            this.hand.x = vec.x + 20;
                            this.hand.y = vec.y + 20;
                        }
                    },
                    onComplete: resolve
                });
                this._currentTweens.push(dragTween);
            });
            
            // 5. Hand reverse press (release)
            await this.tweenPromise({ targets: this.hand, scale: 0.17, duration: 200, ease: 'Sine.easeOut' });
            
            // 6. Ghost and Hand fade out smoothly together
            await Promise.all([
                this.tweenPromise({ targets: this.ghost, alpha: 0, duration: 300 }),
                this.tweenPromise({ targets: this.hand, alpha: 0, duration: 300 })
            ]);
            
            // 8. Wait and repeat
            await new Promise((resolve, reject) => {
                if (!this.isHelperActive) return reject('aborted');
                const timer = this.scene.time.delayedCall(600, resolve);
                this._currentTweens.push({ stop: () => timer.remove() });
            });
            
            if (this.isHelperActive) {
                this.playHelperAnimation(source, target);
            }
        } catch (e) {
            // Sequence aborted (hideHelper was called)
        }
    }
    
    hideHelper() {
        if (!this.isHelperActive) return;
        this.isHelperActive = false;
        
        if (this._currentTweens) {
            this._currentTweens.forEach(t => {
                if (t && typeof t.stop === 'function') t.stop();
            });
            this._currentTweens = [];
        }
        
        if (this.hand) {
            this.hand.destroy();
            this.hand = null;
        }
        if (this.ghost) {
            this.ghost.destroy();
            this.ghost = null;
        }
    }
    
    findValidPair() {
        const bubbles = this.scene.bubbles;
        const mergeController = this.scene.mergeController;
        if (!mergeController || bubbles.length < 2) return null;
        
        const gameSettings = (this.scene.SETTINGS && this.scene.SETTINGS.game) || {};
        const targetRecipe = gameSettings.targetRecipe || [];

        let firstOtherPair = null;

        for (let i = 0; i < bubbles.length; i++) {
            for (let j = i + 1; j < bubbles.length; j++) {
                const combined = [...bubbles[i].ingredients, ...bubbles[j].ingredients];
                if (mergeController._isValidCombination(combined)) {
                    const isBurgerCombo = mergeController._isSubMultiset(combined, targetRecipe);
                    if (isBurgerCombo) {
                        // Immediately return burger component pair as top priority!
                        return { source: bubbles[i], target: bubbles[j] };
                    }
                    if (!firstOtherPair) {
                        firstOtherPair = { source: bubbles[i], target: bubbles[j] };
                    }
                }
            }
        }

        return firstOtherPair;
    }
}
