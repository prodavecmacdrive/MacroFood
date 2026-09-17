import { System } from '../ECS';
import { ConveyorComponent } from '../components/ConveyorComponent';
import { PotComponent } from '../components/PotComponent';
import { STATE_RESTING, STATE_ACTIVE, STATE_FREE_FALL, SandGridComponent } from '../components/SandGridComponent';

export class ConveyorSystem extends System {
    constructor(game) {
        super(game);
        this.toCupSoundKeys = [
            'to_cup_1', 'to_cup_2', 'to_cup_3', 'to_cup_4', 'to_cup_5',
            'to_cup_6', 'to_cup_7', 'to_cup_8', 'to_cup_9', 'to_cup_10'
        ];
        this.lastToCupSoundTime = 0;
        this.activeSpoutDrops = [];
        this.activeCupTransfers = [];
        this.pendingSpoutQueue = [];
    }

    renderConveyorParticles(conveyor) {
        if (!conveyor || !conveyor.batchGraphics) return;

        const g = conveyor.batchGraphics;
        g.clear();

        const beltParticles = conveyor.beltParticles;
        if (!beltParticles || beltParticles.length === 0) return;

        const pInfo = this.game && this.game.getParticleSize ? this.game.getParticleSize() : null;
        const pSize = pInfo ? pInfo.logicalSize : 5.0;
        const targetConveyorScale = (this.game.SETTINGS && this.game.SETTINGS.conveyor_particle_scale !== undefined)
            ? this.game.SETTINGS.conveyor_particle_scale
            : 1.6;

        const effectiveSize = pSize * targetConveyorScale;
        const effectiveHalf = effectiveSize * 0.5;
        // Draw activeSpoutDrops
        if (this.activeSpoutDrops && this.activeSpoutDrops.length > 0) {
            for (let i = 0; i < this.activeSpoutDrops.length; i++) {
                const drop = this.activeSpoutDrops[i];
                if (drop.curX !== undefined && drop.curY !== undefined) {
                    const r = (drop.colorHex >> 16) & 0xFF;
                    const gCol = (drop.colorHex >> 8) & 0xFF;
                    const b = drop.colorHex & 0xFF;
                    const darkColor = ((r >> 1) << 16) | ((gCol >> 1) << 8) | (b >> 1);

                    const pScale = drop.curScale || 1.6;
                    const size = pSize * pScale;
                    const half = size * 0.5;

                    g.fillStyle(darkColor, 1);
                    g.fillRect(drop.curX - half, drop.curY, size, half);
                    g.fillStyle(drop.colorHex, 1);
                    g.fillRect(drop.curX - half, drop.curY - half, size, half);
                }
            }
        }

        // Draw activeCupTransfers
        if (this.activeCupTransfers && this.activeCupTransfers.length > 0) {
            for (let i = 0; i < this.activeCupTransfers.length; i++) {
                const tr = this.activeCupTransfers[i];
                if (tr.curX !== undefined && tr.curY !== undefined) {
                    const dropColor = tr.colorHex;
                    const r = (dropColor >> 16) & 0xFF;
                    const gCol = (dropColor >> 8) & 0xFF;
                    const b = dropColor & 0xFF;
                    const darkColor = ((r >> 1) << 16) | ((gCol >> 1) << 8) | (b >> 1);

                    const pScale = tr.currentScale || 1.6;
                    const size = pSize * pScale;
                    const half = size * 0.5;
                    let cx = tr.curX;
                    let cy = tr.curY;
                    const angle = tr.currentRotation || 0;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);

                    // Top rectangle (-half, -half, size, half) centered relative to (cx, cy)
                    const topLocalX = 0;
                    const topLocalY = -half / 2;
                    const topX = cx + (topLocalX * cos - topLocalY * sin);
                    const topY = cy + (topLocalX * sin + topLocalY * cos);

                    // Bottom rectangle (-half, 0, size, half) centered relative to (cx, cy)
                    const botLocalX = 0;
                    const botLocalY = half / 2;
                    const botX = cx + (botLocalX * cos - botLocalY * sin);
                    const botY = cy + (botLocalX * sin + botLocalY * cos);

                    g.fillStyle(darkColor, 1);
                    g.fillRect(botX - half, botY - half / 2, size, half);
                    g.fillStyle(dropColor, 1);
                    g.fillRect(topX - half, topY - half / 2, size, half);


                }
            }
        }

        // Segment batching for top belt
        let currentSegment = null;
        for (let i = 0; i < beltParticles.length; i++) {
            const bp = beltParticles[i];
            const colorHex = bp.colorHex !== undefined ? bp.colorHex : bp.color;
            const r = (colorHex >> 16) & 0xFF;
            const gCol = (colorHex >> 8) & 0xFF;
            const b = colorHex & 0xFF;
            const darkColor = ((r >> 1) << 16) | ((gCol >> 1) << 8) | (b >> 1);

            if (bp.state === 'top') {
                if (currentSegment && currentSegment.colorHex === colorHex && Math.abs(bp.y - currentSegment.y) < 2 && Math.abs(currentSegment.right - bp.x) <= effectiveSize * 1.5) {
                    currentSegment.right = bp.x;
                    currentSegment.width = currentSegment.right - currentSegment.x + effectiveSize;
                } else {
                    if (currentSegment) {
                        g.fillStyle(currentSegment.darkColor, 1);
                        g.fillRect(currentSegment.x - effectiveHalf, currentSegment.y, currentSegment.width, effectiveHalf);
                        g.fillStyle(currentSegment.colorHex, 1);
                        g.fillRect(currentSegment.x - effectiveHalf, currentSegment.y - effectiveHalf, currentSegment.width, effectiveHalf);
                    }
                    currentSegment = {
                        colorHex: colorHex,
                        darkColor: darkColor,
                        x: bp.x,
                        y: bp.y,
                        right: bp.x,
                        width: effectiveSize
                    };
                }
            } else {
                g.fillStyle(darkColor, 1);
                g.fillRect(bp.x - effectiveHalf, bp.y, effectiveSize, effectiveHalf);
                g.fillStyle(colorHex, 1);
                g.fillRect(bp.x - effectiveHalf, bp.y - effectiveHalf, effectiveSize, effectiveHalf);
            }
        }
        if (currentSegment) {
            g.fillStyle(currentSegment.darkColor, 1);
            g.fillRect(currentSegment.x - effectiveHalf, currentSegment.y, currentSegment.width, effectiveHalf);
            g.fillStyle(currentSegment.colorHex, 1);
            g.fillRect(currentSegment.x - effectiveHalf, currentSegment.y - effectiveHalf, currentSegment.width, effectiveHalf);
        }
}

    playToCupSound(baseVolume = 0.55) {
        const settings = (this.game && this.game.SETTINGS) || {};
        const maxPerSec = settings.to_cup_sound_max_per_sec !== undefined
            ? settings.to_cup_sound_max_per_sec
            : (settings.to_cup_transfer_max_per_sec !== undefined ? settings.to_cup_transfer_max_per_sec : 16);

        if (maxPerSec <= 0) return;

        const now = (this.game?.time?.now) || performance.now();
        if (!this.toCupPlayTimes) this.toCupPlayTimes = [];

        // 1. Sliding window rate limit check (1000ms window)
        while (this.toCupPlayTimes.length > 0 && now - this.toCupPlayTimes[0] >= 1000) {
            this.toCupPlayTimes.shift();
        }

        if (this.toCupPlayTimes.length >= maxPerSec) {
            return; // Strict rate limit per second reached
        }

        // 2. Minimum interval check to avoid sub-frame audio clipping
        const minIntervalMs = 1000 / maxPerSec;
        if (now - this.lastToCupSoundTime < minIntervalMs) {
            return;
        }

        this.toCupPlayTimes.push(now);
        this.lastToCupSoundTime = now;

        const jitter = (Math.random() * 0.16 - 0.09);
        const volume = Math.max(0.1, Math.min(1.0, baseVolume * (1.0 + jitter)));

        const randIndex = Math.floor(Math.random() * this.toCupSoundKeys.length);
        const soundKey = this.toCupSoundKeys[randIndex];

        try {
            if (typeof window !== 'undefined' && window.App && window.App.resources && window.App.resources.audio && window.App.resources.audio.json) {
                const spritemap = window.App.resources.audio.json.spritemap || {};
                if (spritemap[soundKey]) {
                    const sound = this.game.sound.addAudioSprite('sfx');
                    if (sound) {
                        sound.play(soundKey, { volume });
                    }
                    return;
                }
            }
            if (this.game && this.game.sound) {
                this.game.sound.play(soundKey, { volume });
            }
        } catch (e) {
            // Audio error safety
        }
    }

    initConveyorView(conveyorComp) {
        const game = this.game;
        const parentContainer = game.mainContainer;

        const conveyorContainer = game.add.container(conveyorComp.x, conveyorComp.y);
        conveyorComp.container = conveyorContainer;
        parentContainer.add(conveyorContainer);
        conveyorContainer.setDepth(10);

        const conveyorScale = conveyorComp.scale || (this.game.SETTINGS && this.game.SETTINGS.conveyor_scale) || 0.48;

        const shadowOffsetY = (this.game.SETTINGS && this.game.SETTINGS.conveyor_shadow_offset_y !== undefined)
            ? this.game.SETTINGS.conveyor_shadow_offset_y
            : 18;
        const shadowAlpha = (this.game.SETTINGS && this.game.SETTINGS.conveyor_shadow_alpha !== undefined)
            ? this.game.SETTINGS.conveyor_shadow_alpha
            : 0.3;

        // Create blurred gray cloned texture if possible
        const shadowTexKey = 'conveyor_shadow_blurred';
        let useBlurredTex = false;
        try {
            if (!game.textures.exists(shadowTexKey)) {
                const src = game.textures.get('conveyor')?.getSourceImage();
                if (src && src.width && src.height) {
                    const blurRadius = 12;
                    const canvasTex = game.textures.createCanvas(shadowTexKey, src.width + blurRadius * 4, src.height + blurRadius * 4);
                    const ctx = canvasTex.getContext();
                    ctx.filter = `blur(${blurRadius}px) grayscale(100%) brightness(30%)`;
                    ctx.drawImage(src, blurRadius * 2, blurRadius * 2);
                    canvasTex.refresh();
                    useBlurredTex = true;
                }
            } else {
                useBlurredTex = true;
            }
        } catch (e) {
            console.warn('[ConveyorSystem] Canvas blur error:', e);
        }

        if (useBlurredTex && game.textures.exists(shadowTexKey)) {
            const shadowSprite = game.add.image(0, shadowOffsetY, shadowTexKey);
            shadowSprite.setOrigin(0.5, 0.5);
            shadowSprite.setScale(conveyorScale);
            shadowSprite.setAlpha(shadowAlpha);
            shadowSprite.setDepth(-1);
            conveyorContainer.add(shadowSprite);
            conveyorComp.shadowSprite = shadowSprite;
        } else {
            // Multi-sample blur clone fallback
            const shadowGroup = game.add.container(0, shadowOffsetY);
            shadowGroup.setDepth(-1);
            conveyorContainer.add(shadowGroup);

            const blurSamples = [
                { dx: 0, dy: 0, a: shadowAlpha * 0.4 },
                { dx: -3, dy: 0, a: shadowAlpha * 0.15 },
                { dx: 3, dy: 0, a: shadowAlpha * 0.15 },
                { dx: 0, dy: -3, a: shadowAlpha * 0.15 },
                { dx: 0, dy: 3, a: shadowAlpha * 0.15 }
            ];
            for (const s of blurSamples) {
                const img = game.add.image(s.dx, s.dy, 'conveyor');
                img.setOrigin(0.5, 0.5);
                img.setScale(1.0);
                img.setTint(0x333333);
                img.setAlpha(s.a);
                shadowGroup.add(img);
            }
            shadowGroup.setScale(conveyorScale);
            conveyorComp.shadowSprite = shadowGroup;
        }

        // Single oval conveyor image
        const conveyorSprite = game.add.image(0, 0, 'conveyor');
        conveyorSprite.setOrigin(0.5, 0.5);
        conveyorSprite.setScale(conveyorScale);
        conveyorSprite.setDepth(0);
        conveyorContainer.add(conveyorSprite);
        conveyorComp.conveyorSprite = conveyorSprite;

        // Container for particles on the belt
        const particlesContainer = game.add.container(0, 0);
        particlesContainer.setDepth(1);
        conveyorContainer.add(particlesContainer);
        conveyorComp.particlesContainer = particlesContainer;

        const batchGraphics = game.add.graphics();
        batchGraphics.setDepth(2);
        particlesContainer.add(batchGraphics);
        conveyorComp.batchGraphics = batchGraphics;

        // Central text UI for Load Percentage
        const loadText = game.add.text(0, 0, '0%', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '20px',
            fontStyle: 'bold',
            fill: '#1a1a1a',
            stroke: '#ffffff',
            strokeThickness: 4
        });
        loadText.setOrigin(0.5, 0.5);
        loadText.setDepth(2);
        conveyorContainer.add(loadText);
        conveyorComp.loadText = loadText;

        // Exact Track Geometry based on conveyor.png (980 x 267):
        // Blue track centerline is at Y = -70 (top) and Y = +70 (bottom)
        // Curved ends have radius 70, centered at X = -360 and X = +360
        const trackCenterOffsetY = 70;
        const straightSpan = 360;

        conveyorComp.arcRadius = trackCenterOffsetY * conveyorScale; // 35px at scale 0.50 (smaller radius, dead center on track!)
        conveyorComp.pathTopY = -trackCenterOffsetY * conveyorScale; // -35px (dead center of top belt!)
        conveyorComp.pathBottomY = trackCenterOffsetY * conveyorScale; // +35px (dead center of bottom belt!)
        conveyorComp.pathLeftX = -straightSpan * conveyorScale; // -180px
        conveyorComp.pathRightX = straightSpan * conveyorScale; // +180px

        this.conveyorComp = conveyorComp;
    }

    updateScaleAndPosition(x, y, scale) {
        const conveyor = this.conveyorComp;
        if (!conveyor) return;

        conveyor.x = x;
        conveyor.y = y;
        conveyor.scale = scale;

        if (conveyor.container) {
            conveyor.container.setPosition(x, y);
        }
        if (conveyor.conveyorSprite) {
            conveyor.conveyorSprite.setScale(scale);
        }
        if (conveyor.shadowSprite) {
            conveyor.shadowSprite.setScale(scale);
            const shadowOffsetY = this.game.SETTINGS && this.game.SETTINGS.conveyor_shadow_offset_y !== undefined
                ? this.game.SETTINGS.conveyor_shadow_offset_y
                : 18;
            conveyor.shadowSprite.y = shadowOffsetY * (scale / 0.50);
        }
        if (conveyor.loadText) {
            conveyor.loadText.setScale(Math.max(0.6, scale / 0.50));
        }
        if (conveyor.warningText) {
            const settings = this.game.SETTINGS || {};
            const imgX = settings.image_logical_x !== undefined ? settings.image_logical_x : 300;
            const imgY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
            const imgScale = settings.image_scale !== undefined ? settings.image_scale : 0.72;
            conveyor.warningText.setPosition(imgX, imgY + 200 * imgScale);
            conveyor.warningText.setScale(Math.max(0.5, imgScale / 0.72));
        }

        const trackCenterOffsetY = 70;
        const straightSpan = 360;
        conveyor.arcRadius = trackCenterOffsetY * scale;
        conveyor.pathTopY = -trackCenterOffsetY * scale;
        conveyor.pathBottomY = trackCenterOffsetY * scale;
        conveyor.pathLeftX = -straightSpan * scale;
        conveyor.pathRightX = straightSpan * scale;
    }

    addParticleToConveyor(conveyor, localX, colorInt, colorHex) {
        // Here localX is already relative to conveyor.x
        const cx = Math.max(conveyor.pathLeftX + 5, Math.min(conveyor.pathRightX - 5, localX));

        const pInfo = this.game && this.game.getParticleSize ? this.game.getParticleSize() : null;
        const pSize = pInfo ? pInfo.logicalSize : 5.0;
        const halfSize = pSize * 0.5;
        const sizeRatio = pSize / 5.0;

        // Check existing particles on the top track near cx (within a pile radius scaled by particle size)
        const pileRadius = 14 * sizeRatio;
        const nearby = [];
        for (let j = 0; j < conveyor.beltParticles.length; j++) {
            const other = conveyor.beltParticles[j];
            if (other.state === 'top' && Math.abs(other.x - cx) <= pileRadius) {
                nearby.push(other);
            }
        }

        // Determine pile placement based on local pile density:
        // A pile has up to 3 vertical layers across the blue track groove:
        let trackOffset = 0;
        let placedX = cx;
        const pileCount = nearby.length;

        if (pileCount === 0) {
            // Solitary grain / start of pile: scatter across full vertical depth of track channel (-12 to +12)
            trackOffset = (Math.random() * 24 - 12) * sizeRatio;
            placedX = cx + (Math.random() * 16 - 8) * sizeRatio;
        } else if (pileCount === 1) {
            const dir = (cx >= nearby[0].x) ? 1 : -1;
            placedX = nearby[0].x + dir * ((4 + Math.random() * 5) * sizeRatio);
            trackOffset = (Math.random() * 24 - 12) * sizeRatio;
        } else if (pileCount === 2) {
            const avgX = (nearby[0].x + nearby[1].x) / 2;
            placedX = avgX + ((Math.random() * 8 - 4) * sizeRatio);
            trackOffset = (Math.random() * 24 - 12) * sizeRatio;
        } else if (pileCount === 3) {
            const side = Math.random() > 0.5 ? 1 : -1;
            placedX = cx + side * ((3 + Math.random() * 5) * sizeRatio);
            trackOffset = (Math.random() * 24 - 12) * sizeRatio;
        } else if (pileCount === 4) {
            let sumX = 0;
            for (const n of nearby) sumX += n.x;
            const peakX = sumX / nearby.length;
            placedX = peakX + ((Math.random() * 6 - 3) * sizeRatio);
            trackOffset = (Math.random() * 24 - 12) * sizeRatio;
        } else {
            const side = (Math.random() > 0.5 ? 1 : -1);
            placedX = cx + side * ((5 + Math.random() * 10) * sizeRatio);
            trackOffset = (Math.random() * 26 - 13) * sizeRatio;
        }

        // Clamp placedX to track limits
        placedX = Math.max(conveyor.pathLeftX, Math.min(conveyor.pathRightX, placedX));

        const angleJitter = (Math.random() - 0.5) * 0.7; // Organic grain rotation angle
        const speedMult = 0.90 + Math.random() * 0.20; // Organic speed variation [0.90..1.10] to naturally close gaps

        const cy = conveyor.pathTopY + trackOffset;
        conveyor.stallTimer = 0;

        conveyor.beltParticles.push({
            color: colorInt,
            colorHex: colorHex,
            x: placedX,
            y: cy,
            trackOffset: trackOffset,
            angleJitter: angleJitter,
            speedMult: speedMult,
            state: 'top'
        });
    }

    findMatchingPot(pots, particleColor) {
        if (!pots || pots.length === 0) return null;

        // Exact color match: cups only take on their specific color without any color range
        for (let i = 0; i < pots.length; i++) {
            const pot = pots[i];
            if (pot.capacity > 0) {
                if (pot.color === particleColor || (pot.acceptedColors && pot.acceptedColors.has(particleColor))) {
                    return pot;
                }
            }
        }

        return null;
    }

    fastTrackParticles(world, conveyor, maxBatch = Infinity) {
        const potEntities = world.getEntitiesWith([PotComponent]);
        const pots = [];
        for (let pIdx = 0; pIdx < potEntities.length; pIdx++) {
            const pot = potEntities[pIdx].getComponent(PotComponent);
            if (pot && pot.state === 'in_grid' && pot.gridRow === 0 && pot.capacity > 0) {
                pots.push(pot);
            }
        }
        if (pots.length === 0) return;

        let processed = 0;
        for (let i = conveyor.beltParticles.length - 1; i >= 0; i--) {
            if (processed >= maxBatch) break;

            const bp = conveyor.beltParticles[i];
            const matchingPot = this.findMatchingPot(pots, bp.color);

            if (matchingPot) {
                conveyor.stallTimer = 0;
                matchingPot.capacity--;
                this.playToCupSound(0.55);

                // Teleport to the exact drop position above the matching cup on the bottom track
                const dropJitterX = (Math.random() * 20 - 10);
                const pWorldX = matchingPot.x + dropJitterX;
                const pWorldY = conveyor.y + conveyor.pathBottomY;

                conveyor.beltParticles.splice(i, 1);

                this.executeDropAnimation(bp, matchingPot, pWorldX, pWorldY);
                processed++;
            }
        }
    }

    executeDropAnimation(bp, pot, pWorldX, pWorldY) {
        const dropColor = bp.colorHex !== undefined ? bp.colorHex : bp.color;
        const r = (dropColor >> 16) & 0xFF;
        const g = (dropColor >> 8) & 0xFF;
        const b = dropColor & 0xFF;
        const darkColor = ((r >> 1) << 16) | ((g >> 1) << 8) | (b >> 1);

        if (pot.initialCapacity === undefined) {
            pot.initialCapacity = pot.capacity + 1;
        }
        if (pot.collectedCount === undefined) {
            pot.collectedCount = 0;
        }
        const fillIndex = pot.collectedCount;
        pot.collectedCount++;
        if (this.game) {
            this.game.totalParticlesCollected = (this.game.totalParticlesCollected || 0) + 1;
            if (this.game.totalTargetParticles > 0 && typeof this.game.checkChallengeProgress === 'function') {
                const progress = this.game.totalParticlesCollected / this.game.totalTargetParticles;
                this.game.checkChallengeProgress(progress);
            }
        }

        const targetContainer = (pot.particlesContainer && pot.particlesContainer.active)
            ? pot.particlesContainer
            : ((pot.container && pot.container.active) ? pot.container : this.game.mainContainer);

        const maxFill = Math.max(1, pot.initialCapacity || 20);
        const fillRatio = Math.min(1.0, fillIndex / maxFill);

        const settings = this.game.SETTINGS || {};
        const cupGridCfg = settings.cup_grid || settings.pot_grid || {};
        const heapStartY = cupGridCfg.heap_start_y_offset !== undefined
            ? cupGridCfg.heap_start_y_offset
            : (settings.heap_start_y_offset !== undefined ? settings.heap_start_y_offset : -5);

        const maxHeapHeight = cupGridCfg.heap_height !== undefined
            ? cupGridCfg.heap_height
            : (settings.heap_height !== undefined ? settings.heap_height : 38.0);

        const vertDensityExp = cupGridCfg.heap_vertical_density !== undefined
            ? cupGridCfg.heap_vertical_density
            : (settings.heap_vertical_density !== undefined ? settings.heap_vertical_density : 0.75);

        const bottomWidth = cupGridCfg.heap_bottom_width !== undefined
            ? cupGridCfg.heap_bottom_width
            : (settings.heap_bottom_width !== undefined ? settings.heap_bottom_width : 62.0);

        const halfWidth = bottomWidth * 0.5;
        const rawX = (Math.random() - 0.5) * bottomWidth;
        const clampedTargetX = Math.max(-halfWidth, Math.min(halfWidth, rawX));
        const verticalCompression = Math.pow(fillRatio, Math.max(0.5, vertDensityExp * 1.5));
        const moundHeight = maxHeapHeight * verticalCompression;

        const pInfo = this.game && this.game.getParticleSize ? this.game.getParticleSize() : null;
        const pSize = pInfo ? pInfo.logicalSize : 5.0;
        const halfSize = pSize * 0.5;
        const sizeRatio = pSize / 5.0;

        const jitterAmount = (0.5 + Math.pow(fillRatio, 1.2) * 10.0) * sizeRatio;
        const randomJitterY = (Math.random() - 0.5) * jitterAmount;

        const targetY = heapStartY - moundHeight + randomJitterY;
        const clampedTargetY = Math.max(heapStartY - maxHeapHeight - 12.0, Math.min(heapStartY + 6.0, targetY));

        const randomAngle = (Math.random() - 0.5) * (Math.PI * 0.5);

        // We now render everything inside conveyor.batchGraphics (local space)
        const potWorldX = pot.x;
        const localStartX = pWorldX - this.conveyorComp.x;
        const localStartY = pWorldY - this.conveyorComp.y;
        const localTargetX = (potWorldX + clampedTargetX) - this.conveyorComp.x;
        const localTargetY = (pot.y + clampedTargetY) - this.conveyorComp.y;

        const targetConveyorScale = (this.game.SETTINGS && this.game.SETTINGS.conveyor_particle_scale !== undefined)
            ? this.game.SETTINGS.conveyor_particle_scale
            : 1.6;

        const cupScaleMult = (this.game.SETTINGS && this.game.SETTINGS.cup_particle_scale_multiplier !== undefined)
            ? this.game.SETTINGS.cup_particle_scale_multiplier
            : 3.0;

        const startScale = targetConveyorScale;
        const finalCupScale = targetConveyorScale * cupScaleMult;
        const peakScale = finalCupScale * 1.15;

        const travelDuration = Math.max(250, 400 - (fillRatio * 150));
        const p0x = localStartX;
        const p0y = localStartY;
        const arcPeakHeight = 60 * sizeRatio;
        const p2x = localTargetX;
        const p2y = localTargetY;
        const p1x = (p0x + p2x) / 2;
        const p1y = Math.min(p0y, p2y) - arcPeakHeight;

        this.activeCupTransfers.push({
            colorHex: dropColor,
            targetContainer,
            p0x, p0y,
            p1x, p1y,
            p2x, p2y,
            randomAngle,
            startScale,
            peakScale,
            finalCupScale,
            durationSec: travelDuration / 1000,
            elapsedSec: 0
        });
    }

    update(world, time, delta) {
        if (!this.conveyorComponent) {
            const entities = world.getEntitiesWith([ConveyorComponent]);
            if (entities.length === 0) return;
            this.conveyorEntity = entities[0];
            this.conveyorComponent = this.conveyorEntity.getComponent(ConveyorComponent);
        }
        const conveyorEntity = this.conveyorEntity;
        const conveyor = this.conveyorComponent;

        if (!conveyor.container) {
            this.initConveyorView(conveyor);
        }

        const settings = this.game.SETTINGS || {};
        const dt = delta / 1000;

        // Process pooled spout drops in-flight to conveyor belt
        if (this.activeSpoutDrops && this.activeSpoutDrops.length > 0) {
            for (let i = this.activeSpoutDrops.length - 1; i >= 0; i--) {
                const drop = this.activeSpoutDrops[i];
                if (drop.delaySec && drop.delaySec > 0) {
                    drop.delaySec -= dt;
                    if (drop.delaySec > 0) {
                        continue; // Waiting for staggered play delay within batch
                    }
                    }
                drop.elapsedSec += dt;
                const progress = Math.min(1.0, drop.elapsedSec / drop.durationSec);
                const easeT = progress * progress; // Quad easeIn

                const curX = drop.startX + (drop.targetX - drop.startX) * easeT;
                const curY = drop.startY + (drop.targetY - drop.startY) * easeT;
                const curScale = 1.0 + (drop.targetScale - 1.0) * easeT;

                drop.curX = curX;
                drop.curY = curY;
                drop.curScale = curScale;

                if (progress >= 1.0) {

                    if (conveyor.beltParticles) {
                        this.addParticleToConveyor(conveyor, drop.targetX, drop.colorInt, drop.colorHex);
                    }
                    this.activeSpoutDrops.splice(i, 1);
                }
            }
        }

        // Process cup transfer drops in-flight to cup mounds
        if (this.activeCupTransfers && this.activeCupTransfers.length > 0) {
            for (let i = this.activeCupTransfers.length - 1; i >= 0; i--) {
                const tr = this.activeCupTransfers[i];
                tr.elapsedSec += dt;
                const t = Math.min(1.0, tr.elapsedSec / tr.durationSec);

                // Quad easeInOut flight trajectory
                const easeT = t < 0.5 ? 2.0 * t * t : 1.0 - Math.pow(-2.0 * t + 2.0, 2.0) / 2.0;
                const eOmt = 1.0 - easeT;

                const curX = eOmt * eOmt * tr.p0x + 2.0 * eOmt * easeT * tr.p1x + easeT * easeT * tr.p2x;
                const curY = eOmt * eOmt * tr.p0y + 2.0 * eOmt * easeT * tr.p1y + easeT * easeT * tr.p2y;

                let currentScale;
                if (easeT <= 0.6) {
                    const subT = easeT / 0.6;
                    currentScale = tr.startScale + (tr.peakScale - tr.startScale) * Math.sin(subT * Math.PI * 0.5);
                } else {
                    const subT = (easeT - 0.6) / 0.4;
                    currentScale = tr.peakScale - (tr.peakScale - tr.finalCupScale) * subT;
                }

                tr.curX = curX;
                tr.curY = curY;
                tr.currentScale = currentScale;
                tr.currentRotation = tr.randomAngle * easeT;

                if (t >= 1.0) {

                    this.activeCupTransfers.splice(i, 1);
                }
            }
        }

        const inFlight = this.activeSpoutDrops.length;
        conveyor.inFlightCount = inFlight;

        const cap = conveyor.beltParticles.length;
        const totalLoad = cap + inFlight;
        const maxCap = conveyor.maxCapacity;
        const fillRatio = maxCap > 0 ? (totalLoad / maxCap) : 0;

        // Track conveyor belt revolution progress
        const trackLength = 2 * (conveyor.pathRightX - conveyor.pathLeftX) + 2 * Math.PI * conveyor.arcRadius;
        conveyor.distanceMoved = (conveyor.distanceMoved || 0) + (conveyor.speed * dt);
        if (conveyor.distanceMoved >= trackLength) {
            conveyor.hasCompletedFirstRevolution = true;
        }

        // When conveyor is > 50% full AND has completed its first revolution,
        // immediately transfer particles from conveyor to cups without waiting for particles to travel along the track
        const fastTrackRatioThreshold = settings.conveyor_fast_track_threshold !== undefined ? settings.conveyor_fast_track_threshold : 0.50;
        if (conveyor.hasCompletedFirstRevolution && fillRatio > fastTrackRatioThreshold) {
            const maxPerFrame = settings.conveyor_fast_track_max_per_frame !== undefined ? settings.conveyor_fast_track_max_per_frame : 25;
            this.fastTrackParticles(world, conveyor, maxPerFrame);
        }

        // Fast-Track Idle Particles
        const idleThreshold = settings.idle_particle_threshold !== undefined ? settings.idle_particle_threshold : 10;
        const idleTime = settings.idle_time_seconds !== undefined ? settings.idle_time_seconds : 2.0;

        if (totalLoad > 0 && totalLoad < idleThreshold) {
            conveyor.idleTimeAccumulator = (conveyor.idleTimeAccumulator || 0) + dt;
            if (conveyor.idleTimeAccumulator >= idleTime) {
                this.fastTrackParticles(world, conveyor);
                conveyor.idleTimeAccumulator = 0;
            }
        } else {
            conveyor.idleTimeAccumulator = 0;
        }

        // Conveyor Full / Overflow State Machine:
        // Turn ON: As soon as belt hits maximum capacity
        if (totalLoad >= maxCap) {
            conveyor.isOverflow = true;
            conveyor.overflowOffCooldown = 0;

            // Lose condition: conveyor is filled to 100% capacity AND no particles enter or leave for continuous 5.0s
            if (!this.game.gameOver) {
                conveyor.stallTimer = (conveyor.stallTimer || 0) + dt;
                if (conveyor.stallTimer >= 5.0) {
                    this.game.showLose();
                }
            }
        } else {
            conveyor.stallTimer = 0;
        }

        // Turn OFF: When load drops below capacity (< maxCap), clear overflow state smoothly
        if (conveyor.isOverflow) {
            const clearThreshold = settings.conveyor_overflow_clear_threshold !== undefined ? settings.conveyor_overflow_clear_threshold : 0.98;
            const clearDelaySec = settings.conveyor_overflow_clear_delay_sec !== undefined ? settings.conveyor_overflow_clear_delay_sec : 0.2;

            const isBeltLoadSafe = totalLoad < maxCap * clearThreshold;

            if (isBeltLoadSafe) {
                conveyor.overflowOffCooldown = (conveyor.overflowOffCooldown || 0) + dt;
                if (conveyor.overflowOffCooldown >= clearDelaySec) {
                    conveyor.isOverflow = false;
                    conveyor.overflowOffCooldown = 0;
                }
            } else {
                conveyor.overflowOffCooldown = 0;
            }
        }

        // Update Load Percentage UI: smooth interpolation with hysteresis (eliminates jumping / flickering)
        const targetPercent = Math.min(100, Math.max(0, (totalLoad / maxCap) * 100));

        if (conveyor.smoothLoadPercent === undefined) {
            conveyor.smoothLoadPercent = targetPercent;
            conveyor.displayedLoadInt = Math.round(targetPercent);
        }

        const smoothingSpeed = settings.load_percent_smoothing !== undefined ? settings.load_percent_smoothing : 4.5;
        const diff = targetPercent - conveyor.smoothLoadPercent;
        conveyor.smoothLoadPercent += diff * Math.min(1, dt * smoothingSpeed);

        // Snap near target to settle cleanly
        if (Math.abs(targetPercent - conveyor.smoothLoadPercent) < 0.15) {
            conveyor.smoothLoadPercent = targetPercent;
        }

        conveyor.smoothLoadPercent = Math.min(100, Math.max(0, conveyor.smoothLoadPercent));

        // Hysteresis dead-band: prevents oscillation across integer rounding boundaries
        let nextInt = conveyor.displayedLoadInt !== undefined ? conveyor.displayedLoadInt : Math.round(conveyor.smoothLoadPercent);
        if (conveyor.smoothLoadPercent > nextInt + 0.55) {
            nextInt = Math.round(conveyor.smoothLoadPercent);
        } else if (conveyor.smoothLoadPercent < nextInt - 0.55) {
            nextInt = Math.round(conveyor.smoothLoadPercent);
        }

        // Lock to exact limits
        if (totalLoad >= maxCap) {
            nextInt = 100;
            conveyor.smoothLoadPercent = 100;
        } else if (totalLoad === 0 && conveyor.smoothLoadPercent <= 1) {
            nextInt = 0;
            conveyor.smoothLoadPercent = 0;
        }

        conveyor.displayedLoadInt = nextInt;
        if (conveyor.lastRenderedText !== nextInt) {
            conveyor.lastRenderedText = nextInt;
            conveyor.loadText.setText(`${nextInt}%`);
        }

        // Check for particles entering the automatic collection zone at the bottom of the funnel
        if (this.sandGridComponent === undefined) {
            const sandEntities = world.getEntitiesWith([SandGridComponent]);
            this.sandGridComponent = sandEntities.length > 0 ? sandEntities[0].getComponent(SandGridComponent) : null;
        }
        const sandGrid = this.sandGridComponent;

        if (sandGrid) {
            const imgX = settings.image_logical_x !== undefined ? settings.image_logical_x : 300;
            const imgY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
            const imageScale = settings.image_scale || 0.70;

            // Belt top Y in logical coordinates
            const beltLogicalY = conveyor.y + conveyor.pathTopY;
            const beltLeftX = conveyor.x + conveyor.pathLeftX;
            const beltRightX = conveyor.x + conveyor.pathRightX;

            const frameX = settings.frame_x !== undefined ? settings.frame_x : 296;
            const funnelWidth = settings.funnel_hole_size !== undefined ? settings.funnel_hole_size : (settings.funnel_width || 56);
            const funnelBottomY = settings.funnel_bottom_y !== undefined ? settings.funnel_bottom_y : (beltLogicalY - 40);
            const strokeW = settings.funnel_stroke_width || 18;
            const inset = strokeW / 2;
            const spoutLeftX = settings.funnel_spout_left_x !== undefined
                ? settings.funnel_spout_left_x
                : (frameX - funnelWidth / 2 + inset);
            const spoutRightX = settings.funnel_spout_right_x !== undefined
                ? settings.funnel_spout_right_x
                : (frameX + funnelWidth / 2 - inset);

            // Non-visual fall zone / drop zone configuration from game-settings.json
            const dropZone = settings.funnel_fall_zone || settings.drop_zone || {};
            const dropZoneHeight = dropZone.height !== undefined
                ? dropZone.height
                : (settings.drop_zone_height !== undefined ? settings.drop_zone_height : 18);
            const dropZoneBottomOffset = dropZone.bottom_offset !== undefined
                ? dropZone.bottom_offset
                : (settings.drop_zone_bottom_offset !== undefined ? settings.drop_zone_bottom_offset : 2);

            // Automatic collection bounds strictly limited to visual spout aperture
            const spoutZoneTopY = funnelBottomY - dropZoneHeight;
            const spoutZoneBottomY = funnelBottomY + dropZoneBottomOffset;
            const spoutZoneMinX = spoutLeftX;
            const spoutZoneMaxX = spoutRightX;

            // Compute local bounding box limits in sandGrid space to fast-reject non-candidate particles
            // localPos = (logicalPos - imgOffset) / imageScale
            const minLocalX1 = (spoutZoneMinX - imgX) / imageScale;
            const maxLocalX1 = (spoutZoneMaxX - imgX) / imageScale;
            const minLocalY1 = (spoutZoneTopY - imgY) / imageScale;
            const maxLocalY1 = (spoutZoneBottomY - imgY) / imageScale;

            const minLocalX2 = (beltLeftX - 35 - imgX) / imageScale;
            const maxLocalX2 = (beltRightX + 35 - imgX) / imageScale;
            const minLocalY2 = (funnelBottomY + 2 - imgY) / imageScale;
            const maxLocalY2 = (beltLogicalY + 30 - imgY) / imageScale;

            const overallMinLocalY = Math.min(minLocalY1, minLocalY2);
            const overallMaxLocalY = Math.max(maxLocalY1, maxLocalY2);
            const overallMinLocalX = Math.min(minLocalX1, minLocalX2);
            const overallMaxLocalX = Math.max(maxLocalX1, maxLocalX2);

            if (!this._candidatePool) this._candidatePool = [];
            let candidateCount = 0;

            // Real-time spout dispensing: transfer newly despawned particles directly into activeSpoutDrops in 1:1 sync with physics
            if (this.pendingSpoutQueue) {
                this.pendingSpoutQueue.length = 0; // Clear any old buffered phantom particles
            }

            const currentLoad = (conveyor.beltParticles ? conveyor.beltParticles.length : 0) + (conveyor.inFlightCount || 0);
            const maxCap = conveyor.maxCapacity || 500;
            const freeCapacity = (conveyor.isFull || (maxCap - currentLoad) < 1) ? 0 : (maxCap - currentLoad);

            if (sandGrid.despawnQueue && sandGrid.despawnQueue.length > 0) {
                if (!conveyor.isFull && freeCapacity >= 1) {
                    const toProcess = Math.min(sandGrid.despawnQueue.length, freeCapacity);
                    for (let q = 0; q < toProcess; q++) {
                        const item = sandGrid.despawnQueue[q];
                        const colorInt = item.colorInt !== undefined
                            ? item.colorInt
                            : (sandGrid.dots ? sandGrid.dots[item.p] : 0xFFFFFF);

                        const r = (colorInt >> 16) & 0xFF;
                        const g = (colorInt >> 8) & 0xFF;
                        const b = colorInt & 0xFF;
                        const colorHex = (r << 16) | (g << 8) | b;

                        const pInfo = this.game && this.game.getParticleSize ? this.game.getParticleSize() : null;
                        const pSize = pInfo ? pInfo.logicalSize : 5.0;
                        const halfSize = pSize * 0.5;

                        // Constrain falling particles strictly to the visual aperture width
                        // Convert to conveyor local coordinates
                        const startX = Math.max(spoutLeftX + halfSize, Math.min(spoutRightX - halfSize, item.logicalX)) - conveyor.x;
                        const startY = item.logicalY - conveyor.y;
                        const targetY = (beltLogicalY - 2) - conveyor.y;

                        // If already at or past the belt surface, add directly without falling animation
                        if (startY >= targetY - 4) {
                            this.addParticleToConveyor(conveyor, startX, colorInt, colorHex);
                            continue;
                        }

                        const distY = targetY - startY;
                        const baseDuration = Math.round(Math.sqrt(distY / 45) * 140);
                        const durationJitter = (Math.random() * 30 - 15);
                        const duration = Math.max(60, Math.min(190, baseDuration + durationJitter));

                        // Keep the falling stream cohesive and strictly within the visual aperture
                        const streamJitter = (Math.random() * 4 - 2);
                        const targetX = Math.max(spoutLeftX + halfSize, Math.min(spoutRightX - halfSize, item.logicalX + streamJitter)) - conveyor.x;

                        const darkColor = ((r >> 1) << 16) | ((g >> 1) << 8) | (b >> 1);
                        const targetConveyorScale = (this.game.SETTINGS && this.game.SETTINGS.conveyor_particle_scale !== undefined)
                            ? this.game.SETTINGS.conveyor_particle_scale
                            : 1.6;



                        this.activeSpoutDrops.push({
                            startX,
                            startY,
                            targetX,
                            targetY,
                            colorInt,
                            colorHex,
                            targetScale: targetConveyorScale,
                            durationSec: duration / 1000,
                            delaySec: 0,
                            elapsedSec: 0
                        });
                    }
                }
                sandGrid.despawnQueue.length = 0;
                conveyor.inFlightCount = this.activeSpoutDrops.length;
            }
        }

        // Animate particles along the looping path
        const speed = conveyor.speed * dt;

        // Query active front-row pots freshly for this frame
        const potEntities = world.getEntitiesWith([PotComponent]);
        const activePots = [];
        for (let pIdx = 0; pIdx < potEntities.length; pIdx++) {
            const pot = potEntities[pIdx].getComponent(PotComponent);
            if (pot && pot.state === 'in_grid' && pot.gridRow === 0 && pot.capacity > 0) {
                activePots.push(pot);
            }
        }

        for (let i = conveyor.beltParticles.length - 1; i >= 0; i--) {
            const bp = conveyor.beltParticles[i];
            const trackOffset = bp.trackOffset || 0;
            const effectiveRadius = conveyor.arcRadius - trackOffset;

            const localSpeed = speed * (bp.speedMult !== undefined ? bp.speedMult : 1.0);

            if (bp.state === 'top') {
                bp.x += localSpeed;
                bp.y = conveyor.pathTopY + trackOffset;
                if (bp.x >= conveyor.pathRightX) {
                    bp.state = 'right_arc';
                    bp.angle = -Math.PI / 2; // start angle at top right
                }
            } else if (bp.state === 'right_arc') {
                bp.angle += (localSpeed / conveyor.arcRadius);
                bp.x = conveyor.pathRightX + Math.cos(bp.angle) * effectiveRadius;
                bp.y = 0 + Math.sin(bp.angle) * effectiveRadius;

                if (bp.angle >= Math.PI / 2) {
                    bp.state = 'bottom';
                    bp.x = conveyor.pathRightX;
                    bp.y = conveyor.pathBottomY - trackOffset;
                }
            } else if (bp.state === 'bottom') {
                bp.x -= localSpeed;
                bp.y = conveyor.pathBottomY - trackOffset;
            }

            // --- DROP LOGIC ---
            // Check if we are passing over an active pot that matches color on bottom track or entering right arc
            const isDropState = bp.state === 'bottom' || (bp.state === 'right_arc' && bp.angle >= 0);
            if (isDropState && activePots.length > 0) {
                const worldX = conveyor.x + bp.x;
                let dropped = false;

                for (let pIdx = 0; pIdx < activePots.length; pIdx++) {
                    const pot = activePots[pIdx];
                    if (pot.capacity <= 0) continue;

                    if (pot.color === bp.color || (pot.acceptedColors && pot.acceptedColors.has(bp.color))) {
                        const potWorldX = pot.x;
                        const potHalfWidth = Math.max(58, (pot.width !== undefined ? pot.width : 110) * 0.48);
                        if (Math.abs(worldX - potWorldX) <= potHalfWidth) {
                            dropped = true;
                            conveyor.stallTimer = 0;
                            pot.capacity--;

                            this.playToCupSound(0.55);

                            const pWorldX = conveyor.x + bp.x;
                            const pWorldY = conveyor.y + bp.y;

                            conveyor.beltParticles.splice(i, 1);

                            this.executeDropAnimation(bp, pot, pWorldX, pWorldY);
                            break;
                        }
                    }
                }

                if (dropped) {
                    continue; // Skip end-of-loop position overwrite!
                }

                if (bp.x <= conveyor.pathLeftX) {
                    bp.state = 'left_arc';
                    bp.angle = Math.PI / 2;
                }
            } else if (isDropState) {
                if (bp.x <= conveyor.pathLeftX) {
                    bp.state = 'left_arc';
                    bp.angle = Math.PI / 2;
                }
            } else if (bp.state === 'left_arc') {
                const localSpeed = speed * (bp.speedMult !== undefined ? bp.speedMult : 1.0);
                bp.angle += (localSpeed / conveyor.arcRadius);
                bp.x = conveyor.pathLeftX + Math.cos(bp.angle) * effectiveRadius;
                bp.y = 0 + Math.sin(bp.angle) * effectiveRadius;

                if (bp.angle >= Math.PI * 1.5) {
                    bp.state = 'top';
                    bp.x = conveyor.pathLeftX;
                    bp.y = conveyor.pathTopY + trackOffset;
                }
            }
        }

        // Batch render all conveyor belt particles cleanly on conveyor.batchGraphics
        this.renderConveyorParticles(conveyor);

        // Overflow Warning UI (controlled strictly by debounced isOverflow)
        if (conveyor.isOverflow && !this.game.gameOver) {
            if (!conveyor.warningText) {
                // Artwork logical position & scale calculation for center alignment
                const imgX = settings.image_logical_x !== undefined ? settings.image_logical_x : 300;
                const imgY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
                const imgScale = settings.image_scale !== undefined ? settings.image_scale : 0.72;

                // Artwork bounds: frame is 480x505 at imgScale
                const artworkCenterX = imgX;
                const artworkCenterY = imgY + (200 * imgScale); // Center of artwork canvas

                conveyor.warningText = this.game.add.text(artworkCenterX, artworkCenterY, 'Conveyor is Full!', {
                    fontFamily: 'Arial',
                    fontSize: '64px',
                    fontStyle: 'bold',
                    fill: '#000000',  // Solid black text
                    stroke: '#ffffff', // Distinct white stroke/outline
                    strokeThickness: 8
                });
                conveyor.warningText.setOrigin(0.5, 0.5); // True horizontal & vertical centering
                conveyor.warningText.setDepth(1000);
                conveyor.warningText.setAlpha(0);
                conveyor.warningText.setScale(0.7);
                conveyor.warningTextState = 'hidden';
                if (this.game.mainContainer) {
                    this.game.mainContainer.add(conveyor.warningText);
                }
            }

            if (conveyor.warningTextState === 'hidden' || conveyor.warningTextState === 'exiting') {
                conveyor.warningTextState = 'entering';

                if (conveyor.warningTween) conveyor.warningTween.stop();
                if (conveyor.breathingTween) conveyor.breathingTween.stop();

                conveyor.warningText.visible = true;
                conveyor.warningText.setAlpha(0);
                conveyor.warningText.setScale(0.7);

                // Entry animation: alpha 0 -> 1, scale-up with Sine.easeOut
                conveyor.warningTween = this.game.tweens.add({
                    targets: conveyor.warningText,
                    alpha: 1,
                    scaleX: 1.0,
                    scaleY: 1.0,
                    duration: 300,
                    ease: 'Sine.easeOut',
                    onComplete: () => {
                        if (conveyor.isOverflow && conveyor.warningTextState === 'entering') {
                            conveyor.warningTextState = 'idle';
                            // Idle state breathing animation: loop 1.0x -> 1.08x back and forth with Sine.easeInOut
                            conveyor.breathingTween = this.game.tweens.add({
                                targets: conveyor.warningText,
                                scaleX: 1.08,
                                scaleY: 1.08,
                                duration: 600,
                                yoyo: true,
                                repeat: -1,
                                ease: 'Sine.easeInOut'
                            });
                        }
                    }
                });
            }
        } else {
            if (conveyor.warningText && conveyor.warningTextState !== 'hidden' && conveyor.warningTextState !== 'exiting') {
                conveyor.warningTextState = 'exiting';

                if (conveyor.warningTween) conveyor.warningTween.stop();
                if (conveyor.breathingTween) conveyor.breathingTween.stop();

                // Exit animation: alpha 1 -> 0 with scale up (1.0x -> 1.25x) for clean dissolve/flash-out
                conveyor.warningTween = this.game.tweens.add({
                    targets: conveyor.warningText,
                    alpha: 0,
                    scaleX: 1.25,
                    scaleY: 1.25,
                    duration: 250,
                    ease: 'Sine.easeIn',
                    onComplete: () => {
                        conveyor.warningTextState = 'hidden';
                        conveyor.warningText.visible = false;
                    }
                });
            }
        }
    }

    dismissWarning(onComplete) {
        let warningFound = false;
        if (this.world) {
            if (!this.conveyorComponent) {
                const conveyorEntities = this.world.getEntitiesWith([ConveyorComponent]);
                if (conveyorEntities.length > 0) {
                    this.conveyorComponent = conveyorEntities[0].getComponent(ConveyorComponent);
                }
            }
            const conveyor = this.conveyorComponent;
                if (conveyor && conveyor.warningText && conveyor.warningText.visible && conveyor.warningTextState !== 'hidden') {
                    warningFound = true;
                    conveyor.isOverflow = false;
                    conveyor.warningTextState = 'exiting';

                    if (conveyor.warningTween) conveyor.warningTween.stop();
                    if (conveyor.breathingTween) conveyor.breathingTween.stop();

                    conveyor.warningTween = this.game.tweens.add({
                        targets: conveyor.warningText,
                        alpha: 0,
                        scaleX: 1.25,
                        scaleY: 1.25,
                        duration: 250,
                        ease: 'Sine.easeIn',
                        onComplete: () => {
                            conveyor.warningTextState = 'hidden';
                            conveyor.warningText.visible = false;
                            if (onComplete) onComplete();
                        }
                    });
                }
        }
        if (!warningFound && onComplete) {
            onComplete();
        }
    }
}
