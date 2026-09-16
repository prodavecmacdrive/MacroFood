import Utils from "../core/framework/Utils";
export default class Button extends Phaser.GameObjects.Container{
    constructor({scene, texture, activatedTexture, filterTexture, text, px, py, lx, ly, pScaleX = 0, pScaleY = 0, lScaleX = 0, lScaleY = 0, callback, align = "Center", container}){
        super(scene, 0, 0);
        this.callback = callback;
        this.activatedTexture = activatedTexture;
        this.loopAnimation = undefined;
        this.create(texture, filterTexture, px, py, lx, ly, pScaleX, pScaleY, lScaleX, lScaleY, text);
        this.setCustomPosition(0, 0).setAlign(align);
        container.add(this);
    }

    create(texture, filterTexture, px, py, lx, ly, pScaleX, pScaleY, lScaleX, lScaleY, text){
        this.button = this.scene.add.image(0, 0, texture).setDepth(8).setInteractive().on("pointerdown", this.onClick, this);
        this.enabled = true;
        if(filterTexture){
            this.filterTexture = this.scene.add.image(0, 0, "atlas", filterTexture).setDepth(9).setAlpha(0);
            this.add(this.filterTexture);
        }
        if(text){
            this.text = this.scene.add.text(0, 0, text, {fontFamily: 'tt rounds neue trial bold', fontSize: 48, color: '#ffffff'}).setDepth(9).setOrigin(0.5, 0.5);
            this.text.setInteractive({ useHandCursor: true }).on("pointerdown", this.onClick, this);
            this.add(this.text);
        }
        this.add([this.button]);
        this.addProperties(["pos", "scale"]);
        this.sort("depth");
        this.px = px;
        this.py = py;
        this.lx = lx;
        this.ly = ly;
        this.pScaleX = pScaleX;
        this.pScaleY = pScaleY;
        this.lScaleX = lScaleX;
        this.lScaleY = lScaleY;
    }

    animate({pScaleX = this.pScaleX, pScaleY = this.pScaleY, lScaleX = this.lScaleX, lScaleY = this.lScaleY, alpha = 1, duration = 0, yoyo = false, delay = 0, 
    px = this.px, py = this.py, lx = this.lx, ly = this.ly, ease = "Cubic", onComplete = ()=>{}, repeat = 0}){
        const animation = this.scene.tweens.add({targets: this, px, py, lx, ly, alpha, pScaleX, pScaleY, lScaleX, lScaleY, duration, yoyo, ease, delay, repeat, onComplete});
        if(repeat==-1) {
            if(this.loopedAnimation) this.loopedAnimation.stop();
            this.loopedAnimation = animation;
        }; 
    }

    onClick(){
        if(!this.enabled) return;
        Utils.addAudio(this.scene, 'click', 1.5);
        if(this.loopedAnimation) this.loopedAnimation.pause();
        
        this.disableClick();
        this.animate({pScaleX: "-0.05", pScaleY: "-0.05", lScaleX: "-0.05", lScaleY: "-0.05", duration: 60, ease: "Cubic", yoyo: true});

        this.scene.time.addEvent({delay: 500, callback: ()=>{
            this.enableClick();
        }});
        if(this.callback) this.callback();
    }

    setCallback(callback){
        this.callback = callback;
    }

    enableFilter(duration = 0){
        if(this.filterTexture) this.scene.tweens.add({targets: this.filterTexture, alpha: 1, duration});
    }
    
    disableFilter(duration = 0){
        if(this.filterTexture) this.scene.tweens.add({targets: this.filterTexture, alpha: 0, duration});
    }

    disableClick(){
        if(this.enabled){
            this.button.off("pointerdown", this.onClick, this);
            if(this.text) this.text.off("pointerdown", this.onClick, this);
        }
        this.enabled = false;
    }

    enableClick(){
        if(!this.enabled){ 
            this.button.on("pointerdown", this.onClick, this);
            if(this.text) this.text.on("pointerdown", this.onClick, this);
        } 
        this.enabled = true;
    }

    changeTexture(texture){
        this.button.setTexture("atlas", texture);
    }

    _destroy(delay=0, duration = 0){
        const callback = ()=>{this.list.forEach(item=>item.destroy());}
        this.animate({pScaleX: 0, pScaleY: 0, lScaleX: 0, lScaleY: 0, duration, delay, onComplete: callback});
    }
}