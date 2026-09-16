import ParentScene from "../core/framework/components/Scene";
import FinalWindow from "./FinalWindow";
import { Fireworks } from "./Fireworks";
import { World, Entity } from "./ecs/ECS";
import BASE_SETTINGS from "../game-settings.json";
import { SandGridComponent } from "./ecs/components/SandGridComponent";
import { ConveyorComponent } from "./ecs/components/ConveyorComponent";
import { SandGridSystem } from "./ecs/systems/SandGridSystem";
import { SandPhysicsSystem } from "./ecs/systems/SandPhysicsSystem";
import { ConveyorSystem } from "./ecs/systems/ConveyorSystem";
import { PotGridSystem } from "./ecs/systems/PotGridSystem";
import { TutorialSystem } from "./ecs/systems/TutorialSystem";

export default class Game extends ParentScene {
    constructor() {
        super('Game');
    }

    init(data) {
        this._sceneId = (data && data.sceneId) ? data.sceneId : 'scene-1';
        if (typeof window !== 'undefined' && window.App && window.App.flow && window.App.flow.length > 0 && (!data || !data.sceneId)) {
            const firstFlow = window.App.flow[0];
            if (typeof firstFlow === 'string') {
                this._sceneId = firstFlow;
            } else if (Array.isArray(firstFlow) && firstFlow.length > 0) {
                this._sceneId = firstFlow[0];
            }
        }

        const sceneData = (typeof window !== 'undefined' && window.App && window.App.scenesData && window.App.scenesData[this._sceneId])
            ? window.App.scenesData[this._sceneId]
            : BASE_SETTINGS;
        this.SETTINGS = JSON.parse(JSON.stringify(Object.assign({}, BASE_SETTINGS, sceneData)));
    }

    create() {
        this.gameOver = false;
        this._challengeStarted = false;
        this._pass25 = false;
        this._pass50 = false;
        this._pass75 = false;
        this.totalParticlesCollected = 0;
        this.totalTargetParticles = 0;

        // Ensure background looping music is playing
        this.ensureBackgroundMusic();
        this.input.on('pointerdown', () => {
            this.ensureBackgroundMusic();
            this.startChallenge();
        });

        // Camera background color
        this.cameras.main.setBackgroundColor('#dcebf8');

        // Background Layer (bg / bg_1 / bg_2 / bg_3 / bg_4 image or fallback gradient)
        const possibleBgKeys = [
            'bg', 'bg_1', 'bg_2', 'bg_3', 'bg_4',
            'bg.png', 'bg_1.png', 'bg_2.png', 'bg_3.png', 'bg_4.png'
        ];
        const activeBgKey = possibleBgKeys.find(k => this.textures.exists(k));

        if (activeBgKey) {
            this.bg = this.add.image(300, 0, activeBgKey);
        } else {
            this.bg = this.add.graphics();
            this.bg.fillGradientStyle(0x9fbce3, 0x9fbce3, 0x495e8e, 0x495e8e, 1, 1, 1, 1);
            this.bg.fillRect(-2000, -2000, 4000, 4000);
        }
        this.bg.setDepth(-99999);
        this.mainContainer.add(this.bg);
        this.mainContainer.sendToBack(this.bg);

        // Sand Image White Frame & Downward Tapering Funnel
        this.frameGfx = this.add.graphics();
        this.frameGfx.setDepth(5);
        this.mainContainer.add(this.frameGfx);
        this.funnelColliders = [];

        // UI Container
        this.uiContainer = this.add.container(0, 0);
        this.uiContainer.ignoreResize = true;
        this.uiContainer.setDepth(30);
        this.mainContainer.add(this.uiContainer);

        // Popup Container (End Screen: strictly above all gameplay elements, conveyor, cups, particles)
        this.popupLayer = this.add.container(0, 0);
        this.popupLayer.ignoreResize = true;
        this.popupLayer.setDepth(999999);
        this.mainContainer.add(this.popupLayer);

        // Pause and disable unused Phaser Matter.js engine to prune unused contact graph
        if (this.matter && this.matter.world) {
            this.matter.world.enabled = false;
            this.matter.world.pause();
        }

        // ECS Init
        this.ecsWorld = new World();

        // Add Systems in execution order
        this.ecsWorld.addSystem(new SandPhysicsSystem(this));
        this.ecsWorld.addSystem(new SandGridSystem(this));
        this.ecsWorld.addSystem(new ConveyorSystem(this));
        this.ecsWorld.addSystem(new PotGridSystem(this));
        this.ecsWorld.addSystem(new TutorialSystem(this));

        // Create Sand Grid Entity
        const sandEntity = new Entity();
        sandEntity.addComponent(new SandGridComponent(this));
        this.ecsWorld.addEntity(sandEntity);

        // Create Conveyor Assembly Entity
        const convPos = this.SETTINGS.conveyor_position || { x: 300, y: 645 };
        const conveyorEntity = new Entity();
        conveyorEntity.addComponent(new ConveyorComponent({
            x: convPos.x,
            y: convPos.y,
            scale: this.SETTINGS.conveyor_scale || 0.50,
            speed: this.SETTINGS.conveyor_speed || 130,
            direction: this.SETTINGS.conveyor_direction !== undefined ? this.SETTINGS.conveyor_direction : 1,
            capacityLimit: this.SETTINGS.conveyor_capacity_limit || 8,
            maxCapacity: this.SETTINGS.conveyor_max_capacity || 500,
            elements: this.SETTINGS.conveyor_elements
        }));
        this.ecsWorld.addEntity(conveyorEntity);

        // Fireworks for victory sequence
        const fwConfig = this.SETTINGS.fireworks || {};
        this.fireworks = new Fireworks(this, this.popupLayer, fwConfig);

        // Final Window
        this.finalWindow = new FinalWindow({
            scene: this,
            container: this.popupLayer,
            onRetry: () => {
                this.scene.restart();
            },
            onCta: () => {
                this.onCta();
            }
        });

        // Auto Lose Timer setup (if auto_lose_delay_sec > 0)
        const autoLoseDelaySec = this.SETTINGS.auto_lose_delay_sec !== undefined
            ? this.SETTINGS.auto_lose_delay_sec
            : (this.SETTINGS.auto_lose_sec !== undefined ? this.SETTINGS.auto_lose_sec : (this.SETTINGS.game_timeout_sec !== undefined ? this.SETTINGS.game_timeout_sec : 0));

        if (autoLoseDelaySec > 0) {
            this.autoLoseTimer = this.time.delayedCall(autoLoseDelaySec * 1000, () => {
                if (!this.gameOver) {
                    this.showLose();
                }
            });
        }

        if (typeof window !== 'undefined' && window.App) {
            window.App.activeGame = this;
        }

        // Trigger initial layout calculation
        this._resize();

        this.scale.on('resize', () => {
            if (this.scene && this.scene.key) {
                if (typeof this._resize === 'function') {
                    this._resize();
                }
            }
        });

        this.events.on('update', this.update, this);
        this.events.once('shutdown', () => {
            if (typeof window !== 'undefined' && window.App && window.App.activeGame === this) {
                window.App.activeGame = null;
            }
            if (this.autoLoseTimer) {
                this.autoLoseTimer.remove();
                this.autoLoseTimer = null;
            }
            this.input.removeAllListeners();
            this.scale.removeAllListeners('resize');
            this.events.off('update', this.update, this);
            if (this.fireworks) this.fireworks.destroy();
        });
    }

    updateFrameGfx(frameX, frameY, frameW, frameH, funnelBottomY, funnelWidth, topBlockScale) {
        if (!this.frameGfx) return;
        this.frameGfx.clear();

        const strokeW = Math.max(10, Math.round(18 * topBlockScale));
        const cornerR = Math.max(12, Math.round(24 * topBlockScale));

        const topY = frameY - frameH / 2;
        const bottomY = frameY + frameH / 2;
        const leftX = frameX - frameW / 2;
        const rightX = frameX + frameW / 2;

        const funnelLeftX = frameX - funnelWidth / 2;
        const funnelRightX = frameX + funnelWidth / 2;

        const drawBorder = (gfx, offsetY, color, alpha, width) => {
            gfx.lineStyle(width, color, alpha);

            gfx.beginPath();
            gfx.moveTo(frameX, topY + offsetY);
            gfx.lineTo(leftX + cornerR, topY + offsetY);
            gfx.arc(leftX + cornerR, topY + cornerR + offsetY, cornerR, -Math.PI / 2, Math.PI, true);
            gfx.lineTo(leftX, bottomY + offsetY);
            gfx.lineTo(funnelLeftX, funnelBottomY + offsetY);
            gfx.strokePath();

            gfx.beginPath();
            gfx.moveTo(frameX, topY + offsetY);
            gfx.lineTo(rightX - cornerR, topY + offsetY);
            gfx.arc(rightX - cornerR, topY + cornerR + offsetY, cornerR, -Math.PI / 2, 0, false);
            gfx.lineTo(rightX, bottomY + offsetY);
            gfx.lineTo(funnelRightX, funnelBottomY + offsetY);
            gfx.strokePath();

            gfx.fillStyle(color, alpha);
            gfx.fillCircle(funnelLeftX, funnelBottomY + offsetY, width / 2);
            gfx.fillCircle(funnelRightX, funnelBottomY + offsetY, width / 2);
        };

        const frameShadowPasses = [
            { offset: Math.max(3, 6 * topBlockScale), w: strokeW + 2, alpha: 0.12, color: 0x1d2e54 },
            { offset: Math.max(5, 10 * topBlockScale), w: strokeW + 6, alpha: 0.09, color: 0x1d2e54 },
            { offset: Math.max(7, 14 * topBlockScale), w: strokeW + 12, alpha: 0.06, color: 0x1d2e54 },
            { offset: Math.max(9, 18 * topBlockScale), w: strokeW + 18, alpha: 0.04, color: 0x1d2e54 },
            { offset: Math.max(11, 22 * topBlockScale), w: strokeW + 24, alpha: 0.02, color: 0x1d2e54 }
        ];
        frameShadowPasses.forEach(s => drawBorder(this.frameGfx, s.offset, s.color, s.alpha, s.w));
        drawBorder(this.frameGfx, Math.max(2, 4 * topBlockScale), 0x8ea8c8, 0.45, strokeW);
        drawBorder(this.frameGfx, 0, 0xffffff, 1.0, strokeW);
        drawBorder(this.frameGfx, -1, 0xffffff, 0.6, strokeW - 6);

        const inset = strokeW / 2;
        this.funnelColliders = [
            { x1: leftX + inset, y1: bottomY, x2: funnelLeftX + inset, y2: funnelBottomY },
            { x1: rightX - inset, y1: bottomY, x2: funnelRightX - inset, y2: funnelBottomY }
        ];
    }

    _resize() {
        const S = (this.mainContainer && this.mainContainer.scaleX) ? this.mainContainer.scaleX : (this.game.size?.scale || 1.0);
        const screenTop = -this.mainContainer.y / S;
        const screenBottom = (this.scale.height - this.mainContainer.y) / S;
        const screenCenterX = 300;
        const screenWidth = this.scale.width / S;
        const screenHeight = this.scale.height / S;
        const screenCenterY = (screenTop + screenBottom) / 2;

        if (this.bg) {
            this.bg.setDepth(-99999);
            if (this.mainContainer && this.mainContainer.sendToBack) {
                this.mainContainer.sendToBack(this.bg);
            }
            if (this.bg.texture && this.bg.texture.key !== '__DEFAULT') {
                this.bg.setPosition(screenCenterX, screenCenterY);
                const texWidth = this.bg.width;
                const texHeight = this.bg.height;
                const isPortrait = screenHeight > screenWidth;

                if (isPortrait) {
                    // Portrait mode: height strictly matches screen height
                    this.bg.setDisplaySize(texWidth * (screenHeight / texHeight), screenHeight);
                } else {
                    // Landscape mode: width strictly matches screen width
                    this.bg.setDisplaySize(screenWidth, texHeight * (screenWidth / texWidth));
                }
            }
        }

        const settings = this.SETTINGS;
        const cupGridCfg = settings.cup_grid || settings.pot_grid || {};

        // 1. The Bottom Block (Cups):
        // Pinned to bottom of screen so that exactly 2.5 rows are visible peeking up from the bottom
        const rows = cupGridCfg.rows || 3;
        const spacingY = cupGridCfg.spacing_y || 105;
        const cupScale = cupGridCfg.cup_scale !== undefined ? cupGridCfg.cup_scale : (cupGridCfg.pot_scale !== undefined ? cupGridCfg.pot_scale : 0.38);

        // Lowest row center (row index = rows - 1) is at screenBottom
        const targetCupGridY = screenBottom - (rows - 1) * spacingY;
        this.targetCupGridY = targetCupGridY;

        if (this.ecsWorld && this.ecsWorld.systems) {
            for (const sys of this.ecsWorld.systems) {
                if (sys && typeof sys.updateGridY === 'function') {
                    sys.updateGridY(targetCupGridY);
                }
            }
        }

        // Top rim of row 0 cups (cup height = 249 * cupScale)
        const cupHeight = 249 * cupScale;
        const cupTopRimY = targetCupGridY - cupHeight * 0.5;

        // 2. The Top Block (Picture & Conveyor):
        // Positioned in the center of the free space between screenTop and cupTopRimY
        const freeSpaceHeight = cupTopRimY - screenTop;
        const minPadding = 32; // Minimum total vertical padding (16px top + 16px bottom)

        // Base unscaled layout geometry
        const baseFrameW = 480;
        const baseFrameH = 505;

        // Always read the unscaled image_scale from the source of truth
        let originalImageScale = 0.72;
        if (typeof window !== 'undefined' && window.App && window.App.scenesData && window.App.scenesData[this._sceneId] && window.App.scenesData[this._sceneId].image_scale !== undefined) {
            originalImageScale = window.App.scenesData[this._sceneId].image_scale;
        } else if (BASE_SETTINGS && BASE_SETTINGS.image_scale !== undefined) {
            originalImageScale = BASE_SETTINGS.image_scale;
        }
        const baseImageScale = originalImageScale;

        const baseConveyorScale = 0.50;
        const baseConveyorOffsetY = 400; // relative to frameCenter (645 - 245)
        const baseConveyorBottomOffset = 466.75; // conveyor bottom relative to frameCenter (400 + 267 * 0.5 * 0.5)
        const baseFunnelBottomOffsetY = 325; // funnel bottom relative to frameCenter (570 - 245)
        if (this._baseFunnelWidth === undefined) {
            this._baseFunnelWidth = settings.funnel_hole_size || 56;
        }
        const baseFunnelWidth = this._baseFunnelWidth;
        const baseImageOffsetY = -9; // 236 - 245

        const unscaledTopBlockHeight = (baseFrameH * 0.5) + baseConveyorBottomOffset; // 252.5 + 466.75 = 719.25

        // Squash prevention: if screen gets too short (e.g. in landscape), scale down top block proportionally
        let topBlockScale = 1.0;
        if (freeSpaceHeight - minPadding < unscaledTopBlockHeight) {
            topBlockScale = Math.max(0.35, (freeSpaceHeight - minPadding) / unscaledTopBlockHeight);
        }

        const scaledTopBlockHeight = unscaledTopBlockHeight * topBlockScale;
        const remainingSpace = freeSpaceHeight - scaledTopBlockHeight;
        const topPadding = Math.max(16, remainingSpace / 2);

        const frameCenterY = (screenTop + topPadding) + (baseFrameH * 0.5) * topBlockScale;
        const frameW = baseFrameW * topBlockScale;
        const frameH = baseFrameH * topBlockScale;
        const funnelBottomY = frameCenterY + baseFunnelBottomOffsetY * topBlockScale;
        const funnelWidth = (baseFunnelWidth * topBlockScale);

        const baseLogicalX = settings._user_image_logical_x !== undefined ? settings._user_image_logical_x : (settings.image_logical_x !== undefined ? settings.image_logical_x : 300);
        const baseLogicalY = settings._user_image_logical_y !== undefined ? settings._user_image_logical_y : (settings.image_logical_y !== undefined ? settings.image_logical_y : 236);
        if (settings._user_image_logical_x === undefined && settings.image_logical_x !== undefined) {
            settings._user_image_logical_x = settings.image_logical_x;
        }
        if (settings._user_image_logical_y === undefined && settings.image_logical_y !== undefined) {
            settings._user_image_logical_y = settings.image_logical_y;
        }

        const offsetX = baseLogicalX - 300;
        const offsetY = baseLogicalY - 236;

        const imageX = screenCenterX + offsetX * topBlockScale;
        const imageY = (frameCenterY + baseImageOffsetY * topBlockScale) + offsetY * topBlockScale;
        const imageScale = baseImageScale * topBlockScale;

        const conveyorY = frameCenterY + baseConveyorOffsetY * topBlockScale;
        const conveyorScale = baseConveyorScale * topBlockScale;

        settings.image_logical_x = imageX;
        settings.image_logical_y = imageY;
        settings.image_scale = imageScale;
        settings.frame_x = screenCenterX;
        settings.frame_y = frameCenterY;
        settings.frame_width = frameW;
        settings.frame_height = frameH;
        settings.funnel_bottom_y = funnelBottomY;
        settings.funnel_hole_size = funnelWidth;
        settings.conveyor_position = { x: screenCenterX, y: conveyorY };
        settings.conveyor_scale = conveyorScale;

        const strokeW = Math.max(10, Math.round(18 * topBlockScale));
        const inset = strokeW / 2;
        settings.funnel_stroke_width = strokeW;
        settings.funnel_spout_left_x = (screenCenterX - funnelWidth / 2) + inset;
        settings.funnel_spout_right_x = (screenCenterX + funnelWidth / 2) - inset;

        this.updateFrameGfx(screenCenterX, frameCenterY, frameW, frameH, funnelBottomY, funnelWidth, topBlockScale);

        if (this.ecsWorld && this.ecsWorld.systems) {
            for (const sys of this.ecsWorld.systems) {
                if (sys && typeof sys.updateScaleAndPosition === 'function') {
                    sys.updateScaleAndPosition(screenCenterX, conveyorY, conveyorScale);
                }
            }
        }
    }

    getParticleSize() {
        const settings = this.SETTINGS || {};
        const baseScale = settings.particle_scale !== undefined ? settings.particle_scale : 5.0;
        const spacing = settings.particle_spacing !== undefined ? settings.particle_spacing : baseScale;
        const imageScale = settings.image_scale !== undefined ? settings.image_scale : 0.72;
        const logicalSize = baseScale * imageScale;
        return {
            baseScale,
            spacing,
            imageScale,
            logicalSize
        };
    }

    _showFinalWindow() {
        this.showWin();
    }

    dismissWarningBanner(onComplete) {
        // Find ConveyorSystem if active to trigger immediate animated outro of 'Conveyor Full' text
        let warningSystemFound = false;
        const world = this.ecsWorld || this.world;
        if (world && world.systems) {
            for (const sys of world.systems) {
                if (sys && typeof sys.dismissWarning === 'function') {
                    warningSystemFound = true;
                    sys.dismissWarning(onComplete);
                    break;
                }
            }
        }
        if (!warningSystemFound && onComplete) {
            onComplete();
        }
    }

    startChallenge() {
        if (this._challengeStarted) return;
        this._challengeStarted = true;
        if (typeof window.trackAxonEvent === 'function') {
            window.trackAxonEvent('CHALLENGE_STARTED');
        }
    }

    checkChallengeProgress(ratio) {
        if (!this._challengeStarted) {
            this.startChallenge();
        }
        if (ratio >= 0.25 && !this._pass25) {
            this._pass25 = true;
            if (typeof window.trackAxonEvent === 'function') window.trackAxonEvent('CHALLENGE_PASS_25');
        }
        if (ratio >= 0.50 && !this._pass50) {
            this._pass50 = true;
            if (typeof window.trackAxonEvent === 'function') window.trackAxonEvent('CHALLENGE_PASS_50');
        }
        if (ratio >= 0.75 && !this._pass75) {
            this._pass75 = true;
            if (typeof window.trackAxonEvent === 'function') window.trackAxonEvent('CHALLENGE_PASS_75');
        }
    }

    dismissTutorialHelper() {
        const world = this.ecsWorld || this.world;
        if (world && world.systems) {
            for (const sys of world.systems) {
                if (sys && typeof sys.hideHelper === 'function') {
                    sys.hideHelper();
                }
            }
        }
    }

    showWin() {
        if (this.gameOver) return;
        this.gameOver = true;
        if (this.autoLoseTimer) {
            this.autoLoseTimer.remove();
            this.autoLoseTimer = null;
        }
        this.dismissTutorialHelper();

        this.dismissWarningBanner(() => {
            // Bring popup layer to the absolute top of the render hierarchy
            if (this.mainContainer && this.popupLayer) {
                this.mainContainer.bringToTop(this.popupLayer);
                this.popupLayer.setDepth(999999);
                if (typeof this.sort === 'function') this.sort();
            }

            // 1. Immediately trigger celebratory fireworks bursts across the screen
            if (this.fireworks) {
                this.fireworks.start();
            }

            // 2-5. Audio (win_sound.mp3), Overlay, Win Banner (win_text.png), Button (btn-play_next.png), Helper Hand
            this.finalWindow.show(true);
        });
    }

    showLose() {
        if (this.gameOver) return;
        this.gameOver = true;
        if (this.autoLoseTimer) {
            this.autoLoseTimer.remove();
            this.autoLoseTimer = null;
        }
        this.dismissTutorialHelper();

        this.dismissWarningBanner(() => {
            // Bring popup layer to the absolute top of the render hierarchy
            if (this.mainContainer && this.popupLayer) {
                this.mainContainer.bringToTop(this.popupLayer);
                this.popupLayer.setDepth(999999);
                if (typeof this.sort === 'function') this.sort();
            }

            // 1-4. Audio (fail_sound.mp3), Overlay, Fail Banner (fail_text.png), Button (btn-try_again.png), Helper Hand
            this.finalWindow.show(false);
        });
    }

    ensureBackgroundMusic() {
        if (typeof window === 'undefined' || !window.App) return;

        // Resume AudioContext if suspended (browser autoplay policy)
        if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
            this.sound.context.resume().catch(() => { });
        }

        if (window.App.isMusicPlaying && window.App.bgMusic && window.App.bgMusic.isPlaying) {
            return;
        }

        try {
            if (window.App.resources && window.App.resources.audio && window.App.resources.audio.json) {
                const spritemap = window.App.resources.audio.json.spritemap || {};
                const track = spritemap['music'] ? 'music' : (spritemap['mucis'] ? 'mucis' : null);
                if (track) {
                    const sound = this.sound.addAudioSprite('sfx');
                    if (sound) {
                        sound.play(track, { loop: true, volume: 0.95 });
                        window.App.isMusicPlaying = true;
                        window.App.bgMusic = sound;
                    }
                }
            }
        } catch (e) {
            // Audio safety
        }
    }

    update(time, delta) {
        if (typeof document !== 'undefined' && document.hidden) {
            return;
        }

        const clampedDelta = Math.min(Math.max(0, delta), 1000 / 30);

        const currentScale = (this.mainContainer && this.mainContainer.scaleX) ? this.mainContainer.scaleX : 1.0;
        const currentWidth = (this.scale && this.scale.width) ? this.scale.width : 600;
        const currentHeight = (this.scale && this.scale.height) ? this.scale.height : 900;
        if (this._lastWidth !== currentWidth || this._lastHeight !== currentHeight || this._lastScale !== currentScale) {
            this._lastWidth = currentWidth;
            this._lastHeight = currentHeight;
            this._lastScale = currentScale;
            this._resize();
        }

        if (this.fireworks && this.fireworks.running) {
            this.fireworks.update(clampedDelta);
        }

        if (this.ecsWorld) {
            this.ecsWorld.update(time, clampedDelta);
        }
    }

    onCta() {
        const network = (typeof window !== 'undefined' && window.App && window.App.networkInstance)
            ? window.App.networkInstance
            : ((typeof window !== 'undefined' && window.App && window.App.network) ? window.App.network : null);

        if (network) {
            if (typeof network.complete === 'function') {
                network.complete();
            }
            if (typeof network.ctaClick === 'function') {
                network.ctaClick();
            } else if (typeof network.openStore === 'function') {
                network.openStore();
            }
        } else if (typeof window !== 'undefined' && window.App && typeof window.App.cta === 'function') {
            window.App.cta();
        } else if (typeof window !== 'undefined' && typeof window.callCTALink === 'function') {
            window.callCTALink();
        } else {
            console.log("CTA Clicked");
        }
    }
}
