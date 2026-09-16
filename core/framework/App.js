import Network from '../networks/Network';
import Applovin from '../networks/Applovin';
import Facebook from '../networks/Facebook';
import Google from '../networks/Google';
import IronSource from '../networks/IronSource';
import Liftoff from '../networks/Liftoff';
import Mintegral from '../networks/Mintegral';
import Moloco from '../networks/Moloco';
import TikTok from '../networks/TikTok';
import UnityAds from '../networks/UnityAds';
import Vungle from '../networks/Vungle';

import Preloader from './Preloader';
import Game from '../../src/Game';
import TransitionScene from '../../src/TransitionScene';
import TimerScene from '../../src/TimerScene';
import StateManager from '../../src/StateManager';

import Utils from './Utils';

const getConfiguredNetworkName = () => {
    if (typeof window.App.networkName === 'string' && window.App.networkName.length > 0) {
        return window.App.networkName;
    }

    if (typeof window.App.network === 'string' && window.App.network.length > 0) {
        return window.App.network;
    }

    return '';
};

class App extends Phaser.Game {
    constructor() {
        // Patch Phaser cameras to support addToRenderList if missing in custom Phaser builds
        if (typeof Phaser !== 'undefined' && Phaser.Cameras && Phaser.Cameras.Scene2D) {
            ['BaseCamera', 'Camera'].forEach((clsName) => {
                const cls = Phaser.Cameras.Scene2D[clsName];
                if (cls && cls.prototype && typeof cls.prototype.addToRenderList !== 'function') {
                    console.log(`[App] Patching Phaser.Cameras.Scene2D.${clsName}.prototype with addToRenderList`);
                    cls.prototype.addToRenderList = function (gameObject) {
                        if (!this.renderList) {
                            this.renderList = [];
                        }
                        this.renderList.push(gameObject);
                    };
                }
            });
        }

        const config = {
            type: Phaser.AUTO,
            parent: 'app',
            scale: {
                mode: Phaser.Scale.NONE,
                width: window.innerWidth * window.devicePixelRatio,
                height: window.innerHeight * window.devicePixelRatio,
            },
            title: 'Core Version: ' + window.App.CORE_VERSION,
            backgroundColor: '#1e1e1e',
            scene: [Preloader, Game, TransitionScene, TimerScene],
            physics: {
                default: 'matter',
                matter: {
                    gravity: { y: 1 },
                    debug: false
                }
            }
        };

        if(window.SpinePlugin) {
            config['plugins'] = {
                scene: [{ key: 'SpinePlugin', plugin: window.SpinePlugin, start: true, mapping: 'spine' }]
            };

            // Bridge SpinePlugin renderers for Phaser 3.50+ Container WebGL compatibility.
            // Phaser 3.50+ passes 5 arguments: (renderer, src, interpolationPercentage, camera, parentMatrix).
            // SpinePlugin expects 4 arguments: (renderer, src, camera, parentMatrix).
            const patchRender = (fn, name) => {
                if (typeof fn !== 'function' || fn._isPatched) return fn;
                const patched = function (renderer, src) {
                    const args = Array.prototype.slice.call(arguments, 2);
                    console.log(`[SpinePatch ${name}]`, {
                        renderer: !!renderer,
                        src: src ? src.constructor.name : null,
                        argsCount: args.length,
                        args: args.map(a => {
                            if (!a) return String(a);
                            if (typeof a === 'object') {
                                return {
                                    constructor: a.constructor.name,
                                    hasAddToRenderList: typeof a.addToRenderList === 'function',
                                    keys: Object.keys(a).slice(0, 5)
                                };
                            }
                            return typeof a + ': ' + String(a);
                        })
                    });
                    let camIdx = -1;
                    for (let k = 0; k < args.length; k++) {
                        if (args[k] && typeof args[k].addToRenderList === 'function') {
                            camIdx = k;
                            break;
                        }
                    }
                    if (camIdx !== -1) {
                        return fn.apply(this, [renderer, src].concat(args.slice(camIdx)));
                    }
                    const fallbackCam = src && src.scene && src.scene.cameras && src.scene.cameras.main;
                    if (fallbackCam && typeof fallbackCam.addToRenderList === 'function') {
                        let matrix = args[1] || (args[0] && typeof args[0] === 'object' ? args[0] : undefined);
                        return fn.call(this, renderer, src, fallbackCam, matrix);
                    }
                    return fn.apply(this, arguments);
                };
                patched._isPatched = true;
                return patched;
            };

            ['SpineGameObject', 'SpineContainer'].forEach((className) => {
                const cls = window.SpinePlugin[className];
                if (cls && cls.prototype) {
                    if (cls.prototype.renderWebGL) {
                        cls.prototype.renderWebGL = patchRender(cls.prototype.renderWebGL, `${className}.renderWebGL`);
                    }
                    if (cls.prototype.renderCanvas) {
                        cls.prototype.renderCanvas = patchRender(cls.prototype.renderCanvas, `${className}.renderCanvas`);
                    }
                }
            });
        }

        super(config);

        this.create();
        this.addStyle();
        this.setObjects();
        this.fixedAudioStop();
        this.resize();
    }

    create() {
        setTimeout('window.scrollTo(0, 1)', 10);

        if(!window.dapi) window.addEventListener('resize', this.resize.bind(this), true);

        const networkName = getConfiguredNetworkName();

        this.network = network;
        this.network.game = this;
        window.App.networkName = networkName;
        window.App.network = this.network;
        this.size = {resize: this.resize.bind(this)};

        // Initialise the state manager with the level flow injected by the builder
        window.App.stateManager = new StateManager(window.App.flow || []);
    }

    addStyle() {
        document.body.style.margin = '0%';
        document.body.style.padding = '0%';
        document.body.style.backgroundColor = '#000000';

        document.getElementById('app').style.position = 'relative';

        let styleNode = document.createElement('style');
        styleNode.type = 'text/css';
        document.getElementsByTagName('head')[0].appendChild(styleNode);

        this.changeLoaderStyle();
            
        let webkitKeyFrames = '@-webkit-keyframes spin{0%{-webkit-transform:rotate(0deg);}100%{-webkit-transform:rotate(360deg);}}';
        let webkitTextNode = document.createTextNode(webkitKeyFrames);
        document.getElementsByTagName('style')[0].appendChild(webkitTextNode);

        let keyFrames = '@keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}';
        let textNode = document.createTextNode(keyFrames);
        document.getElementsByTagName('style')[0].appendChild(textNode);
    }

    changeLoaderStyle() {
        let loader = document.getElementById('loader').style.display;

        let w = (window.innerWidth > window.innerHeight) ? window.innerHeight : window.innerWidth;
        let size = (w / 10) * window.devicePixelRatio;
        let sizeBorder = size / 10;
        let margin = (size / 2) + (sizeBorder / 2);
        
        let loaderStyle = 'position: absolute;top: 50%;left: 50%;margin-left: -' + margin + 'px;margin-top: -' + margin + 'px;';
        loaderStyle += 'background-color: #000000;border:' + sizeBorder + 'px solid #000000;border-radius: 50%;';
        loaderStyle += 'width: 100%;height: 100%;display:' + loader + ';';
        loaderStyle += 'border-bottom:' + sizeBorder + 'px solid #ffffff;border-top:' + sizeBorder + 'px solid #ffffff;';
        loaderStyle += 'width:' + size + 'px;height:' + size + 'px;-webkit-animation:spin 2s linear infinite;animation:spin 2s linear infinite;'
        document.getElementById('loader').style.cssText = loaderStyle;
    }

    setObjects() {
        const objects = [Phaser.GameObjects.Sprite.prototype, Phaser.GameObjects.Graphics.prototype,
                         Phaser.GameObjects.Container.prototype,Phaser.GameObjects.Image.prototype, 
                         Phaser.GameObjects.Text.prototype, Phaser.GameObjects.TileSprite.prototype,
                         Phaser.GameObjects.RenderTexture.prototype,
                         Phaser.GameObjects.Particles.ParticleEmitterManager.prototype];
 
        if (window.SpinePlugin) objects.push(SpinePlugin.SpineGameObject.prototype);
        
        for (let i = 0; i < objects.length; i++) {
            Utils.addDefaultProperties(objects[i]);
        }
    }

    resize() {
        let width = window.innerWidth;
        let height = window.innerHeight;

        let deviceWidth = width * window.devicePixelRatio;
        let deviceHeight = height * window.devicePixelRatio;
        if(window.dapi) {
            width = window.dapi.getScreenSize().width;
            height = window.dapi.getScreenSize().height;

            deviceWidth = window.dapi.getScreenSize().width * window.devicePixelRatio;
            deviceHeight = window.dapi.getScreenSize().height * window.devicePixelRatio;
        } else if (getConfiguredNetworkName() === 'Applovin') {
            width = window.mraid.getScreenSize().width;
            height = window.mraid.getScreenSize().height;

            deviceWidth = window.mraid.getScreenSize().width * window.devicePixelRatio;
            deviceHeight = window.mraid.getScreenSize().height * window.devicePixelRatio;
        }
        
        document.getElementById('app').style.width = width + 'px';
        document.getElementById('app').style.height = height + 'px';

        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        this.scale.resize(deviceWidth, deviceHeight);

        let scale = Math.min(deviceWidth / 600, deviceHeight / 900);
        this.size.scale = scale;
        this.size.isPortrait = deviceWidth < deviceHeight;
        
        this.updateScale();
        this.scaleContainer();
        this.changeLoaderStyle();
    }

    scaleContainer() {
        for (let i = 0; i < this.scene.scenes.length; i++) {
            if(this.scene.scenes[i].mainContainer) {
                const container = this.scene.scenes[i].mainContainer;
                // Center the fixed 600x900 logical game container in viewport
                container.setPosition(this.scale.width / 2 - 300 * this.size.scale, this.scale.height / 2 - 450 * this.size.scale);
                container.setScale(this.size.scale);
                if (typeof this.scene.scenes[i]._resize === 'function') {
                    this.scene.scenes[i]._resize();
                }
            }
        }
    }

    resizeObj(container) {
        for (let j = 0; j < container.list.length; j++) {
            const obj = container.list[j];
            if (obj.ignoreResize) continue;
            if( obj.customProps.includes('pos') ) {
                this.size.isPortrait ? obj.setCustomPosition(obj.px, obj.py) : obj.setCustomPosition(obj.lx, obj.ly);
            } else {
                obj.setCustomPosition(obj.cx, obj.cy);
            }

            if( obj.customProps.includes('scale') ) this.size.isPortrait ? obj.setScale(obj.pScaleX, obj.pScaleY) : obj.setScale(obj.lScaleX, obj.lScaleY);
            if( obj.customProps.includes('angle') ) this.size.isPortrait ? obj.setAngle(obj.pAngle) : obj.setAngle(obj.lAngle);
            if( obj.customProps.includes('alpha') ) this.size.isPortrait ? obj.setAlpha(obj.pAlpha) : obj.setAlpha(obj.lAlpha);
            if( obj.customProps.includes('visible') ) this.size.isPortrait ? obj.setVisible(obj.pVisible) : obj.setVisible(obj.lVisible);
            if( obj.customProps.includes('align') ) this.size.isPortrait ? obj.setAlign(obj.pAlign) : obj.setAlign(obj.lAlign);
            if( obj.customProps.includes('image') ) {
                const img = this.size.isPortrait ? obj.pImage : obj.lImage;
                (window.App.resources.textures[img] || img === "__MISSING" || img === "None") ?  obj.setTexture(img) : obj.setTexture('atlas', img);
            }
            if( obj.customProps.includes('origin') ) this.size.isPortrait ? obj.setOrigin(obj.pOriginX, obj.pOriginY) : obj.setOrigin(obj.lOriginX, obj.lOriginY);
        }
    }

    updateScale() {
        const width = this.scale.width;
        const height = this.scale.height;

        this.size.x = 300;
        this.size.y = 450;
        this.size.width = 600;
        this.size.height = 900;
        this.size.left = 0;
        this.size.right = 600;
        this.size.top = 0;
        this.size.bottom = 900;
    }

    fixedAudioStop() {
        let audioContext = this.sound.context;
        setInterval(() => {
            if (audioContext.state === 'suspended') {
                this.sound.mute = true;
            } else {
                if(this.sound.mute) this.sound.mute = false;
            }
        }, 1);
    }
}

let network;
const start = () => {
    new App();
}

const networkName = getConfiguredNetworkName();

if(networkName === 'Applovin') {
    network = new Applovin(start);
} else if(networkName === 'Facebook') {
    network = new Facebook(start);
} else if(networkName === 'Moloco') {
    network = new Moloco(start);
} else if(networkName === 'Google') {
    network = new Google(start);
} else if(networkName === 'IronSource') {
    network = new IronSource(start);
} else if(networkName === 'Liftoff') {
    network = new Liftoff(start);
} else if(networkName === 'TikTok') {
    network = new TikTok(start);
} else if(networkName === 'UnityAds') {
    network = new UnityAds(start);
} else if(networkName === 'Mintegral') {
    network = new Mintegral(start);
} else if(networkName === 'Vungle') {
    network = new Vungle(start);
} else {
    network = new Network(start);
}

window.App.networkInstance = network;
window.App.cta = () => {
    if (network && typeof network.ctaClick === 'function') {
        network.ctaClick();
    } else if (network && typeof network.openStore === 'function') {
        network.openStore();
    } else {
        const url = (typeof window.App.androidUrl === 'string' && navigator.userAgent.match(/Android/i))
            ? window.App.androidUrl
            : (window.App.iosUrl || window.App.androidUrl);
        if (url) window.top.open(url);
    }
};

window.App.CORE_VERSION = '0.0.5';