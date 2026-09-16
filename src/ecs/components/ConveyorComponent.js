export class ConveyorComponent {
    constructor(config = {}) {
        this.x = config.x || 0;
        this.y = config.y || 10;
        this.speed = config.speed || 120;
        this.scale = config.scale || 0.50;
        this.direction = config.direction !== undefined ? config.direction : -1;
        this.capacityLimit = config.capacityLimit || 2;
        this.elements = config.elements || {};

        this.beltParticles = [];
        this.maxCapacity = config.maxCapacity || 500;
        this.isOverflow = false;
        this.overflowOnTimer = 0;
        this.overflowOffCooldown = 0;
        
        // Single oval conveyor
        this.container = null;
        this.conveyorSprite = null;
        this.particlesContainer = null;
        this.loadText = null;
        this.warningText = null;

        // Path geometry
        // The single conveyor.png oval. Let's assume standard dimensions, or dynamically based on the sprite bounds.
        // E.g. top edge moves right, right arc curves down, bottom edge moves left, left arc curves up.
        this.pathLeftX = -150;
        this.pathRightX = 150;
        this.pathTopY = -20;
        this.pathBottomY = 20;
        this.arcRadius = 20;
    }
}
