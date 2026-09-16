export class PotComponent {
    constructor(config = {}) {
        this.color = config.color || 0xd32f2f;
        this.acceptedColors = config.acceptedColors || new Set([this.color]);
        this.paletteId = config.paletteId !== undefined ? config.paletteId : 6;
        this.capacity = config.capacity || 100;
        this.currentFill = 0;
        this.state = config.state || 'in_grid'; // 'in_grid' | 'moving_to_belt' | 'on_belt' | 'full'
        this.gridCol = config.gridCol !== undefined ? config.gridCol : 0;
        this.gridRow = config.gridRow !== undefined ? config.gridRow : 0;
        
        this.container = null;
        this.cupSprite = null;
        this.cupBack = null;
        this.cupFront = null;
        this.particlesContainer = null;
        this.fillLabel = null;
        this.fillGraphics = null;
        
        this.x = 0;
        this.y = 0;
        this.targetX = 0;
        this.targetY = 0;
    }

    addFill(amount = 1) {
        this.currentFill = Math.min(this.currentFill + amount, this.capacity);
        this.updateUI();
        return this.currentFill >= this.capacity;
    }

    updateUI() {
        if (!this.fillLabel) return;
        const percent = Math.floor((this.currentFill / this.capacity) * 100);
        this.fillLabel.setText(percent + '%');
    }
}
