export default class Utils {
    static addDefaultProperties(obj) {
        obj.customProps = [];

        obj.addProperties = function(props) {
            this.customProps = this.customProps.concat(props);
            
            if( this.customProps.includes('pos') && this.px === undefined ) {
                Utils.addProperty(obj, 'px', function() { return this._px; }, function(x) { if (this.scene?.game?.size?.isPortrait) this.x = Utils.getAlignX(this) + x; this._px = x; });
                Utils.addProperty(obj, 'py', function() { return this._py; }, function(y) { if (this.scene?.game?.size?.isPortrait) this.y = Utils.getAlignY(this) + y; this._py = y; });
                Utils.addProperty(obj, 'lx', function() { return this._lx; }, function(x) { if (!this.scene?.game?.size?.isPortrait) this.x = Utils.getAlignX(this) + x; this._lx = x; });
                Utils.addProperty(obj, 'ly', function() { return this._ly; }, function(y) { if (!this.scene?.game?.size?.isPortrait) this.y = Utils.getAlignY(this) + y; this._ly = y; });
    
                this.px = this.py = this.lx = this.ly = 0;
            }
    
            if( this.customProps.includes('scale') && this.pScaleX === undefined ) {
                Utils.addProperty(obj, 'pScaleX', function() { return this._pScaleX; }, function(x) { if (this.scene?.game?.size?.isPortrait) this.scaleX = x; this._pScaleX = x; });
                Utils.addProperty(obj, 'pScaleY', function() { return this._pScaleY; }, function(y) { if (this.scene?.game?.size?.isPortrait) this.scaleY = y; this._pScaleY = y; });
                Utils.addProperty(obj, 'lScaleX', function() { return this._lScaleX; }, function(x) { if (!this.scene?.game?.size?.isPortrait) this.scaleX = x; this._lScaleX = x; });
                Utils.addProperty(obj, 'lScaleY', function() { return this._lScaleY; }, function(y) { if (!this.scene?.game?.size?.isPortrait) this.scaleY = y; this._lScaleY = y; });
    
                this.pScaleX = this.pScaleY = this.lScaleX = this.lScaleY = 1;
            }

            if( this.customProps.includes('angle') && this.pAngle === undefined ) {
                Utils.addProperty(obj, 'pAngle', function() { return this._pAngle; }, function(angle) { if (this.scene?.game?.size?.isPortrait) this.angle = angle; this._pAngle = angle; });
                Utils.addProperty(obj, 'lAngle', function() { return this._lAngle; }, function(angle) { if (!this.scene?.game?.size?.isPortrait) this.angle = angle; this._lAngle = angle; });
    
                this.pAngle = this.lAngle = 0;
            }

            if( this.customProps.includes('alpha') && this.pAlpha === undefined ) {
                Utils.addProperty(obj, 'pAlpha', function() { return this._pAlpha; }, function(alpha) { if (this.scene?.game?.size?.isPortrait) this.alpha = alpha; this._pAlpha = alpha; });
                Utils.addProperty(obj, 'lAlpha', function() { return this._lAlpha; }, function(alpha) { if (!this.scene?.game?.size?.isPortrait) this.alpha = alpha; this._lAlpha = alpha; });
    
                this.pAlpha = this.lAlpha = 1;
            }

            if( this.customProps.includes('visible') && this.pVisible === undefined ) {
                Utils.addProperty(obj, 'pVisible', function() { return this._pVisible; }, function(visible) { if (this.scene?.game?.size?.isPortrait) this.visible = visible; this._pVisible = visible; });
                Utils.addProperty(obj, 'lVisible', function() { return this._lVisible; }, function(visible) { if (!this.scene?.game?.size?.isPortrait) this.visible = visible; this._lVisible = visible; });
    
                this.pVisible = this.lVisible = true;
            }

            if( this.customProps.includes('align') && this.pAlign === undefined ) {
                Utils.addProperty(obj, 'pAlign', function() { return this._pAlign; }, function(align) { if (this.scene?.game?.size?.isPortrait) this.setAlign(align); this._pAlign = align; });
                Utils.addProperty(obj, 'lAlign', function() { return this._lAlign; }, function(align) { if (!this.scene?.game?.size?.isPortrait) this.setAlign(align); this._lAlign = align; });
    
                this.lAlign = this.lAlign = 'Center';
            }

            if( this.customProps.includes('image') && this.pImage === undefined ) {
                Utils.addProperty(obj, 'pImage', function() { return this._pImage; }, function(img) { if (this.scene?.game?.size?.isPortrait) (window.App.resources.textures[img] || img === "__MISSING" || img === "None") ?  this.setTexture(img) : this.setTexture('atlas', img); this._pImage = img; });
                Utils.addProperty(obj, 'lImage', function() { return this._lImage; }, function(img) { if (!this.scene?.game?.size?.isPortrait) (window.App.resources.textures[img] || img === "__MISSING" || img === "None") ?  this.setTexture(img) : this.setTexture('atlas', img); this._lImage = img; });
    
                this.pImage = this.lImage = '';
            }

            if( this.customProps.includes('origin') && this.pOriginX === undefined ) {
                Utils.addProperty(obj, 'pOriginX', function() { return this._pOriginX; }, function(org) {
                    this._pOriginX = org;  
                    if (this.scene?.game?.size?.isPortrait) {
                        this.setOrigin(this.pOriginX, this.pOriginY); 
                        this.originX = org;
                    }
                });
                Utils.addProperty(obj, 'pOriginY', function() { return this._pOriginY; }, function(org) {
                    this._pOriginY = org; 
                    if (this.scene?.game?.size?.isPortrait) {
                        this.setOrigin(this.pOriginX, this.pOriginY); 
                        this.originY = org;
                    }
                });
                Utils.addProperty(obj, 'lOriginX', function() { return this._lOriginX; }, function(org) {
                    this._lOriginX = org; 
                    if (!this.scene?.game?.size?.isPortrait) {
                        this.setOrigin(this.lOriginX, this.lOriginY);
                        this.originX = org;
                    }
                });
                Utils.addProperty(obj, 'lOriginY', function() { return this._lOriginY; }, function(org) { 
                    this._lOriginY = org; 
                    if (!this.scene?.game?.size?.isPortrait) {
                        this.setOrigin(this.lOriginX, this.lOriginY);
                        this.originY = org;
                    }
                });
    
                this.pOriginX = this.pOriginY = this.lOriginX = this.lOriginY = 0.5;
            }

            return this;
        };

        Utils.addProperty(obj, 'cx', function() { return this._cx; }, function(x) { this.x = Utils.getAlignX(this) + x; this._cx = x; });
        Utils.addProperty(obj, 'cy', function() { return this._cy; }, function(y) { this.y = Utils.getAlignY(this) + y; this._cy = y; });

        obj.setCustomPosition = function(x, y) {
            this.x = Utils.getAlignX(this) + x;
            this.y = Utils.getAlignY(this) + y;

            this._cx = x;
            this._cy = y;
            
            return this;
        };

        obj.setAlign = function(align) {
            this.align = align;

            if (!this.scene?.game?.size) {
                return this;
            }

            if( this.customProps.includes('pos') ) {
                this.scene.game.size.isPortrait ? this.setCustomPosition(this.px, this.py) : this.setCustomPosition(this.lx, this.ly);
            } else {
                this.setCustomPosition(this.cx, this.cy);
            }

            return this;
        };
    }

    static addProperty(obj, prop, getter, setter) {
        Object.defineProperty(obj, prop, {
            configurable: true,
            get: getter,
            set: setter
        });
    }

    static getAlignX(obj) {
        if (!obj.scene?.game?.size) return 0;
        if(obj.align === 'Top Left' || obj.align === 'Left' || obj.align === 'Bottom Left') return obj.scene.game.size.left;
        if(obj.align === 'Top Rigth' || obj.align === 'Rigth' || obj.align === 'Bottom Rigth') return obj.scene.game.size.right;

        return obj.scene.game.size.x;
    }

    static getAlignY(obj) {
        if (!obj.scene?.game?.size) return 0;
        if(obj.align === 'Top Left' || obj.align === 'Top' || obj.align === 'Top Rigth') return obj.scene.game.size.top;
        if(obj.align === 'Bottom Left' || obj.align === 'Bottom' || obj.align === 'Bottom Rigth') return obj.scene.game.size.bottom;
        
        return obj.scene.game.size.y;
    }

    static getInputPoint(obj, x, y) {
        const alignX = Utils.getAlignX(obj);
        const alignY = Utils.getAlignY(obj);
        const scaleX = obj.scene?.mainContainer?.scaleX || 1;
        const scaleY = obj.scene?.mainContainer?.scaleY || 1;

        const newX = (x - alignX) / scaleX;
        const newY = (y - alignY) / scaleY;
        
        return {x: newX, y: newY};
    }

    static addAudio(scene, name, volume, loop) {
        if(scene.game.cache.audio.entries.size) {
            try {
                let sound = scene.game.sound.addAudioSprite('sfx');
                if (sound && sound.spritemap) {
                    let clipName = name;
                    if (!sound.spritemap[clipName]) {
                        if (clipName.startsWith('sale_')) {
                            const alt = clipName.replace('sale_', 'sail_');
                            if (sound.spritemap[alt]) clipName = alt;
                        } else if (clipName.startsWith('sail_')) {
                            const alt = clipName.replace('sail_', 'sale_');
                            if (sound.spritemap[alt]) clipName = alt;
                        }
                    }
                    if (sound.spritemap[clipName]) {
                        sound.play(clipName, {loop: loop || false, volume: volume || 1});
                        return sound;
                    }
                }
            } catch (e) {
                // Audio clip not yet loaded or missing
            }
        }
    }

    static coefficient(first, second, system = 100) {
        return first / second * system;
    }

    static generateID() {
        const S4 = () => {
            return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
        };

        return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
    }

    static destroy(arr) {
        for (let i = 0; i < arr.length; i++) {
            arr[i].destroy();
        }
    }

    static animText(obj, text, delay = 50, gap = 1) {
        let count = 0;
        let newText = '';

        const update = () => {
            obj.setText(newText);

            if(!text[count] && timer) {
                timer.destroy();
                timer = null;
            }

            for (let i = 0; i < gap; i++) {
                if (text[count + i]) newText += text[count + i];
            }

            count += gap;
        }
        
        let timer = obj.scene.time.addEvent({delay: delay, callback: update, callbackScope: this, loop: true});
    }

    static changeProperty(arr, props, value, sign) {
        for (let i = 0; i < arr.length; i++) {
            for (let j = 0; j < props.length; j++) {
                if(sign === "+") {
                    arr[i][props[j]] += value;
                } else if(sign === "-") {
                    arr[i][props[j]] -= value;
                } else if(sign === "*") {
                    arr[i][props[j]] *= value;
                } else if(sign === "/") {
                    arr[i][props[j]] /= value;
                } else if(sign === "=") {
                    arr[i][props[j]] = value;
                }
            }
        }
    }
}