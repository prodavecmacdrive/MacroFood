import Utils from "../Utils";

export default class BitmapMask extends Phaser.GameObjects.RenderTexture {
    constructor(scene, x, y, width, height) {
        super(scene, x, y, width, height);

        this._scene = scene;
        this._scene.add.existing(this);
    }

    setMask(blur, invertAlpha, visible) {
        this._mask = this.createBitmapMask();
        this._mask.invertAlpha = invertAlpha;
        this._mask.bitmapMask.visible = visible;
        blur.setMask(this._mask);

        this._update();
        window.addEventListener('resize', this._update.bind(this));
        
        return this;
    }

    drawMask(event, brush, texture) {
        const {x, y} = Utils.getInputPoint(this, event.x, event.y);
        const w = brush.displayWidth;
        const h = brush.displayHeight;

        const brushPos = Utils.getInputPoint(brush, event.x, event.y);
        brush.cx = brushPos.x * this._scene.mainContainer.scaleX;
        brush.cy = brushPos.y * this._scene.mainContainer.scaleY;
        
        this.draw(texture, x * this._scene.mainContainer.scaleX - (w / 2) + (this.width / 2), y * this._scene.mainContainer.scaleY - (h / 2) + (this.height / 2));
    }

    _update() {
        this._mask.bitmapMask.setScale(1).setScale(Number(this._scene.game.size.scale));
        this._mask.bitmapMask.cx = (-this.width / 2) * this._scene.mainContainer.scaleX;
        this._mask.bitmapMask.cy = (-this.height / 2) * this._scene.mainContainer.scaleY;
    }
}