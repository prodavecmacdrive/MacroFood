export default class GeometryMask extends Phaser.GameObjects.Graphics {
    constructor(scene, obj, prop) {
        super(scene);

        this._scene = scene;
        this._obj = obj;
        scene.add.existing(this);

        this._make(obj, prop);
        this._addWatchChange();
        this._update();
        window.addEventListener('resize', this._update.bind(this));

        return this.prop;
    }

    _make(obj, prop) {
        this.fillStyle(0xffff00, 0);
        const rect = this.fillRoundedRect(0, 0, 0, 0, 0);
        const mask = rect.createGeometryMask();

        obj.setMask(mask);

        this._mask = {
            graphics: this,              
            cx: prop.cx || 0,
            cy: prop.cy || 0,
            startFillX: prop.startFillX || 0,
            startFillY: prop.startFillY || 0,
            width: prop.width || 0,
            height: prop.height || 0,
            rounded: prop.rounded || 0,
            visible: prop.visible || false
        };
    }

    _addWatchChange() {
        this.prop = {};

        const prop = ['cx', 'cy', 'startFillX', 'startFillY', 'width', 'height', 'rounded', 'visible'];
        for (let i = 0; i < prop.length; i++) {
            Object.defineProperty(this.prop, prop[i], {
                get: () => {
                    return this._mask[prop[i]];
                }, 
                set: (value) => {
                    this._mask[prop[i]] = value;
                    this._update();
                }
            }); 
        }
    }

    _update() {
        this.setScale(1).setScale(Number(this._scene.game.size.scale));

        const tempMatrix = new Phaser.GameObjects.Components.TransformMatrix();
        const tempParentMatrix = new Phaser.GameObjects.Components.TransformMatrix();
        this._obj.getWorldTransformMatrix(tempMatrix, tempParentMatrix);
        const d = tempMatrix.decomposeMatrix();
        
        this.x = d.translateX + (this._mask.cx * this._scene.mainContainer.scaleY);
        this.y = d.translateY + (this._mask.cy * this._scene.mainContainer.scaleY);
        
        this.clear();
        this.fillStyle(0xffff00, this._mask.visible ? 0.5 : 0);
        this.fillRoundedRect(
            this._mask.startFillX,
            this._mask.startFillY,
            this._mask.width,
            this._mask.height,
            this._mask.rounded
        );
    }
}