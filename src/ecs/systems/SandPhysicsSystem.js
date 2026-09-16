import { System } from '../ECS';
import { SandGridComponent } from '../components/SandGridComponent';

export class SandPhysicsSystem extends System {
    constructor(game) {
        super(game);
        this.stepMs = (game.SETTINGS && game.SETTINGS.sand_physics_step_ms) || 33.333;
        this.accumulator = 0;

        // Visibility & focus reset handlers
        this.resetAccumulator = () => {
            this.accumulator = 0;
        };

        this._onVisibilityChange = () => {
            this.resetAccumulator();
        };

        this._onWindowFocus = () => {
            this.resetAccumulator();
        };

        this._onWindowBlur = () => {
            this.resetAccumulator();
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._onVisibilityChange);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', this._onWindowFocus);
            window.addEventListener('blur', this._onWindowBlur);
        }

        if (this.game && this.game.events) {
            this.game.events.on('pause', this.resetAccumulator);
            this.game.events.on('resume', this.resetAccumulator);
            this.game.events.once('shutdown', () => this.destroy());
            this.game.events.once('destroy', () => this.destroy());
        }
    }

    destroy() {
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('focus', this._onWindowFocus);
            window.removeEventListener('blur', this._onWindowBlur);
        }
        if (this.game && this.game.events) {
            this.game.events.off('pause', this.resetAccumulator);
            this.game.events.off('resume', this.resetAccumulator);
        }
        this.resetAccumulator();
    }

    update(world, time, delta) {
        // Skip physics and reset accumulator when tab/window is inactive or hidden
        if (typeof document !== 'undefined' && document.hidden) {
            this.accumulator = 0;
            return;
        }

        if (!this.sandGrid) {
            const entities = world.getEntitiesWith([SandGridComponent]);
            if (entities.length > 0) {
                this.sandGrid = entities[0].getComponent(SandGridComponent);
            }
        }
        if (!this.sandGrid) return;

        const sandGrid = this.sandGrid;

        // Delta Time Clamping:
        // Clamp maximum elapsed frame time fed into the physics loop (~33.33 ms / 30 FPS floor)
        // to prevent cascading step accumulation during frame drops
        const MAX_DELTA_MS = 1000 / 30;
        const clampedDelta = Math.min(Math.max(0, delta), MAX_DELTA_MS);
        this.accumulator += clampedDelta;

        const dt = this.stepMs / 1000;
        const settings = this.game.SETTINGS || {};

        // Strict Single-Step Execution & Immediate Accumulator Drain:
        // Execute at most 1 stepPhysics call per animation frame and immediately drop all accumulated debt
        // to prevent the engine from entering a multi-step catch-up spiral of death.
        if (this.accumulator >= this.stepMs) {
            sandGrid.stepPhysics(dt, settings, this.game.funnelColliders || []);
            this.accumulator = 0; // Drop all accumulated debt immediately
        }
    }
}

