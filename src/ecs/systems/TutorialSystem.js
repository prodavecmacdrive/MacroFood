import { System } from '../ECS';
import { ConveyorComponent } from '../components/ConveyorComponent';
import { SandGridComponent, STATE_RESTING } from '../components/SandGridComponent';

export class TutorialSystem extends System {
    constructor(game) {
        super(game);
        
        this.hand = null;
        this.isActive = false;
        this.hasPlayerInteracted = false;
        this.isAnimating = false;
        this._currentTweens = [];
        
        this.cooldownTimer = 0;
        this.reactivationPrimed = false;

        // Listen for player input to cancel tutorial and reset inactivity timer
        this.game.input.on('pointerdown', this.onPointerInput, this);
        this.game.input.on('pointermove', this.onPointerMove, this);
        this.game.input.on('pointerup', this.onPointerInput, this);
    }
    
    onPointerInput(pointer) {
        this.hasPlayerInteracted = true;
        this.inactivityTimer = 0; // Reset inactivity timer whenever player interacts
        this.hideHelper();
    }

    onPointerMove(pointer) {
        if (pointer && pointer.isDown) {
            this.hasPlayerInteracted = true;
            this.inactivityTimer = 0; // Continuously reset while player is actively swiping/dragging
            this.hideHelper();
        }
    }
    
    hideHelper() {
        if (!this.isActive && !this.hand) return;
        this.isActive = false;
        
        if (this._currentTweens) {
            this._currentTweens.forEach(t => {
                if (t && typeof t.stop === 'function') t.stop();
            });
            this._currentTweens = [];
        }
        
        if (this.hand) {
            if (this.game && this.game.gameOver) {
                this.hand.destroy();
                this.hand = null;
            } else {
                this.game.tweens.add({
                    targets: this.hand,
                    alpha: 0,
                    duration: 150,
                    onComplete: () => {
                        if (this.hand) {
                            this.hand.destroy();
                            this.hand = null;
                        }
                    }
                });
            }
        }
    }
    
    tweenPromise(config) {
        return new Promise((resolve, reject) => {
            if (!this.isActive) return reject('aborted');
            const tween = this.game.tweens.add({
                ...config,
                onComplete: () => {
                    if (config.onComplete) config.onComplete();
                    resolve();
                }
            });
            this._currentTweens.push(tween);
        });
    }

    async playSliceAnimation(startX, startY) {
        if (this.isActive) return;
        this.isActive = true;
        
        if (this.hand) {
            this.hand.destroy();
            this.hand = null;
        }
        
        this._currentTweens = [];
        
        const settings = this.game.SETTINGS || {};
        const scaleRatio = (settings.image_scale || 0.72) / 0.72;
        const handBaseScale = 0.8 * scaleRatio;
        const handPressedScale = 0.65 * scaleRatio;

        // Spawn hand in the empty area slightly below startY
        this.hand = this.game.add.sprite(startX, startY + 60 * scaleRatio, 'helper_hand');
        this.hand.setOrigin(0.2, 0.1);
        this.hand.setDepth(500); // Render above sand
        this.hand.setScale(handBaseScale);
        this.hand.setAlpha(0);
        this.game.mainContainer.add(this.hand);
        
        try {
            // 1. Fade in
            await this.tweenPromise({ targets: this.hand, alpha: 1, y: startY + 30 * scaleRatio, duration: 300, ease: 'Sine.easeOut' });
            
            // 2. Press down (scale-down)
            await this.tweenPromise({ targets: this.hand, scale: handPressedScale, duration: 200, ease: 'Sine.easeOut' });
            
            // 3. Continuous swipe motion: starts from empty space and intersects bottom of uncleared image particles
            await this.tweenPromise({ 
                targets: this.hand, 
                x: startX + 120 * scaleRatio, // Move right
                y: startY - 20 * scaleRatio, // Move up into/across the particle area
                duration: 800, 
                ease: 'Sine.easeInOut' 
            });
            
            // 4. Release (scale up)
            await this.tweenPromise({ targets: this.hand, scale: handBaseScale, duration: 150, ease: 'Sine.easeOut' });
            
            // 5. Fade out
            await this.tweenPromise({ targets: this.hand, alpha: 0, duration: 250 });
            
            // Wait and loop
            await new Promise((resolve, reject) => {
                if (!this.isActive) return reject('aborted');
                const timer = this.game.time.delayedCall(400, resolve);
                this._currentTweens.push({ stop: () => timer.remove() });
            });
            
            if (this.isActive) {
                this.isActive = false; // Reset for loop
                this.playSliceAnimation(startX, startY);
            }
        } catch (e) {
            // Aborted by player input
        }
    }

    findUnclearedBottomSpot(world) {
        if (!this.sandGridComponent) {
            const entities = world.getEntitiesWith([SandGridComponent]);
            if (entities.length === 0) return null;
            this.sandGridComponent = entities[0].getComponent(SandGridComponent);
        }
        
        const sandGrid = this.sandGridComponent;
        const settings = this.game.SETTINGS || {};
        const imageScale = settings.image_scale || 0.70;
        const imgX = settings.image_logical_x !== undefined ? settings.image_logical_x : 300;
        const imgY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
        
        // Find bottom-most resting particles
        let lowestY = -Infinity;
        const restingIndices = [];
        
        for (let i = 0; i < sandGrid.particleCount; i++) {
            if (sandGrid.states[i] === STATE_RESTING && sandGrid.staticGrid[i] !== -1) {
                const py = sandGrid.positions[i * 2 + 1];
                if (py > lowestY) {
                    lowestY = py;
                }
                restingIndices.push(i);
            }
        }
        
        if (restingIndices.length === 0) return null;
        
        // Filter particles near the bottom edge (within 60px of lowest particle Y)
        const bottomEdgeParticles = restingIndices.filter(i => (lowestY - sandGrid.positions[i * 2 + 1]) <= 60);
        if (bottomEdgeParticles.length === 0) return null;

        // Pick a random particle on the bottom edge
        const p = bottomEdgeParticles[Math.floor(Math.random() * bottomEdgeParticles.length)];
        const scaleRatio = (settings.image_scale || 0.72) / 0.72;
        const lx = sandGrid.positions[p * 2 + 0] * imageScale + imgX;
        const ly = sandGrid.positions[p * 2 + 1] * imageScale + imgY;
        
        // Start hand in empty space to the left and slightly below the particle, so it swipes across the bottom edge
        return { x: lx - 60 * scaleRatio, y: ly + 15 * scaleRatio };
    }

    update(world, time, delta) {
        if (this.game && this.game.gameOver) {
            this.hideHelper();
            return;
        }
        const settings = this.game.SETTINGS || {};
        
        // First initialization check
        if (!this.isAnimating && !this.isActive && !this.hasPlayerInteracted) {
            // First time spawn: bottom center of the artwork
            const imgX = settings.image_logical_x !== undefined ? settings.image_logical_x : 300;
            const imgY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
            const scaleRatio = (settings.image_scale || 0.72) / 0.72;
            const yOffset = (settings.helper_start_y_offset !== undefined ? settings.helper_start_y_offset : 230) * scaleRatio;
            const startX = imgX - 60 * scaleRatio;
            const startY = imgY + yOffset;
            
            this.isAnimating = true;
            this.playSliceAnimation(startX, startY);
        }
        
        // Reset inactivity timer continuously if the player is currently holding down or swiping
        if (this.game.input && this.game.input.activePointer && this.game.input.activePointer.isDown) {
            this.hasPlayerInteracted = true;
            this.inactivityTimer = 0;
            this.hideHelper();
            return;
        }

        // Timer and reactivation check after player interaction
        if (this.hasPlayerInteracted && !this.isActive) {
            this.inactivityTimer = (this.inactivityTimer || 0) + (delta / 1000);
            
            const delay = settings.helper_reactivation_delay_sec !== undefined ? settings.helper_reactivation_delay_sec : 10;
            
            // Only evaluate after 10 seconds of inactivity
            if (this.inactivityTimer >= delay) {
                if (!this.conveyorComponent) {
                    const conveyorEntities = world.getEntitiesWith([ConveyorComponent]);
                    if (conveyorEntities.length > 0) {
                        this.conveyorComponent = conveyorEntities[0].getComponent(ConveyorComponent);
                    }
                }
                
                if (this.conveyorComponent) {
                    const conveyor = this.conveyorComponent;
                    
                    const inFlight = conveyor.inFlightCount || 0;
                    const cap = conveyor.beltParticles ? conveyor.beltParticles.length : 0;
                    const totalLoad = cap + inFlight;
                    const maxCap = conveyor.maxCapacity || 500;
                    
                    const occupancy = totalLoad / maxCap;
                    
                    if (occupancy <= 0.10) {
                        const spot = this.findUnclearedBottomSpot(world);
                        if (spot) {
                            this.hasPlayerInteracted = false; // Trigger animation
                            this.playSliceAnimation(spot.x, spot.y);
                        }
                    }
                }
            }
        }
    }
}
