import { System, Entity } from '../ECS';
import { PotComponent } from '../components/PotComponent';
import { SandGridComponent } from '../components/SandGridComponent';
import { ConveyorComponent } from '../components/ConveyorComponent';
import { generateCupQueue } from './CupGenerator';

export class PotGridSystem extends System {
    constructor(game) {
        super(game);
        this.initialized = false;
        this.gridContainer = null;
        this.potQueue = [];
        this.columns = []; // columns[col][row]
        this.cols = 4;
        this.rows = 3;
        this.startX = 0;
        this.spacingX = 95;
        this.spacingY = 120;
        this.potScale = 0.35;
    }

    buildPotQueue(sandGrid, potCapacity = 200) {
        const result = generateCupQueue(sandGrid, potCapacity);
        return result.queue;
    }

    initGrid(world) {
        const game = this.game;
        const settings = game.SETTINGS || {};
        const gridConfig = settings.cup_grid || settings.pot_grid || {};

        const sandEntities = world.getEntitiesWith([SandGridComponent]);
        if (sandEntities.length === 0) return;
        const sandGrid = sandEntities[0].getComponent(SandGridComponent);

        const potCapacity = settings.pot_capacity || 200;
        this.potQueue = this.buildPotQueue(sandGrid, potCapacity);

        let totalTarget = 0;
        for (let i = 0; i < this.potQueue.length; i++) {
            totalTarget += (this.potQueue[i].capacity || 0);
        }
        this.game.totalTargetParticles = totalTarget || sandGrid.particleCount || 1;
        this.game.totalParticlesCollected = 0;

        const cols = gridConfig.columns || 4;
        const rows = gridConfig.rows || 3;
        this.cols = cols;
        this.rows = rows;

        const gridX = gridConfig.x !== undefined ? gridConfig.x : (gridConfig.position && gridConfig.position.x !== undefined ? gridConfig.position.x : 300);
        const startY = (this.game.targetCupGridY !== undefined)
            ? this.game.targetCupGridY
            : (gridConfig.y !== undefined ? gridConfig.y : (gridConfig.position && gridConfig.position.y !== undefined ? gridConfig.position.y : 740));
        const spacingX = gridConfig.spacing_x || 135;
        const spacingY = gridConfig.spacing_y || 105;
        const potScale = gridConfig.cup_scale !== undefined ? gridConfig.cup_scale : (gridConfig.pot_scale !== undefined ? gridConfig.pot_scale : 0.44);

        this.spacingX = spacingX;
        this.spacingY = spacingY;
        this.potScale = potScale;

        this.columns = Array.from({ length: cols }, () => new Array(rows).fill(null));

        this.gridContainer = game.add.container(gridX, startY);
        this.gridContainer.setDepth(8);
        if (game.mainContainer) {
            game.mainContainer.add(this.gridContainer);
        }

        const totalWidth = (cols - 1) * spacingX;
        const startX = -totalWidth / 2;
        this.startX = startX;

        // Populate initial grid
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (this.potQueue.length > 0) {
                    const potDef = this.potQueue.shift();
                    this.spawnPotInSlot(world, c, r, potDef, false);
                }
            }
        }

        this.initialized = true;
    }

    updateGridY(newGridY) {
        if (!this.gridContainer) return;
        this.gridContainer.y = newGridY;
        this.gridContainer.x = 300;

        for (let c = 0; c < this.cols; c++) {
            for (let r = 0; r < this.rows; r++) {
                const item = this.columns[c][r];
                if (item && item.comp && item.comp.container) {
                    const cx = this.startX + c * this.spacingX;
                    const cy = r * this.spacingY;
                    item.comp.x = this.gridContainer.x + cx;
                    item.comp.y = this.gridContainer.y + cy;
                }
            }
        }
    }

    spawnPotInSlot(world, col, row, potDef, withAnimation = false) {
        const game = this.game;
        const cx = this.startX + col * this.spacingX;
        const cy = row * this.spacingY;

        const potEntity = new Entity();
        const potComp = new PotComponent({
            color: potDef.color,
            acceptedColors: potDef.acceptedColors,
            capacity: potDef.capacity,
            gridCol: col,
            gridRow: row,
            state: 'in_grid'
        });

        const potCont = game.add.container(cx, cy);
        this.gridContainer.add(potCont);
        potCont.setDepth(this.rows - row); // top row should be highest depth if they overlap? Actually row 0 is top. So depth 3, 2, 1

        // Blurred drop shadow under the cup, enlarged by 1.1x
        const shadowTexKey = 'cup_shadow_blurred';
        let hasBlurredTex = false;
        try {
            if (!game.textures.exists(shadowTexKey)) {
                const tw = 240;
                const th = 100;
                const canvasTex = game.textures.createCanvas(shadowTexKey, tw, th);
                const ctx = canvasTex.getContext();
                ctx.filter = 'blur(7px)';
                ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                ctx.beginPath();
                ctx.ellipse(tw / 2, th / 2, 95, 30, 0, 0, Math.PI * 2);
                ctx.fill();
                canvasTex.refresh();
                hasBlurredTex = true;
            } else {
                hasBlurredTex = true;
            }
        } catch (e) {
            console.warn('[PotGridSystem] Cup shadow canvas blur fallback:', e);
        }

        if (hasBlurredTex && game.textures.exists(shadowTexKey)) {
            const shadowImg = game.add.image(0, 45, shadowTexKey);
            shadowImg.setOrigin(0.5, 0.5);
            shadowImg.setScale(this.potScale * 1.1); // Increased by 1.1
            potCont.add(shadowImg);
            potComp.shadow = shadowImg;
        } else {
            // Multi-layered soft ellipse fallback enlarged by 1.1x
            const shadowGfx = game.add.graphics();
            const bw = 180 * this.potScale * 1.1;
            const bh = 60 * this.potScale * 1.1;
            shadowGfx.fillStyle(0x000000, 0.08);
            shadowGfx.fillEllipse(0, 45, bw * 1.25, bh * 1.25);
            shadowGfx.fillStyle(0x000000, 0.12);
            shadowGfx.fillEllipse(0, 45, bw, bh);
            shadowGfx.fillStyle(0x000000, 0.15);
            shadowGfx.fillEllipse(0, 45, bw * 0.75, bh * 0.75);
            potCont.add(shadowGfx);
            potComp.shadow = shadowGfx;
        }

        // Calculate enhanced color tint with saturation boost from game-settings.json
        const settings = game.SETTINGS || {};
        const gridConfig = settings.cup_grid || settings.pot_grid || {};

        const getSaturatedColor = (hexColor) => {
            const satMult = gridConfig.color_saturation !== undefined ? gridConfig.color_saturation : (settings.cup_color_saturation !== undefined ? settings.cup_color_saturation : 1.30);
            const lightMult = gridConfig.color_lightness !== undefined ? gridConfig.color_lightness : (settings.cup_color_lightness !== undefined ? settings.cup_color_lightness : 1.05);

            if (satMult === 1.0 && lightMult === 1.0) return hexColor;

            let r = ((hexColor >> 16) & 0xFF) / 255.0;
            let g = ((hexColor >> 8) & 0xFF) / 255.0;
            let b = (hexColor & 0xFF) / 255.0;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h = 0;
            let s = 0;
            let l = (max + min) / 2.0;

            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2.0 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                }
                h /= 6.0;
            }

            // Apply saturation & lightness multipliers
            s = Math.max(0.0, Math.min(1.0, s * satMult));
            l = Math.max(0.0, Math.min(1.0, l * lightMult));

            // Convert back to RGB
            let outR, outG, outB;
            if (s === 0) {
                outR = outG = outB = l;
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1 / 6) return p + (q - p) * 6 * t;
                    if (t < 1 / 2) return q;
                    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
                const p = 2.0 * l - q;
                outR = hue2rgb(p, q, h + 1 / 3);
                outG = hue2rgb(p, q, h);
                outB = hue2rgb(p, q, h - 1 / 3);
            }

            const ir = Math.min(255, Math.max(0, Math.round(outR * 255)));
            const ig = Math.min(255, Math.max(0, Math.round(outG * 255)));
            const ib = Math.min(255, Math.max(0, Math.round(outB * 255)));
            return (ir << 16) | (ig << 8) | ib;
        };
        const cupTint = potDef.color;

        // Two-layer cup setup: cup_back (inside back wall) behind particles, cup_front in front
        const cupBack = game.add.image(0, 0, 'cup_back');
        cupBack.setOrigin(0.5, 0.5);
        cupBack.setScale(this.potScale);
        cupBack.setTint(cupTint);
        potCont.add(cupBack);

        // Container for collected particles inside the cup (rendered between cup_back and cup_front)
        const particlesInsideCont = game.add.container(0, 0);
        potCont.add(particlesInsideCont);

        const cupFront = game.add.image(0, 0, 'cup_front');
        cupFront.setOrigin(0.5, 0.5);
        cupFront.setScale(this.potScale);
        cupFront.setTint(cupTint);
        potCont.add(cupFront);

        const volumeMult = gridConfig.cup_volume_multiplier !== undefined
            ? gridConfig.cup_volume_multiplier
            : (settings.cup_volume_multiplier !== undefined ? settings.cup_volume_multiplier : 4);
        const displayCapacity = potDef.capacity * volumeMult;

        const textSizeVal = gridConfig.cup_text_size !== undefined
            ? gridConfig.cup_text_size
            : (gridConfig.text_size !== undefined
                ? gridConfig.text_size
                : (settings.cup_text_size !== undefined
                    ? settings.cup_text_size
                    : (settings.text_size !== undefined ? settings.text_size : 30)));
        const fontSizeStr = typeof textSizeVal === 'number' ? `${textSizeVal}px` : textSizeVal;

        // Capacity text overlay: bold dark charcoal with crisp white outline
        const capacityText = game.add.text(0, 16, displayCapacity.toString(), {
            fontFamily: 'Arial, sans-serif',
            fontSize: fontSizeStr,
            fontStyle: 'bold',
            fill: '#111111',
            stroke: '#ffffff',
            strokeThickness: 4
        });
        capacityText.setOrigin(0.5, 0.5);
        potCont.add(capacityText);

        potComp.container = potCont;
        potComp.cupSprite = cupFront;
        potComp.cupBack = cupBack;
        potComp.cupFront = cupFront;
        potComp.particlesContainer = particlesInsideCont;
        potComp.capacityText = capacityText;
        potComp.currentDisplayVol = displayCapacity;
        // Store global X for physics checks
        potComp.x = this.gridContainer.x + cx;
        potComp.y = this.gridContainer.y + cy;

        potEntity.addComponent(potComp);
        world.addEntity(potEntity);

        this.columns[col][row] = { entity: potEntity, comp: potComp };

        if (withAnimation) {
            potCont.setPosition(cx, cy + this.spacingY);
            potCont.setAlpha(0);
            game.tweens.add({
                targets: potCont,
                y: cy,
                alpha: 1,
                duration: 250,
                ease: 'Quad.easeOut',
                onComplete: () => {
                    if (potCont && potCont.active) {
                        potCont.setAlpha(1);
                    }
                }
            });
        } else {
            potCont.setAlpha(1);
        }

        return potEntity;
    }

    playPopSound() {
        try {
            if (typeof window !== 'undefined' && window.App && window.App.resources && window.App.resources.audio && window.App.resources.audio.json) {
                const spritemap = window.App.resources.audio.json.spritemap || {};
                if (spritemap['pop']) {
                    const sound = this.game.sound.addAudioSprite('sfx');
                    if (sound) {
                        sound.play('pop', { volume: 0.3 });
                    }
                    return;
                }
            }
            if (this.game && this.game.sound) {
                this.game.sound.play('pop', { volume: 0.3 });
            }
        } catch (e) {
            console.warn(e);
        }
    }

    playSlideSound() {
        try {
            if (typeof window !== 'undefined' && window.App && window.App.resources && window.App.resources.audio && window.App.resources.audio.json) {
                const spritemap = window.App.resources.audio.json.spritemap || {};
                if (spritemap['slide']) {
                    const sound = this.game.sound.addAudioSprite('sfx');
                    if (sound) {
                        sound.play('slide', { volume: 0.05 });
                    }
                    return;
                }
            }
            if (this.game && this.game.sound) {
                this.game.sound.play('slide', { volume: 0.05 });
            }
        } catch (e) {
            console.warn(e);
        }
    }

    shiftColumn(world, col) {
        // Remove the top pot (row 0) visually
        const topPot = this.columns[col][0];
        if (topPot) {
            topPot.comp.state = 'filled';

            if (topPot.comp.shadow) {
                topPot.comp.shadow.setVisible(false);
            }

            this.game.tweens.killTweensOf(topPot.comp.container);

            const container = topPot.comp.container;
            container.setDepth(9999); // Render above all other cups while flying away
            const startX = container.x;
            const startY = container.y;

            // Phase 1: Light compression (anticipation)
            this.game.tweens.add({
                targets: container,
                scaleX: 1.1,
                scaleY: 0.9,
                y: startY + 10,
                duration: 120,
                ease: 'Sine.easeOut',
                onComplete: () => {
                    // Phase 2: Stretch and rise upward slightly (reduced height)
                    this.game.tweens.add({
                        targets: container,
                        scaleX: 0.85,
                        scaleY: 1.15,
                        y: startY - 45,
                        duration: 180,
                        ease: 'Quad.easeOut',
                        onComplete: () => {
                            // Phase 3: Freeze and settle scale
                            this.game.tweens.add({
                                targets: container,
                                scaleX: 1.0,
                                scaleY: 1.0,
                                duration: 120,
                                onComplete: () => {
                                    // Phase 4: Sharply fly to the right and dissolve
                                    this.playSlideSound();
                                    this.game.tweens.add({
                                        targets: container,
                                        x: startX + 350,
                                        alpha: 0,
                                        duration: 250,
                                        ease: 'Back.easeIn',
                                        onComplete: () => {
                                            container.destroy();
                                            world.removeEntity(topPot.entity);

                                            // Shift rows up AFTER cup has flown away
                                            const SHIFT_DURATION = 250;
                                            for (let r = 1; r < this.rows; r++) {
                                                const item = this.columns[col][r];
                                                const targetRow = r - 1;
                                                this.columns[col][targetRow] = item;
                                                this.columns[col][r] = null;

                                                if (item) {
                                                    item.comp.gridRow = targetRow;
                                                    const targetY = targetRow * this.spacingY;
                                                    item.comp.y = this.gridContainer.y + targetY;
                                                    item.comp.container.setDepth(this.rows - targetRow);

                                                    this.game.tweens.killTweensOf(item.comp.container);
                                                    this.game.tweens.add({
                                                        targets: item.comp.container,
                                                        y: targetY,
                                                        alpha: 1,
                                                        duration: SHIFT_DURATION,
                                                        ease: 'Quad.easeOut',
                                                        onComplete: () => {
                                                            if (item && item.comp && item.comp.container) {
                                                                item.comp.container.setAlpha(1);
                                                            }
                                                        }
                                                    });
                                                }
                                            }

                                            // Replenish bottom row
                                            const bottomRow = this.rows - 1;
                                            if (this.potQueue.length > 0) {
                                                const nextPotDef = this.potQueue.shift();
                                                this.spawnPotInSlot(world, col, bottomRow, nextPotDef, true);
                                            }
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }
    }

    playLidAnimationAndShift(world, col, item) {
        if (!item || !item.comp || !item.comp.container) {
            this.shiftColumn(world, col);
            return;
        }

        const potComp = item.comp;
        const potCont = potComp.container;

        // Hide capacity text immediately as lid animation begins
        if (potComp.capacityText) {
            potComp.capacityText.setVisible(false);
        }

        // Texture key lookup (supports 'cup_lid', 'cup-lid', etc.)
        let lidKey = 'cup_lid';
        if (this.game.textures.exists('cup_lid')) lidKey = 'cup_lid';
        else if (this.game.textures.exists('cup-lid')) lidKey = 'cup-lid';
        else if (this.game.textures.exists('cup_lid.png')) lidKey = 'cup_lid.png';
        else if (this.game.textures.exists('cup-lid.png')) lidKey = 'cup-lid.png';

        const settings = this.game.SETTINGS || {};
        const animCfg = settings.lid_animation || {};

        const offsetX = animCfg.offset_x !== undefined ? animCfg.offset_x : 40;
        const offsetY = animCfg.offset_y !== undefined ? animCfg.offset_y : 70;
        const initialAngleRad = ((animCfg.initial_angle_deg !== undefined ? animCfg.initial_angle_deg : 20) * Math.PI) / 180;

        const p1Duration = animCfg.phase1_duration_ms !== undefined ? animCfg.phase1_duration_ms : 200;
        const p1Overshoot = animCfg.phase1_overshoot_scale !== undefined ? animCfg.phase1_overshoot_scale : 1.15;

        const p2Duration = animCfg.phase2_duration_ms !== undefined ? animCfg.phase2_duration_ms : 120;
        const p2ScaleX = animCfg.phase2_scale_x !== undefined ? animCfg.phase2_scale_x : 1.10;
        const p2ScaleY = animCfg.phase2_scale_y !== undefined ? animCfg.phase2_scale_y : 0.85;

        const p3Duration = animCfg.phase3_duration_ms !== undefined ? animCfg.phase3_duration_ms : 280;
        const p3ScaleX = animCfg.phase3_scale_x !== undefined ? animCfg.phase3_scale_x : 0.85;
        const p3ScaleY = animCfg.phase3_scale_y !== undefined ? animCfg.phase3_scale_y : 1.25;
        const p3ArcHeight = animCfg.phase3_arc_height !== undefined ? animCfg.phase3_arc_height : 30;

        const p4ScaleX = animCfg.phase4_scale_x !== undefined ? animCfg.phase4_scale_x : 1.25;
        const p4ScaleY = animCfg.phase4_scale_y !== undefined ? animCfg.phase4_scale_y : 0.70;
        const p4ImpactShiftY = animCfg.phase4_impact_shift_y !== undefined ? animCfg.phase4_impact_shift_y : 3.5;

        const p5Duration = animCfg.phase5_duration_ms !== undefined ? animCfg.phase5_duration_ms : 350;

        const baseScale = this.potScale;

        // Create lid sprite inside pot container
        const cupLid = this.game.add.image(0, 0, lidKey);
        cupLid.setOrigin(0.5, 0.5);

        // Apply saturated color tint matching cup_front & cup_back
        const gridConfig = settings.cup_grid || settings.pot_grid || {};
        const getSaturatedColor = (hexColor) => {
            const satMult = gridConfig.color_saturation !== undefined ? gridConfig.color_saturation : (settings.cup_color_saturation !== undefined ? settings.cup_color_saturation : 1.30);
            const lightMult = gridConfig.color_lightness !== undefined ? gridConfig.color_lightness : (settings.cup_color_lightness !== undefined ? settings.cup_color_lightness : 1.05);

            if (satMult === 1.0 && lightMult === 1.0) return hexColor;

            let r = ((hexColor >> 16) & 0xFF) / 255.0;
            let g = ((hexColor >> 8) & 0xFF) / 255.0;
            let b = (hexColor & 0xFF) / 255.0;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h = 0, s = 0, l = (max + min) / 2.0;

            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2.0 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                }
                h /= 6.0;
            }
            s = Math.max(0.0, Math.min(1.0, s * satMult));
            l = Math.max(0.0, Math.min(1.0, l * lightMult));

            let outR, outG, outB;
            if (s === 0) {
                outR = outG = outB = l;
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1 / 6) return p + (q - p) * 6 * t;
                    if (t < 1 / 2) return q;
                    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
                const p = 2.0 * l - q;
                outR = hue2rgb(p, q, h + 1 / 3);
                outG = hue2rgb(p, q, h);
                outB = hue2rgb(p, q, h - 1 / 3);
            }
            const ir = Math.min(255, Math.max(0, Math.round(outR * 255)));
            const ig = Math.min(255, Math.max(0, Math.round(outG * 255)));
            const ib = Math.min(255, Math.max(0, Math.round(outB * 255)));
            return (ir << 16) | (ig << 8) | ib;
        };

        cupLid.setTint(potComp.color);
        potCont.add(cupLid);
        potComp.cupLid = cupLid;

        // --- Phase 1: Pop-in ---
        // Offset relative to cup center: x + offset_x, y - offset_y
        // Tilted by initial_angle_deg (20 deg). Scale 0 -> 1.15 -> 1.0
        cupLid.setPosition(offsetX, -offsetY);
        cupLid.setRotation(initialAngleRad);
        cupLid.setScale(0, 0);
        cupLid.setAlpha(0);

        this.game.tweens.add({
            targets: cupLid,
            scaleX: baseScale * p1Overshoot,
            scaleY: baseScale * p1Overshoot,
            alpha: 1,
            duration: p1Duration * 0.75,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.game.tweens.add({
                    targets: cupLid,
                    scaleX: baseScale,
                    scaleY: baseScale,
                    duration: p1Duration * 0.25,
                    ease: 'Quad.easeOut',
                    onComplete: () => {
                        // --- Phase 2: Anticipation ---
                        // Slight squash: Scale X = 1.1, Scale Y = 0.85
                        this.game.tweens.add({
                            targets: cupLid,
                            scaleX: baseScale * p2ScaleX,
                            scaleY: baseScale * p2ScaleY,
                            duration: p2Duration,
                            ease: 'Quad.easeInOut',
                            onComplete: () => {
                                // --- Phase 3: Jump & Stretch ---
                                // Arc movement toward final coordinates above cup
                                // Mid-air stretch: Scale X = 0.85, Scale Y = 1.25. Rotation 20 deg -> 0 deg
                                this.game.tweens.add({
                                    targets: cupLid,
                                    scaleX: baseScale * p3ScaleX,
                                    scaleY: baseScale * p3ScaleY,
                                    duration: p3Duration * 0.4,
                                    ease: 'Quad.easeOut'
                                });

                                const progressObj = { t: 0 };
                                const startX = offsetX;
                                const startY = -offsetY;

                                this.game.tweens.add({
                                    targets: progressObj,
                                    t: 1,
                                    duration: p3Duration,
                                    ease: 'Sine.easeInOut',
                                    onUpdate: () => {
                                        const t = progressObj.t;
                                        const curX = startX * (1 - t);
                                        const curY = startY * (1 - t) - Math.sin(t * Math.PI) * p3ArcHeight;
                                        const curAngle = initialAngleRad * (1 - t);

                                        cupLid.setPosition(curX, curY);
                                        cupLid.setRotation(curAngle);
                                    },
                                    onComplete: () => {
                                        // --- Phase 4: Impact & Squash ---
                                        // Lid locks into (0, 0). Sharp flattening: Scale X = 1.25, Scale Y = 0.70
                                        // Cup sprites shift down by p4ImpactShiftY at impact inertia moment
                                        cupLid.setPosition(0, 0);
                                        cupLid.setRotation(0);
                                        cupLid.setScale(baseScale * p4ScaleX, baseScale * (p4ScaleY * 1.3));

                                        const shiftElements = [];
                                        if (potComp.cupFront) shiftElements.push(potComp.cupFront);
                                        if (potComp.cupBack) shiftElements.push(potComp.cupBack);
                                        if (potComp.particlesContainer) shiftElements.push(potComp.particlesContainer);

                                        shiftElements.forEach(el => { el.y = p4ImpactShiftY; });
                                        cupLid.y = p4ImpactShiftY * 0.5;

                                        this.playPopSound();

                                        // --- Phase 5: Settle ---
                                        // Elastic return to original proportions and Y position
                                        this.game.tweens.add({
                                            targets: cupLid,
                                            scaleX: baseScale,
                                            scaleY: baseScale,
                                            y: 0,
                                            duration: p5Duration,
                                            ease: 'Back.easeOut'
                                        });

                                        this.game.tweens.add({
                                            targets: shiftElements,
                                            y: 0,
                                            duration: p5Duration,
                                            ease: 'Back.easeOut',
                                            onComplete: () => {
                                                // After lid closes, cup disappears and column moves up
                                                this.shiftColumn(world, col);
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    }

    update(world, time, delta) {
        if (!this.initialized) {
            const sandEntities = world.getEntitiesWith([SandGridComponent]);
            if (sandEntities.length > 0) {
                this.initGrid(world);
            }
        } else {
            const settings = this.game.SETTINGS || {};
            const gridConfig = settings.cup_grid || settings.pot_grid || {};

            // Check for filled pots in top row and guarantee all resting in-grid cups are fully opaque
            for (let c = 0; c < this.cols; c++) {
                for (let r = 0; r < this.rows; r++) {
                    const item = this.columns[c][r];
                    if (item && item.comp && item.comp.container) {
                        if (item.comp.state === 'in_grid') {
                            const isTweening = (typeof this.game.tweens.isTweening === 'function')
                                ? this.game.tweens.isTweening(item.comp.container)
                                : (this.game.tweens.getTweensOf(item.comp.container).length > 0);
                            if (!isTweening && item.comp.container.alpha < 1) {
                                item.comp.container.setAlpha(1);
                            }
                        }
                    }
                }

                const item = this.columns[c][0];
                if (item && item.comp) {
                    const volumeMult = gridConfig.cup_volume_multiplier !== undefined
                        ? gridConfig.cup_volume_multiplier
                        : (settings.cup_volume_multiplier !== undefined ? settings.cup_volume_multiplier : 4);
                    const targetVol = Math.max(0, item.comp.capacity * volumeMult);

                    if (item.comp.currentDisplayVol === undefined) {
                        item.comp.currentDisplayVol = targetVol;
                    }

                    // Smooth counter interpolation: steadily step down unit by unit without skipping 4 units at once
                    if (item.comp.currentDisplayVol > targetVol) {
                        const diff = item.comp.currentDisplayVol - targetVol;
                        const decrementRate = Math.max(36, diff * 18);
                        const dtSec = (delta || 16) * 0.001;
                        item.comp.currentDisplayVol = Math.max(targetVol, item.comp.currentDisplayVol - decrementRate * dtSec);
                    } else if (item.comp.currentDisplayVol < targetVol) {
                        item.comp.currentDisplayVol = targetVol;
                    }

                    const displayVal = Math.round(item.comp.currentDisplayVol);

                    // Update text if visible
                    if (item.comp.capacityText && item.comp.capacityText.visible) {
                        item.comp.capacityText.setText(displayVal.toString());
                    }

                    if (item.comp.capacity <= 0 && displayVal <= 0 && item.comp.state === 'in_grid') {
                        item.comp.state = 'closing_lid';
                        this.playLidAnimationAndShift(world, c, item);
                    }
                }
            }

            // Win Condition Check:
            // All target cups on the level reach 100% capacity:
            // potQueue is empty, and no remaining cups in the grid need filling or are closing lid
            if (!this.game.gameOver && this.potQueue.length === 0) {
                let allCupsFinished = true;
                for (let c = 0; c < this.cols; c++) {
                    for (let r = 0; r < this.rows; r++) {
                        const item = this.columns[c][r];
                        if (item && item.comp) {
                            if (item.comp.capacity > 0 || item.comp.state === 'closing_lid' || item.comp.state === 'shifting') {
                                allCupsFinished = false;
                                break;
                            }
                        }
                    }
                    if (!allCupsFinished) break;
                }

                if (allCupsFinished) {
                    this.game.showWin();
                }
            }
        }
    }
}
