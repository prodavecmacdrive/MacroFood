export class FlyingParticleComponent {
    constructor(config = {}) {
        this.startX = config.startX || 0;
        this.startY = config.startY || 0;
        this.targetPot = config.targetPot || null;
        this.color = config.color !== undefined ? config.color : 0xffffff;
        this.duration = config.duration || 450; // ms
        this.elapsed = 0;
        this.controlX = config.controlX !== undefined ? config.controlX : config.startX;
        this.controlY = config.controlY !== undefined ? config.controlY : config.startY - 30;
        this.view = null;
    }
}
