import { System, Entity } from '../ECS';
import { ConveyorComponent } from '../components/ConveyorComponent';
import { PotComponent } from '../components/PotComponent';
import { SandGridComponent } from '../components/SandGridComponent';
import { FlyingParticleComponent } from '../components/FlyingParticleComponent';

export class ParticleCollectionSystem extends System {
    constructor(game) {
        super(game);
        this.emitInterval = 80; // ms between particle batch emissions
        this.lastEmitTime = 0;
        this.flyingContainer = null;
    }

    initFlyingContainer() {
        if (!this.flyingContainer && this.game.mainContainer) {
            this.flyingContainer = this.game.add.container(0, 0);
            this.flyingContainer.setDepth(25);
            this.game.mainContainer.add(this.flyingContainer);
        }
    }

    update(world, time, delta) {
        this.initFlyingContainer();

        if (!this.conveyorComponent || !this.sandGridComponent) {
            const conveyorEntities = world.getEntitiesWith([ConveyorComponent]);
            const sandGridEntities = world.getEntitiesWith([SandGridComponent]);
            if (conveyorEntities.length === 0 || sandGridEntities.length === 0) return;
            
            this.conveyorComponent = conveyorEntities[0].getComponent(ConveyorComponent);
            this.sandGridComponent = sandGridEntities[0].getComponent(SandGridComponent);
        }
        const conveyor = this.conveyorComponent;
        const sandGrid = this.sandGridComponent;

        // Retrieve current image offset & scale from SandGridSystem if available
        let imageOffset = { x: 300, y: 240 };
        let imageScale = 0.55;
        if (this.game.SETTINGS) {
            imageOffset.x = this.game.SETTINGS.image_logical_x !== undefined ? this.game.SETTINGS.image_logical_x : (this.game.SETTINGS.image_x !== undefined ? this.game.SETTINGS.image_x : 300);
            imageOffset.y = this.game.SETTINGS.image_logical_y !== undefined ? this.game.SETTINGS.image_logical_y : (this.game.SETTINGS.image_y !== undefined ? this.game.SETTINGS.image_y : 240);
            imageScale = this.game.SETTINGS.image_scale || 0.55;
        }

        // Count pending flying particles targeting each pot
        const flyingEntities = world.getEntitiesWith([FlyingParticleComponent]);
        const pendingCounts = new Map();
        for (const fe of flyingEntities) {
            const fComp = fe.getComponent(FlyingParticleComponent);
            if (fComp.targetPot) {
                pendingCounts.set(fComp.targetPot, (pendingCounts.get(fComp.targetPot) || 0) + 1);
            }
        }

        // 1. Emit new particles towards active pots on belt
        if (time - this.lastEmitTime > this.emitInterval) {
            this.lastEmitTime = time;

            for (const potEntity of conveyor.activePots) {
                if (!potEntity._cachedPotComponent) {
                    potEntity._cachedPotComponent = potEntity.getComponent(PotComponent);
                }
                const pot = potEntity._cachedPotComponent;
                if (!pot || pot.state !== 'on_belt' || !pot.container) continue;

                const pending = pendingCounts.get(pot) || 0;
                const needed = pot.capacity - (pot.currentFill + pending);
                if (needed <= 0) continue;

                const batchSize = Math.min(needed, 2);
                const colorOrSet = pot.acceptedColors || pot.color;
                const detached = typeof sandGrid.detachMatchingParticles === 'function' ? sandGrid.detachMatchingParticles(colorOrSet, batchSize, imageOffset, imageScale) : [];

                for (const p of detached) {
                    const flyingComp = new FlyingParticleComponent({
                        startX: p.x,
                        startY: p.y,
                        targetPot: pot,
                        color: p.color,
                        duration: 400 + Math.random() * 80
                    });

                    // Create visual particle dot
                    const dot = this.game.add.graphics();
                    dot.fillStyle(p.color, 1);
                    const pRadius = Math.max(3, ((this.game.SETTINGS && this.game.SETTINGS.particle_scale) || 10) * 0.35);
                    dot.fillCircle(0, 0, pRadius);
                    dot.setPosition(p.x, p.y);
                    this.flyingContainer.add(dot);
                    flyingComp.view = dot;

                    const fe = new Entity();
                    fe.addComponent(flyingComp);
                    world.addEntity(fe);
                }
            }
        }

        // 2. Update all flying particles
        for (let i = flyingEntities.length - 1; i >= 0; i--) {
            const fe = flyingEntities[i];
            const fp = fe.getComponent(FlyingParticleComponent);
            if (!fp) continue;

            fp.elapsed += delta;
            const t = Math.min(fp.elapsed / fp.duration, 1.0);

            // Target pot mouth coordinate inside mainContainer
            let targetX = 0;
            let targetY = 0;
            if (fp.targetPot && fp.targetPot.container) {
                targetX = conveyor.x + fp.targetPot.container.x;
                targetY = conveyor.y + fp.targetPot.container.y - 12;
            }

            // Quadratic bezier arc from start to target
            const p0X = fp.startX;
            const p0Y = fp.startY;
            const p1X = (p0X + targetX) / 2;
            const p1Y = Math.min(p0Y, targetY) - 35;
            const p2X = targetX;
            const p2Y = targetY;

            const invT = 1 - t;
            const curX = invT * invT * p0X + 2 * invT * t * p1X + t * t * p2X;
            const curY = invT * invT * p0Y + 2 * invT * t * p1Y + t * t * p2Y;

            if (fp.view) {
                fp.view.setPosition(curX, curY);
            }

            if (t >= 1.0) {
                // Arrived at pot!
                if (fp.targetPot) {
                    const isFull = fp.targetPot.addFill(1);
                    if (isFull && fp.targetPot.state === 'on_belt') {
                        this.resolveFullPot(world, conveyor, fp.targetPot);
                    }
                }

                if (fp.view) {
                    fp.view.destroy();
                }
                world.removeEntity(fe);
            }
        }
    }

    resolveFullPot(world, conveyor, pot) {
        pot.state = 'full';

        // Remove from active conveyor pots list immediately to free slot
        const idx = conveyor.activePots.findIndex(e => e.getComponent(PotComponent) === pot);
        if (idx !== -1) {
            conveyor.activePots.splice(idx, 1);
        }

        // Play completion animation: scale punch then pop away
        if (pot.container && this.game.tweens) {
            this.game.tweens.add({
                targets: pot.container,
                scaleX: pot.container.scaleX * 1.25,
                scaleY: pot.container.scaleY * 1.25,
                duration: 160,
                yoyo: true,
                onComplete: () => {
                    this.game.tweens.add({
                        targets: pot.container,
                        alpha: 0,
                        scaleX: 0,
                        scaleY: 0,
                        y: pot.container.y - 30,
                        duration: 250,
                        ease: 'Back.easeIn',
                        onComplete: () => {
                            if (pot.container) pot.container.destroy();
                            // Remove entity from world
                            const ent = world.entities.find(e => e.getComponent(PotComponent) === pot);
                            if (ent) world.removeEntity(ent);
                        }
                    });
                }
            });
        }
    }
}
