import sandData from '../../../assets/sand_image.json';
import { ConveyorComponent } from './ConveyorComponent';

export const STATE_RESTING = 0;
export const STATE_ACTIVE = 1;
export const STATE_FREE_FALL = 2; // Replaces STATE_DETACHED for funnel physics
export const STATE_FUNNEL_RESTING = 3; // Sleeping still in funnel pile without jitter
export const STATE_QUEUED_WAKE = 4; // Queued for staggered activation in wake quota

// Particle collision audio configuration constants
export const SOUND_FALL_HEIGHT_DEAD_ZONE = 18.0; // Minimum fall distance (logical pixels) to trigger sound
export const SOUND_FALL_HEIGHT_MAX = 220.0;     // Fall distance at which volume reaches maximum
export const SOUND_VOLUME_MIN = 0.08;            // Minimum volume for collision impact
export const SOUND_VOLUME_MAX = 0.55;            // Maximum volume for heavy impact
export const SOUND_COLLISION_COOLDOWN_MS = 35;   // Minimum ms between consecutive collision sounds to prevent audio clipping

export class SandGridComponent {
    constructor(scene) {
        this.scene = scene;
        const data = (sandData && sandData.default) ? sandData.default : sandData;
        this.width = data.width;
        this.height = data.height;
        this.dots = data.dots;

        const count = this.dots.length;
        this.particleCount = count;

        this.positions = new Float32Array(count * 2);
        this.colors = new Float32Array(count * 4);
        this.originalColors = new Float32Array(count * 4);
        this.isTinted = new Uint8Array(count);

        this.uniqueColors = Array.from(new Set(this.dots));
        this.colorCounts = new Map();

        this.states = new Uint8Array(count);
        this.activeIndices = new Int32Array(count);
        this.activePosInPool = new Int32Array(count);
        this.activeCount = 0;

        this.vx = new Float32Array(count);
        this.vy = new Float32Array(count);
        this.stability = new Float32Array(count);
        this.fallStartY = new Float32Array(count);
        this.preStepY = new Float32Array(count);
        this.tintProgress = new Float32Array(count); // Smooth color tint transition progress [0.0 -> 1.0]
        this.hasTouchedWall = new Uint8Array(count); // 0 = free (no wall contact), 1 = left wall, 2 = right wall
        this.hasDecelContact = new Uint8Array(count); // 0 = free fall (no deceleration), 1 = contact with wall or slowed particle
        this.deadZoneTimer = new Float32Array(count); // Timer tracking seconds spent in parabola dead zone

        // Sound pool tracking
        this.lastSoundTime = 0;
        this.soundKeys = [
            'sand_1', 'sand_2', 'sand_3', 'sand_4', 'sand_5',
            'sand_6', 'sand_7', 'sand_8', 'sand_9', 'sand_10'
        ];

        this.grid = new Int32Array(this.width * this.height);
        this.particleRow = new Int16Array(count);
        this.particleCol = new Int16Array(count);

        // Sleep optimization tracking
        this.stationaryFrames = new Uint8Array(count);
        this.despawnQueue = []; // Holds data for particles culled at the funnel spout

        this.isDirty = false;
        this.dirtyMinIndex = count;
        this.dirtyMaxIndex = -1;

        this.isColorDirty = false;
        this.colorDirtyMinIndex = count;
        this.colorDirtyMaxIndex = -1;

        this.funnelFloor = null;

        this.activePosInPool.fill(-1);
        this.hasBeenDestroyed = false;
        this.islandCheckTimer = 0;

        this.conveyorComponent = null;
        this.hasMovingParticles = false;
        this._lastTelemetryLog = 0;

        this._colL = { x1: 69, y1: 485, x2: 281, y2: 570 };
        this._colR = { x1: 531, y1: 485, x2: 319, y2: 570 };

        this.wakeCandidatesP = new Int32Array(16);
        this.wakeCandidatesY = new Float32Array(16);

        // Dynamic boundary & parabola evaluation throttling and caching
        this._boundaryEvalAccumulator = 0;
        this._boundaryEvalInterval = 0.16; // ~160ms (150-200ms range)
        this._cachedLeftPileY = 0;
        this._cachedRightPileY = 0;
        this._cachedLeftParabolaHeight = 0;
        this._cachedRightParabolaHeight = 0;
        this._cachedEffectiveLeftMoundY = 0;
        this._cachedEffectiveRightMoundY = 0;
        this._cachedLeftPower = 1.0;
        this._cachedRightPower = 1.0;
        this._cachedIsLeftParabolaActive = false;
        this._cachedIsRightParabolaActive = false;
        this._cachedLutStartY = 0;
        this._cachedLutSpan = 0;
        this._cachedLutStep = 1;
        this._cachedLutInvStep = 0;
        this._cachedMinFreezeHeight = 25;
        this._lastIsConveyorFull = false;
        this._boundaryInitialized = false;

        const settings = scene.SETTINGS || {};
        const pInfo = scene.getParticleSize ? scene.getParticleSize() : null;
        const spacing = pInfo ? pInfo.spacing : (settings.particle_spacing || settings.particle_scale || 5.0);
        this.spacing = spacing;

        const collisionScale = settings.particle_collision_scale !== undefined ? settings.particle_collision_scale : 1.20;
        const initialColDiameter = (pInfo ? pInfo.logicalSize : (spacing * (settings.image_scale || 0.72))) * collisionScale;
        this.colCellSize = Math.max(initialColDiameter * 1.1, 4.0);
        this.colOriginX = 40;
        this.colOriginY = 0;
        this.colGridCols = Math.ceil(540 / this.colCellSize) + 4;
        this.colGridRows = Math.ceil(820 / this.colCellSize) + 4;
        this.colGridHead = new Int32Array(this.colGridCols * this.colGridRows);
        this.colGridHead.fill(-1);
        this.dirtyCells = new Int32Array(this.colGridCols * this.colGridRows);
        this.dirtyCellCount = 0;
        this.colParticleNext = new Int32Array(count);
        this.staticGrid = new Int32Array(count);
        this.grid = this.staticGrid;

        const offsetX = (this.width * spacing) / 2.0;
        const offsetY = (this.height * spacing) / 2.0;
        this.offsetX = offsetX;
        this.offsetY = offsetY;

        this.minX = -offsetX + spacing * 0.5;
        this.maxX = offsetX - spacing * 0.5;

        for (let i = 0; i < count; i++) {
            const row = Math.floor(i / this.width);
            const col = i % this.width;

            this.positions[i * 2 + 0] = col * spacing - offsetX;
            this.positions[i * 2 + 1] = row * spacing - offsetY;
            this.fallStartY[i] = this.positions[i * 2 + 1];

            this.staticGrid[i] = i;
            this.particleRow[i] = row;
            this.particleCol[i] = col;
            this.states[i] = STATE_RESTING;
            this.stationaryFrames[i] = 0;
            this.isTinted[i] = 0;
            this.hasDecelContact[i] = 0;

            const colorInt = this.dots[i];
            this.colorCounts.set(colorInt, (this.colorCounts.get(colorInt) || 0) + 1);

            const r = (colorInt >> 16) & 0xFF;
            const g = (colorInt >> 8) & 0xFF;
            const b = colorInt & 0xFF;

            const rNorm = r / 255.0;
            const gNorm = g / 255.0;
            const bNorm = b / 255.0;

            this.colors[i * 4 + 0] = rNorm;
            this.colors[i * 4 + 1] = gNorm;
            this.colors[i * 4 + 2] = bNorm;
            this.colors[i * 4 + 3] = 1.0;

            this.originalColors[i * 4 + 0] = rNorm;
            this.originalColors[i * 4 + 1] = gNorm;
            this.originalColors[i * 4 + 2] = bNorm;
            this.originalColors[i * 4 + 3] = 1.0;
        }
    }

    markDirty(index) {
        if (index < this.dirtyMinIndex) this.dirtyMinIndex = index;
        if (index > this.dirtyMaxIndex) this.dirtyMaxIndex = index;
        this.isDirty = true;
    }

    resetDirty() {
        this.isDirty = false;
        this.dirtyMinIndex = this.particleCount;
        this.dirtyMaxIndex = -1;
    }

    markColorDirty(index) {
        if (index < this.colorDirtyMinIndex) this.colorDirtyMinIndex = index;
        if (index > this.colorDirtyMaxIndex) this.colorDirtyMaxIndex = index;
        this.isColorDirty = true;
    }

    resetColorDirty() {
        this.isColorDirty = false;
        this.colorDirtyMinIndex = this.particleCount;
        this.colorDirtyMaxIndex = -1;
    }

    applyYellowTint(p) {
        if (this.isTinted[p] === 1) return;
        this.isTinted[p] = 1; // Mark as tinting in progress
        this.hasActiveTintTransitions = true;
    }

    restoreOriginalColor(p) {
        if (this.isTinted[p] === 0 && this.tintProgress[p] === 0) return;
        this.isTinted[p] = 0; // Mark as restoring original color
        this.hasActiveTintTransitions = true;
    }

    wakeParticle(p) {
        if (this.states[p] === STATE_RESTING) {
            this.states[p] = STATE_QUEUED_WAKE;
            if (!this._wakeQueue || this._wakeQueue.length !== this.particleCount) {
                this._wakeQueue = new Int32Array(this.particleCount);
                this._wakeQueueHead = 0;
                this._wakeQueueTail = 0;
            }
            this._wakeQueue[this._wakeQueueTail++] = p;
        }
    }

    playSandCollisionSound(fallDistance, impactVelocity = 0) {
        if (fallDistance < SOUND_FALL_HEIGHT_DEAD_ZONE) {
            return; // Dead zone: do not play sound on short drops or micro-movements
        }

        const settings = (this.scene && this.scene.SETTINGS) || {};
        const maxPerSec = settings.sand_sound_max_per_sec !== undefined
            ? settings.sand_sound_max_per_sec
            : (settings.sand_collision_max_per_sec !== undefined ? settings.sand_collision_max_per_sec : 12);

        if (maxPerSec <= 0) return;

        const now = (this.scene?.time?.now) || performance.now();
        if (!this.sandSoundPlayTimes) this.sandSoundPlayTimes = [];

        // 1. Sliding window rate limit check (1000ms window)
        while (this.sandSoundPlayTimes.length > 0 && now - this.sandSoundPlayTimes[0] >= 1000) {
            this.sandSoundPlayTimes.shift();
        }

        if (this.sandSoundPlayTimes.length >= maxPerSec) {
            return; // Strict rate limit per second reached
        }

        // 2. Minimum interval check to avoid sub-frame audio clipping
        const minIntervalMs = 1000 / maxPerSec;
        if (now - this.lastSoundTime < minIntervalMs) {
            return;
        }

        this.sandSoundPlayTimes.push(now);
        this.lastSoundTime = now;

        // Dynamic volume calculation based on fall distance
        const distanceRatio = Math.min(1.0, Math.max(0.0, (fallDistance - SOUND_FALL_HEIGHT_DEAD_ZONE) / (SOUND_FALL_HEIGHT_MAX - SOUND_FALL_HEIGHT_DEAD_ZONE)));
        let volume = SOUND_VOLUME_MIN + distanceRatio * (SOUND_VOLUME_MAX - SOUND_VOLUME_MIN);

        // Randomly pick a sound from sand_1 to sand_10
        const randIndex = Math.floor(Math.random() * this.soundKeys.length);
        const soundKey = this.soundKeys[randIndex];

        try {
            if (typeof window !== 'undefined' && window.App && window.App.resources && window.App.resources.audio && window.App.resources.audio.json) {
                const sound = this.scene.sound.addAudioSprite('sfx');
                if (sound) {
                    sound.play(soundKey, { volume: Math.min(1.0, volume) });
                }
            } else if (this.scene && this.scene.sound) {
                this.scene.sound.play(soundKey, { volume: Math.min(1.0, volume) });
            }
        } catch (e) {
            // Audio error safety
        }
    }

    sleepParticle(p) {
        if (this.states[p] === STATE_ACTIVE) {
            this.states[p] = STATE_RESTING;
            this.vx[p] = 0;
            this.vy[p] = 0;
            this.stability[p] = 1.0;
            this.stationaryFrames[p] = 0;
            if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
        }
    }

    removeParticleFromSimulation(p) {
        this.states[p] = STATE_RESTING;
        this.vx[p] = 0;
        this.vy[p] = 0;
        this.stationaryFrames[p] = 0;
        this.stability[p] = 0;
        if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
        if (this.hasTouchedWall) this.hasTouchedWall[p] = 0;
        if (this.hasDecelContact) this.hasDecelContact[p] = 0;
        this.positions[p * 2 + 0] = -99999;
        this.positions[p * 2 + 1] = -99999;
        this.markDirty(p);

        const pos = this.activePosInPool[p];
        if (pos >= 0 && pos < this.activeCount) {
            const lastIdx = this.activeCount - 1;
            if (pos !== lastIdx) {
                const lastP = this.activeIndices[lastIdx];
                this.activeIndices[pos] = lastP;
                this.activePosInPool[lastP] = pos;
            }
            this.activePosInPool[p] = -1;
            this.activeCount--;
        }
    }

    hasParticleAt(particleX, particleY, radius) {
        if (radius === undefined) {
            radius = this.spacing * 1.5;
        }
        const w = this.width;
        const h = this.height;
        const spacing = this.spacing;
        const offsetX = this.offsetX;
        const offsetY = this.offsetY;

        const centerCol = Math.floor((particleX + offsetX) / spacing);
        const centerRow = Math.floor((particleY + offsetY) / spacing);
        const cellRadius = Math.ceil(radius / spacing);
        const r2 = radius * radius;

        const minR = Math.max(0, centerRow - cellRadius);
        const maxR = Math.min(h - 1, centerRow + cellRadius);
        const minC = Math.max(0, centerCol - cellRadius);
        const maxC = Math.min(w - 1, centerCol + cellRadius);

        for (let r = minR; r <= maxR; r++) {
            const rowOffset = r * w;
            for (let c = minC; c <= maxC; c++) {
                const p = this.staticGrid[rowOffset + c];
                if (p === -1) continue;

                const px = this.positions[p * 2 + 0];
                const py = this.positions[p * 2 + 1];
                const dx = px - particleX;
                const dy = py - particleY;
                if (dx * dx + dy * dy <= r2) {
                    return true;
                }
            }
        }
        return false;
    }

    brushAt(particleX, particleY, brushRadius = 25) {
        const w = this.width;
        const h = this.height;
        const spacing = this.spacing;
        const offsetX = this.offsetX;
        const offsetY = this.offsetY;

        const centerCol = Math.floor((particleX + offsetX) / spacing);
        const centerRow = Math.floor((particleY + offsetY) / spacing);
        const cellRadius = Math.ceil(brushRadius / spacing);
        const r2 = brushRadius * brushRadius;

        const minR = Math.max(0, centerRow - cellRadius);
        const maxR = Math.min(h - 1, centerRow + cellRadius);
        const minC = Math.max(0, centerCol - cellRadius);
        const maxC = Math.min(w - 1, centerCol + cellRadius);

        if (this.minDirtyRow === undefined || minR < this.minDirtyRow) this.minDirtyRow = Math.max(0, minR - 4);
        if (this.maxDirtyRow === undefined || maxR > this.maxDirtyRow) this.maxDirtyRow = Math.min(h - 1, maxR + 4);
        if (this.minDirtyCol === undefined || minC < this.minDirtyCol) this.minDirtyCol = Math.max(0, minC - 4);
        if (this.maxDirtyCol === undefined || maxC > this.maxDirtyCol) this.maxDirtyCol = Math.min(w - 1, maxC + 4);

        let activatedCount = 0;

        for (let r = minR; r <= maxR; r++) {
            const rowOffset = r * w;
            for (let c = minC; c <= maxC; c++) {
                const p = this.staticGrid[rowOffset + c];
                if (p === -1) continue;

                const px = this.positions[p * 2 + 0];
                const py = this.positions[p * 2 + 1];
                const dx = px - particleX;
                const dy = py - particleY;

                if (dx * dx + dy * dy <= r2) {
                    this.applyYellowTint(p);
                    this.hasQueuedParticles = true;
                    this.hasBeenDestroyed = true;
                    activatedCount++;
                }
            }
        }

        return activatedCount;
    }

    getQueuedParticlesCount() {
        let queuedFunnel = 0;
        let activeFalling = 0;
        const settings = this.scene.SETTINGS || {};
        const imgY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
        const imageScale = settings.image_scale || 0.70;
        const funnelThresholdY = 465;

        for (let i = 0; i < this.activeCount; i++) {
            const p = this.activeIndices[i];
            if (this.states[p] !== STATE_ACTIVE) continue;
            const ly = this.positions[p * 2 + 1] * imageScale + imgY;
            if (ly >= funnelThresholdY && ly < 900) {
                queuedFunnel++;
            } else if (ly < funnelThresholdY && ly > -1000) {
                activeFalling++;
            }
        }
        return { queuedFunnel, activeFalling, total: queuedFunnel + activeFalling };
    }

    checkAndCollapseIsolatedIslands(settings = {}) {
        const threshold = settings.isolated_particles_threshold !== undefined
            ? settings.isolated_particles_threshold
            : (settings.isolated_cluster_threshold !== undefined
                ? settings.isolated_cluster_threshold
                : (settings.isolated_island_threshold !== undefined
                    ? settings.isolated_island_threshold
                    : 5));

        if (threshold <= 0) return;

        // Do not trigger collapse while conveyor is in sustained overflow
        if (this.scene && this.scene.ecsWorld) {
            const conveyorEntities = this.scene.ecsWorld.getEntitiesWith([ConveyorComponent]);
            if (conveyorEntities.length > 0) {
                const conveyor = conveyorEntities[0].getComponent(ConveyorComponent);
                if (conveyor && conveyor.isOverflow) {
                    return;
                }
            }
        }

        const w = this.width;
        const h = this.height;
        const totalCells = w * h;
        const grid = this.staticGrid;

        const minScanR = (this.minDirtyRow !== undefined) ? this.minDirtyRow : 0;
        const maxScanR = (this.maxDirtyRow !== undefined) ? this.maxDirtyRow : h - 1;
        const minScanC = (this.minDirtyCol !== undefined) ? this.minDirtyCol : 0;
        const maxScanC = (this.maxDirtyCol !== undefined) ? this.maxDirtyCol : w - 1;

        if (!this._componentVisited || this._componentVisited.length !== totalCells) {
            this._componentVisited = new Int32Array(totalCells);
            this._visitToken = 0;
        }
        if (!this._bfsQueue || this._bfsQueue.length !== totalCells) {
            this._bfsQueue = new Int32Array(totalCells);
        }
        if (!this._compCellsBuffer || this._compCellsBuffer.length !== totalCells) {
            this._compCellsBuffer = new Int32Array(totalCells);
        }
        if (!this._smallCompStarts) {
            this._smallCompStarts = new Int32Array(512);
            this._smallCompLengths = new Int32Array(512);
        }

        this._visitToken = (this._visitToken || 0) + 1;
        if (this._visitToken > 2000000000) {
            this._visitToken = 1;
            this._componentVisited.fill(0);
        }
        const token = this._visitToken;
        const visited = this._componentVisited;
        const q = this._bfsQueue;
        const compBuf = this._compCellsBuffer;
        let compBufOffset = 0;
        let smallCompCount = 0;

        for (let r = minScanR; r <= maxScanR; r++) {
            const rOffset = r * w;
            for (let c = minScanC; c <= maxScanC; c++) {
                const idx = rOffset + c;
                const p = grid[idx];
                if (p === -1 || visited[idx] === token) continue;

                let head = 0;
                let tail = 0;
                q[tail++] = idx;
                visited[idx] = token;

                const compStart = compBufOffset;
                let compLen = 0;

                while (head < tail) {
                    const cur = q[head++];
                    compBuf[compBufOffset++] = cur;
                    compLen++;

                    const cr = Math.floor(cur / w);
                    const cc = cur % w;

                    for (let dr = -1; dr <= 1; dr++) {
                        const nr = cr + dr;
                        if (nr < 0 || nr >= h) continue;
                        const nRow = nr * w;
                        for (let dc = -1; dc <= 1; dc++) {
                            if (dr === 0 && dc === 0) continue;
                            const nc = cc + dc;
                            if (nc < 0 || nc >= w) continue;
                            const nidx = nRow + nc;
                            if (grid[nidx] !== -1 && visited[nidx] !== token) {
                                visited[nidx] = token;
                                q[tail++] = nidx;
                            }
                        }
                    }
                }

                if (compLen <= threshold && smallCompCount < 512) {
                    this._smallCompStarts[smallCompCount] = compStart;
                    this._smallCompLengths[smallCompCount] = compLen;
                    smallCompCount++;
                }
            }
        }

        this.minDirtyRow = undefined;
        this.maxDirtyRow = undefined;
        this.minDirtyCol = undefined;
        this.maxDirtyCol = undefined;

        if (smallCompCount === 0) return;

        for (let k = 0; k < smallCompCount; k++) {
            const start = this._smallCompStarts[k];
            const len = this._smallCompLengths[k];

            // Check if any particle in this component is not yet tinted
            let hasUntinted = false;
            for (let i = 0; i < len; i++) {
                const p = grid[compBuf[start + i]];
                if (p !== -1 && !this.isTinted[p]) {
                    hasUntinted = true;
                    break;
                }
            }
            if (!hasUntinted) continue; // Already in progress

            for (let i = 0; i < len; i++) {
                const cellIdx = compBuf[start + i];
                const p = grid[cellIdx];
                if (p !== -1) {
                    this.applyYellowTint(p);
                    const r = Math.floor(cellIdx / w);
                    const c = cellIdx % w;
                    // Wake bottom-most or open particles immediately to begin natural cascade
                    if (r === h - 1 || grid[(r + 1) * w + c] === -1) {
                        this.wakeParticle(p);
                    }
                }
            }
            this.hasQueuedParticles = true;
        }
    }

    // Unified Physics Simulation Space: single continuous simulation spanning image and funnel
    stepPhysics(dt = 0.016, settings = {}, funnelColliders = []) {
        if (this.scene && this.scene.gameOver) {
            return false;
        }

        // Drain staggered wake queue (Wake Quota per step)
        if (this._wakeQueueHead < this._wakeQueueTail) {
            const maxWakePerStep = settings.max_wake_per_step !== undefined ? settings.max_wake_per_step : 20;
            let count = 0;
            while (count < maxWakePerStep && this._wakeQueueHead < this._wakeQueueTail) {
                // Randomize selection from the wake queue window to break strict left-to-right ladder alignment
                const remaining = this._wakeQueueTail - this._wakeQueueHead;
                if (remaining > 1) {
                    const swapOffset = Math.floor(Math.random() * Math.min(remaining, 40));
                    const targetIdx = this._wakeQueueHead + swapOffset;
                    const temp = this._wakeQueue[this._wakeQueueHead];
                    this._wakeQueue[this._wakeQueueHead] = this._wakeQueue[targetIdx];
                    this._wakeQueue[targetIdx] = temp;
                }

                const p = this._wakeQueue[this._wakeQueueHead++];
                if (this.states[p] === STATE_QUEUED_WAKE) {
                    this.states[p] = STATE_ACTIVE;
                    this.stationaryFrames[p] = 0;
                    this.stability[p] = 0;
                    if (this.hasTouchedWall) this.hasTouchedWall[p] = 0;
                    if (this.hasDecelContact) this.hasDecelContact[p] = 0;
                    if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                    this.fallStartY[p] = this.positions[p * 2 + 1];
                    this.hasBeenDestroyed = true;
                    this.staticGrid[p] = -1; // Detach from static image terrain

                    this.restoreOriginalColor(p);
                    this.colors[p * 4 + 3] = 0.0;
                    this.markColorDirty(p);

                    // Add random scattering to initial velocities and sub-pixel positions
                    const scatterVx = settings.sand_scatter_vx !== undefined ? settings.sand_scatter_vx : 40.0;
                    const scatterVy = settings.sand_scatter_vy !== undefined ? settings.sand_scatter_vy : 50.0;
                    const baseVy = settings.sand_initial_vy !== undefined ? settings.sand_initial_vy : 25.0;
                    const scatterPos = settings.sand_scatter_pos !== undefined ? settings.sand_scatter_pos : 1.5;

                    this.vx[p] = (Math.random() - 0.5) * scatterVx;
                    this.vy[p] = baseVy + (Math.random() - 0.5) * scatterVy;
                    this.positions[p * 2 + 0] += (Math.random() - 0.5) * scatterPos;
                    this.positions[p * 2 + 1] += (Math.random() - 0.5) * scatterPos;
                    const pos = this.activePosInPool[p];
                    if (pos === -1 || pos >= this.activeCount || this.activeIndices[pos] !== p) {
                        this.activeIndices[this.activeCount] = p;
                        this.activePosInPool[p] = this.activeCount;
                        this.activeCount++;
                    }
                    count++;
                }
            }
            if (this._wakeQueueHead >= this._wakeQueueTail) {
                this._wakeQueueHead = 0;
                this._wakeQueueTail = 0;
            }
        }
        // Smooth color tint transition update (swiping selection & un-tinting)
        if (this.hasActiveTintTransitions) {
            let activeTransitions = false;

            const selectionCfg = settings.swipe_selection || {};
            const hexStr = (selectionCfg.color_hex || '#FFF273').replace('#', '');
            const hexVal = parseInt(hexStr, 16) || 0xFFF273;
            const tintR = ((hexVal >> 16) & 0xFF) / 255.0;
            const tintG = ((hexVal >> 8) & 0xFF) / 255.0;
            const tintB = (hexVal & 0xFF) / 255.0;

            const maxBlend = selectionCfg.opacity !== undefined ? selectionCfg.opacity : (selectionCfg.transparency !== undefined ? selectionCfg.transparency : 0.70);

            const fadeInMs = selectionCfg.fade_in_speed_ms !== undefined ? selectionCfg.fade_in_speed_ms : 160;
            const fadeOutMs = selectionCfg.fade_out_speed_ms !== undefined ? selectionCfg.fade_out_speed_ms : 160;

            const fadeInRate = fadeInMs > 0 ? (dt / (fadeInMs / 1000.0)) : 1.0;
            const fadeOutRate = fadeOutMs > 0 ? (dt / (fadeOutMs / 1000.0)) : 1.0;

            for (let i = 0; i < this.particleCount; i++) {
                const target = this.isTinted[i];
                let current = this.tintProgress[i];

                if (current !== target) {
                    activeTransitions = true;
                    if (current < target) {
                        current = Math.min(target, current + fadeInRate);
                    } else {
                        current = Math.max(target, current - fadeOutRate);
                    }
                    this.tintProgress[i] = current;

                    const effectiveBlend = current * maxBlend;
                    this.colors[i * 4 + 0] = this.originalColors[i * 4 + 0] * (1.0 - effectiveBlend) + tintR * effectiveBlend;
                    this.colors[i * 4 + 1] = this.originalColors[i * 4 + 1] * (1.0 - effectiveBlend) + tintG * effectiveBlend;
                    this.colors[i * 4 + 2] = this.originalColors[i * 4 + 2] * (1.0 - effectiveBlend) + tintB * effectiveBlend;
                    this.markColorDirty(i);
                }
            }
            this.hasActiveTintTransitions = activeTransitions;
        }

        // Periodic check for isolated small components (<= threshold) separated from the rest of the image
        this.islandCheckTimer = (this.islandCheckTimer || 0) + dt;
        if (this.hasBeenDestroyed && (this.islandCheckTimer >= 0.15 || this.pendingIslandCheckOnPointerUp)) {
            this.islandCheckTimer = 0;
            this.pendingIslandCheckOnPointerUp = false;
            this.checkAndCollapseIsolatedIslands(settings);
        }

        // Wake up tinted particles that have space to fall (cellular automaton style detachment)
        if (this.hasQueuedParticles) {
            let stillQueued = false;
            const w = this.width;
            const h = this.height;
            // Iterate top-to-bottom so only 1 row detaches per frame, preventing massive overlapping blocks
            for (let r = 0; r < h; r++) {
                const rowOff = r * w;
                const belowOff = (r + 1) * w;
                for (let c = 0; c < w; c++) {
                    const p = this.staticGrid[rowOff + c];
                    if (p !== -1 && this.isTinted[p]) {
                        let canFall = false;
                        if (r === h - 1) {
                            canFall = true; // Bottom row always falls
                        } else {
                            if (this.staticGrid[belowOff + c] === -1) {
                                canFall = true;
                            } else if (c > 0 && this.staticGrid[belowOff + c - 1] === -1 && this.staticGrid[rowOff + c - 1] === -1) {
                                canFall = true;
                            } else if (c < w - 1 && this.staticGrid[belowOff + c + 1] === -1 && this.staticGrid[rowOff + c + 1] === -1) {
                                canFall = true;
                            }
                        }

                        if (canFall) {
                            this.wakeParticle(p);
                        } else {
                            stillQueued = true;
                        }
                    }
                }
            }
            this.hasQueuedParticles = stillQueued;
        }

        if (this.activeCount === 0) return false;

        const scene = this.scene;
        const imageScale = settings.image_scale || 0.70;
        const imgX = settings.image_logical_x !== undefined ? settings.image_logical_x : (settings.image_x !== undefined ? settings.image_x : 300);
        const imgY = settings.image_logical_y !== undefined ? settings.image_logical_y : (settings.image_y !== undefined ? settings.image_y : 245);
        const gravity = settings.sand_gravity || 1400;

        // Check conveyor load & capacity status (zero per-frame allocation)
        let isConveyorFull = false;
        let conveyorLoadRatio = 0.0;
        let freeCapacity = 0;
        if (!this.conveyorComponent && scene.ecsWorld) {
            const conveyorEntities = scene.ecsWorld.getEntitiesWith([ConveyorComponent]);
            if (conveyorEntities.length > 0) {
                this.conveyorComponent = conveyorEntities[0].getComponent(ConveyorComponent);
            }
        }
        const conveyor = this.conveyorComponent;
        if (conveyor) {
            const maxCap = conveyor.maxCapacity || 500;
            const inFlight = conveyor.inFlightCount || (conveyor.activeDrops ? conveyor.activeDrops.size : 0);
            const currentLoad = (conveyor.beltParticles ? conveyor.beltParticles.length : 0) + inFlight;
            const freeCap = maxCap - currentLoad;
            conveyorLoadRatio = currentLoad / maxCap;
            isConveyorFull = conveyor.isFull || freeCap < 1 || currentLoad >= maxCap;
            freeCapacity = isConveyorFull ? 0 : Math.max(0, freeCap);
        }

        // As conveyor load rises to 100%, scale down wall sliding speed (1.0 -> 0.0) to eliminate slide pile at spout when full
        let wallSlideFactor = 1.0;
        if (isConveyorFull) {
            wallSlideFactor = 0.0;
        } else if (conveyorLoadRatio > 0.90) {
            const overflowProgress = Math.min(1.0, (conveyorLoadRatio - 0.90) / 0.10);
            wallSlideFactor = 1.0 - overflowProgress;
        }

        // Funnel boundary geometry (reusing static scratch objects)
        const colL = this._colL;
        const colR = this._colR;
        if (funnelColliders && funnelColliders.length >= 2) {
            const f0 = funnelColliders[0];
            const f1 = funnelColliders[1];
            colL.x1 = f0.x1; colL.y1 = f0.y1; colL.x2 = f0.x2; colL.y2 = f0.y2;
            colR.x1 = f1.x1; colR.y1 = f1.y1; colR.x2 = f1.x2; colR.y2 = f1.y2;
        } else {
            colL.x1 = 69; colL.y1 = 485; colL.x2 = 281; colL.y2 = 570;
            colR.x1 = 531; colR.y1 = 485; colR.x2 = 319; colR.y2 = 570;
        }

        const particleSizeInfo = this.scene && this.scene.getParticleSize ? this.scene.getParticleSize() : null;
        const collisionScale = settings.particle_collision_scale !== undefined ? settings.particle_collision_scale : 1.20;
        const colDiameter = (particleSizeInfo ? particleSizeInfo.logicalSize : (this.spacing * imageScale)) * collisionScale;

        const spoutLeftX = Math.min(colL.x2, colR.x2);
        const spoutRightX = Math.max(colL.x2, colR.x2);
        const funnelBottomY = Math.max(colL.y2, colR.y2);
        const funnelTopY = Math.min(colL.y1, colR.y1);

        const colD2 = colDiameter * colDiameter;
        const pRadius = colDiameter * 0.5;
        const spoutHoleY = funnelBottomY - pRadius;

        // Keep spatial hash cell size dynamically synchronized with particle collision diameter
        const requiredCellSize = Math.max(colDiameter * 1.1, 4.0);
        if (Math.abs(this.colCellSize - requiredCellSize) > 0.2) {
            this.colCellSize = requiredCellSize;
            this.colOriginX = 0;
            this.colOriginY = 0;
            this.colGridCols = Math.ceil(650 / this.colCellSize) + 4;
            this.colGridRows = Math.ceil(950 / this.colCellSize) + 4;
            this.colGridHead = new Int32Array(this.colGridCols * this.colGridRows);
            this.colGridHead.fill(-1);
            this.dirtyCells = new Int32Array(this.colGridCols * this.colGridRows);
            this.dirtyCellCount = 0;
        }

        // Funnel wall slope tangents and sliding speed
        const lenL = Math.hypot(colL.x2 - colL.x1, colL.y2 - colL.y1) || 1;
        const tLx = (colL.x2 - colL.x1) / lenL;
        const tLy = (colL.y2 - colL.y1) / lenL;

        const lenR = Math.hypot(colR.x2 - colR.x1, colR.y2 - colR.y1) || 1;
        const tRx = (colR.x2 - colR.x1) / lenR;
        const tRy = (colR.y2 - colR.y1) / lenR;

        // Precomputed linear wall slope coefficients: wallX(y) = wallK * y + wallB
        // Eliminates repeated division inside getLeftWallX/getRightWallX on every hot-path call.
        const leftWallDY  = colL.y2 - colL.y1;
        const leftWallK   = leftWallDY > 0 ? (colL.x2 - colL.x1) / leftWallDY : 0;
        const leftWallB   = colL.x1 - leftWallK * colL.y1;
        const rightWallDY = colR.y2 - colR.y1;
        const rightWallK  = rightWallDY > 0 ? (colR.x2 - colR.x1) / rightWallDY : 0;
        const rightWallB  = colR.x1 - rightWallK * colR.y1;

        const slideSpeed = settings.sand_slide_speed !== undefined ? settings.sand_slide_speed : 500;
        const wallFriction = settings.funnel_wall_friction !== undefined ? settings.funnel_wall_friction : 0.45;
        const suctionStrength = settings.funnel_suction_strength !== undefined ? settings.funnel_suction_strength : 30;
        const fullConveyorSpeedScale = settings.conveyor_full_speed_scale !== undefined ? settings.conveyor_full_speed_scale : 0.25;
        const isSuctionActive = !isConveyorFull && suctionStrength > 0;

        const staticCellSize = this.spacing * imageScale;
        const halfCell = staticCellSize * 0.5;

        // Frame lateral walls (covering full image grid and container funnel)
        const frameLeftX = Math.min(colL.x1, (0 * this.spacing - this.offsetX) * imageScale + imgX - halfCell);
        const frameRightX = Math.max(colR.x1, ((this.width - 1) * this.spacing - this.offsetX) * imageScale + imgX + halfCell);

        // Exact funnel floor height across entire width
        const getFunnelFloorY = (x) => {
            if (x <= spoutLeftX) {
                const dx = spoutLeftX - colL.x1;
                const dy = funnelBottomY - colL.y1;
                if (dx <= 0) return funnelBottomY;
                const t = Math.max(0, Math.min(1, (x - colL.x1) / dx));
                return colL.y1 + t * dy;
            } else if (x >= spoutRightX) {
                const dx = colR.x1 - spoutRightX;
                const dy = funnelBottomY - colR.y1;
                if (dx <= 0) return funnelBottomY;
                const t = Math.max(0, Math.min(1, (colR.x1 - x) / dx));
                return colR.y1 + t * dy;
            } else {
                return funnelBottomY;
            }
        };

        const getLeftWallX = (y) => {
            if (y <= colL.y1) return colL.x1;
            const dy = colL.y2 - colL.y1;
            if (dy <= 0) return colL.x2;
            const t = Math.min(1, (y - colL.y1) / dy);
            return colL.x1 + t * (colL.x2 - colL.x1);
        };

        const getRightWallX = (y) => {
            if (y <= colR.y1) return colR.x1;
            const dy = colR.y2 - colR.y1;
            if (dy <= 0) return colR.x2;
            const t = Math.min(1, (y - colR.y1) / dy);
            return colR.x1 + t * (colR.x2 - colR.x1);
        };

        const positions = this.positions;
        const vx = this.vx;
        const vy = this.vy;
        const cellSize = this.colCellSize;
        const gridCols = this.colGridCols;
        const gridRows = this.colGridRows;
        const originX = this.colOriginX;
        const originY = this.colOriginY;
        const head = this.colGridHead;
        const next = this.colParticleNext;

        const rebuildSpatialHash = () => {
            if (!this.dirtyCells) {
                this.dirtyCells = new Int32Array(gridCols * gridRows);
                this.dirtyCellCount = 0;
            } else {
                for (let d = 0; d < this.dirtyCellCount; d++) {
                    head[this.dirtyCells[d]] = -1;
                }
                this.dirtyCellCount = 0;
            }
            for (let i = 0; i < this.activeCount; i++) {
                const p = this.activeIndices[i];
                const lx = positions[p * 2 + 0] * imageScale + imgX;
                const ly = positions[p * 2 + 1] * imageScale + imgY;
                const cx = Math.floor((lx - originX) / cellSize);
                const cy = Math.floor((ly - originY) / cellSize);
                if (cx >= 0 && cx < gridCols && cy >= 0 && cy < gridRows) {
                    const cellIdx = cy * gridCols + cx;
                    if (head[cellIdx] === -1) {
                        this.dirtyCells[this.dirtyCellCount++] = cellIdx;
                    }
                    next[p] = head[cellIdx];
                    head[cellIdx] = p;
                } else {
                    next[p] = -1;
                }
            }
        };

        // NOTE: The spatial hash from the previous tick's final STEP B is still valid
        // for resting-particle queries (isSupportedBelow / hasParticleAbove) because resting
        // particles do not move between ticks. The first STEP B inside the substep loop will
        // perform the first authoritative rebuild after STEP A has integrated positions.

        const hasParticleAbove = (p, lx, ly) => {
            const cx = Math.floor((lx - originX) / cellSize);
            const cy = Math.floor((ly - originY) / cellSize);
            for (let dcy = -1; dcy <= 0; dcy++) {
                const ncy = cy + dcy;
                if (ncy < 0 || ncy >= gridRows) continue;
                for (let dcx = -1; dcx <= 1; dcx++) {
                    const ncx = cx + dcx;
                    if (ncx < 0 || ncx >= gridCols) continue;
                    let other = head[ncy * gridCols + ncx];
                    while (other !== -1) {
                        if (other !== p) {
                            const oy = positions[other * 2 + 1] * imageScale + imgY;
                            const ox = positions[other * 2 + 0] * imageScale + imgX;
                            const dy = ly - oy; // positive if other is above p
                            const dx = Math.abs(lx - ox);
                            if (dy > 0.25 * colDiameter && dy <= 1.85 * colDiameter && dx <= 1.05 * colDiameter) {
                                return true;
                            }
                        }
                        other = next[other];
                    }
                }
            }
            return false;
        };

        const isSupportedBelow = (p, lx, ly) => {
            const floorY = getFunnelFloorY(lx) - pRadius;
            if (ly >= floorY - 5 || ly >= funnelBottomY - pRadius - 8) return true;

            const cx = Math.floor((lx - originX) / cellSize);
            const cy = Math.floor((ly - originY) / cellSize);
            for (let dcy = 0; dcy <= 1; dcy++) {
                const ncy = cy + dcy;
                if (ncy < 0 || ncy >= gridRows) continue;
                for (let dcx = -1; dcx <= 1; dcx++) {
                    const ncx = cx + dcx;
                    if (ncx < 0 || ncx >= gridCols) continue;
                    let other = head[ncy * gridCols + ncx];
                    while (other !== -1) {
                        if (other !== p) {
                            const oy = positions[other * 2 + 1] * imageScale + imgY;
                            const ox = positions[other * 2 + 0] * imageScale + imgX;
                            const dy = oy - ly; // positive if other is BELOW p
                            const dx = Math.abs(ox - lx);
                            if (dy > 0.20 * colDiameter && dy <= 1.85 * colDiameter && dx <= 1.15 * colDiameter) {
                                return true;
                            }
                        }
                        other = next[other];
                    }
                }
            }
            return false;
        };

        const funnelCenter = (spoutLeftX + spoutRightX) / 2;

        const getOuterLeftWallX = (y) => {
            if (y <= colL.y1) return frameLeftX;
            return getLeftWallX(y);
        };

        const getOuterRightWallX = (y) => {
            if (y <= colR.y1) return frameRightX;
            return getRightWallX(y);
        };

        const parabolaSpoutOffset = settings.parabola_spout_offset !== undefined ? settings.parabola_spout_offset : 20;
        const paraSpoutLeftX = spoutLeftX - parabolaSpoutOffset;
        const paraSpoutRightX = spoutRightX + parabolaSpoutOffset;

        // ── Throttled Boundary & Parabola Curve Evaluation ─────────────────────
        // Dynamic boundary math and curve shape evaluations are throttled to ~160ms
        // (within the 150–200ms range) because pile contours change gradually.
        // Cached boundary parameters are reused on intermediate physics frames.
        this._boundaryEvalAccumulator = (this._boundaryEvalAccumulator || 0) + dt;
        const conveyorFullJustChanged = (isConveyorFull !== this._lastIsConveyorFull);
        const shouldEvaluateBoundary = !this._boundaryInitialized
            || conveyorFullJustChanged
            || (this._boundaryEvalAccumulator >= (this._boundaryEvalInterval || 0.16));

        const rawPercent = settings.parabola_height_percent !== undefined
            ? settings.parabola_height_percent
            : (settings.parabola_height_ratio !== undefined
                ? settings.parabola_height_ratio * 100
                : (settings.dead_zone_height_ratio !== undefined ? settings.dead_zone_height_ratio * 100 : 70));
        const maxParabolaRatio = Math.max(0.05, Math.min(1.0, rawPercent > 1.0 ? rawPercent / 100.0 : rawPercent));
        const defaultRatio = maxParabolaRatio;
        if (this.leftParabolaRatio === undefined || this.leftParabolaRatio > maxParabolaRatio) this.leftParabolaRatio = defaultRatio;
        if (this.rightParabolaRatio === undefined || this.rightParabolaRatio > maxParabolaRatio) this.rightParabolaRatio = defaultRatio;

        const funnelHeight = Math.max(1, funnelBottomY - funnelTopY);
        const rawMinFreezeHeight = settings.parabola_min_freeze_height !== undefined
            ? settings.parabola_min_freeze_height
            : (settings.parabola_freeze_min_height !== undefined ? settings.parabola_freeze_min_height : 25);
        const minFreezeHeight = rawMinFreezeHeight <= 1.0 ? rawMinFreezeHeight * funnelHeight : rawMinFreezeHeight;
        const decelDuration = settings.parabola_deceleration_time !== undefined ? settings.parabola_deceleration_time : 4.0;

        const LUT_SIZE = 256;
        if (!this._lutLeftSurfaceX  || this._lutLeftSurfaceX.length  < LUT_SIZE) this._lutLeftSurfaceX  = new Float32Array(LUT_SIZE);
        if (!this._lutRightSurfaceX || this._lutRightSurfaceX.length < LUT_SIZE) this._lutRightSurfaceX = new Float32Array(LUT_SIZE);

        if (shouldEvaluateBoundary) {
            const evalDt = this._boundaryEvalAccumulator;
            this._boundaryEvalAccumulator = 0;
            this._boundaryInitialized = true;
            this._lastIsConveyorFull = isConveyorFull;

            // Merged single-pass scan: Mound height tracking AND moving particles on slope
            let leftFunnelPileY = funnelBottomY;
            let rightFunnelPileY = funnelBottomY;
            let leftAbovePileY = funnelTopY;
            let rightAbovePileY = funnelTopY;
            let movingOnLeft = 0;
            let movingOnRight = 0;

            for (let i = 0; i < this.activeCount; i++) {
                const p = this.activeIndices[i];
                const ly = positions[p * 2 + 1] * imageScale + imgY;
                if (ly < funnelTopY - 250 || ly >= funnelBottomY) continue;

                const lx = positions[p * 2 + 0] * imageScale + imgX;
                const s = this.states[p];
                const spdSq = vx[p] * vx[p] + vy[p] * vy[p];
                const stab = this.stability[p] || 0;

                // Moving particles on funnel slope (used for dynamic ratio adjustment)
                if (ly >= funnelTopY - 20 && ly < funnelBottomY - 35 && s === STATE_ACTIVE && spdSq > 40) {
                    if (lx < funnelCenter) {
                        movingOnLeft++;
                    } else {
                        movingOnRight++;
                    }
                }

                // Mound detection: only settled or supported particles define the mound
                const isResting = (s === STATE_RESTING || s === STATE_FUNNEL_RESTING);
                const isStable = (stab >= 0.25 && vy[p] < 25);
                const isSupported = (vy[p] < 20 && spdSq < 900 && isSupportedBelow(p, lx, ly));

                if (isResting || isStable || isSupported) {
                    if (ly >= funnelTopY) {
                        if (lx < funnelCenter) {
                            if (ly < leftFunnelPileY) leftFunnelPileY = ly;
                        } else {
                            if (ly < rightFunnelPileY) rightFunnelPileY = ly;
                        }
                    } else {
                        // Candidate for stacking above funnel rim
                        if (lx < funnelCenter) {
                            if (ly < leftAbovePileY) leftAbovePileY = ly;
                        } else {
                            if (ly < rightAbovePileY) rightAbovePileY = ly;
                        }
                    }
                }
            }

            // Only allow mound height above funnelTopY if the funnel is actually filled near the rim
            let leftPileY = leftFunnelPileY;
            if (leftFunnelPileY <= funnelTopY + 15 && leftAbovePileY < funnelTopY) {
                leftPileY = leftAbovePileY;
            }

            let rightPileY = rightFunnelPileY;
            if (rightFunnelPileY <= funnelTopY + 15 && rightAbovePileY < funnelTopY) {
                rightPileY = rightAbovePileY;
            }

            // Ratio adjustment:
            if (isConveyorFull) {
                // When conveyor is 100% full, restore full ratio immediately to hold sand
                this.leftParabolaRatio = maxParabolaRatio;
                this.rightParabolaRatio = maxParabolaRatio;
            } else {
                if (movingOnLeft < 2) {
                    this.leftParabolaRatio = Math.max(0.15, this.leftParabolaRatio - 0.03);
                } else {
                    this.leftParabolaRatio = Math.min(maxParabolaRatio, this.leftParabolaRatio + 0.05);
                }

                if (movingOnRight < 2) {
                    this.rightParabolaRatio = Math.max(0.15, this.rightParabolaRatio - 0.03);
                } else {
                    this.rightParabolaRatio = Math.min(maxParabolaRatio, this.rightParabolaRatio + 0.05);
                }
            }

            this.leftParabolaRatio = Math.min(maxParabolaRatio, Math.max(0.15, this.leftParabolaRatio));
            this.rightParabolaRatio = Math.min(maxParabolaRatio, Math.max(0.15, this.rightParabolaRatio));

            const leftHillHeight = Math.max(0, funnelBottomY - leftPileY);
            const rightHillHeight = Math.max(0, funnelBottomY - rightPileY);

            const targetLeftHeight = Math.max(0, leftHillHeight * this.leftParabolaRatio);
            const targetRightHeight = Math.max(0, rightHillHeight * this.rightParabolaRatio);

            if (this.currentLeftParabolaHeight === undefined) {
                this.currentLeftParabolaHeight = targetLeftHeight;
            }
            if (this.currentRightParabolaHeight === undefined) {
                this.currentRightParabolaHeight = targetRightHeight;
            }

            const descendRate = settings.parabola_descend_speed !== undefined ? settings.parabola_descend_speed : 80; // px/s
            const riseRate = settings.parabola_rise_speed !== undefined ? settings.parabola_rise_speed : 200; // px/s

            // ── Parabola Fuse Safeguard ──────────────────────────────────────────
            // If parabola height hasn't increased or decreased for 5 seconds, slowly and
            // forcibly decrease it until it starts decreasing according to the laws of its algorithm.
            const fuseTimeout = settings.parabola_fuse_timeout_sec !== undefined ? settings.parabola_fuse_timeout_sec : 5.0; // 5.0 seconds
            const fuseDescendRate = settings.parabola_fuse_descend_speed !== undefined ? settings.parabola_fuse_descend_speed : 35.0; // px/s forced decrease

            const isLeftStuck = (this.currentLeftParabolaHeight > 0.5) && (Math.abs(targetLeftHeight - this.currentLeftParabolaHeight) < 0.5);
            if (isLeftStuck && !isConveyorFull) {
                this._leftParabolaStuckTimer = (this._leftParabolaStuckTimer || 0) + evalDt;
            } else {
                this._leftParabolaStuckTimer = 0;
            }
            const isLeftFuseTriggered = (this._leftParabolaStuckTimer >= fuseTimeout);

            const isRightStuck = (this.currentRightParabolaHeight > 0.5) && (Math.abs(targetRightHeight - this.currentRightParabolaHeight) < 0.5);
            if (isRightStuck && !isConveyorFull) {
                this._rightParabolaStuckTimer = (this._rightParabolaStuckTimer || 0) + evalDt;
            } else {
                this._rightParabolaStuckTimer = 0;
            }
            const isRightFuseTriggered = (this._rightParabolaStuckTimer >= fuseTimeout);

            if (isConveyorFull) {
                // Clamping immediately when conveyor is full prevents sand mobilization
                this.currentLeftParabolaHeight = targetLeftHeight;
                this.currentRightParabolaHeight = targetRightHeight;
            } else {
                if (targetLeftHeight > this.currentLeftParabolaHeight + 0.5) {
                    this.currentLeftParabolaHeight = Math.min(targetLeftHeight, this.currentLeftParabolaHeight + riseRate * evalDt);
                } else if (targetLeftHeight < this.currentLeftParabolaHeight - 0.5) {
                    const diffL = this.currentLeftParabolaHeight - targetLeftHeight;
                    const effDescendL = Math.max(descendRate, diffL * 3.0);
                    this.currentLeftParabolaHeight = Math.max(targetLeftHeight, this.currentLeftParabolaHeight - effDescendL * evalDt);
                } else if (isLeftFuseTriggered) {
                    // Fuse triggered: forcibly and slowly decrease parabola height until natural algorithm descent takes over
                    this.currentLeftParabolaHeight = Math.max(0, this.currentLeftParabolaHeight - fuseDescendRate * evalDt);
                    this.leftParabolaRatio = Math.max(0.15, this.leftParabolaRatio - 0.02 * (evalDt / 0.16));
                }

                if (targetRightHeight > this.currentRightParabolaHeight + 0.5) {
                    this.currentRightParabolaHeight = Math.min(targetRightHeight, this.currentRightParabolaHeight + riseRate * evalDt);
                } else if (targetRightHeight < this.currentRightParabolaHeight - 0.5) {
                    const diffR = this.currentRightParabolaHeight - targetRightHeight;
                    const effDescendR = Math.max(descendRate, diffR * 3.0);
                    this.currentRightParabolaHeight = Math.max(targetRightHeight, this.currentRightParabolaHeight - effDescendR * evalDt);
                } else if (isRightFuseTriggered) {
                    // Fuse triggered: forcibly and slowly decrease parabola height until natural algorithm descent takes over
                    this.currentRightParabolaHeight = Math.max(0, this.currentRightParabolaHeight - fuseDescendRate * evalDt);
                    this.rightParabolaRatio = Math.max(0.15, this.rightParabolaRatio - 0.02 * (evalDt / 0.16));
                }
            }

            const leftParabolaHeight = this.currentLeftParabolaHeight;
            const rightParabolaHeight = this.currentRightParabolaHeight;

            const effectiveLeftMoundY = funnelBottomY - leftParabolaHeight;
            const effectiveRightMoundY = funnelBottomY - rightParabolaHeight;

            const maxContainerExtraHeight = Math.max(50, 350 * maxParabolaRatio);
            const maxPower = settings.parabola_curvature_coefficient !== undefined
                ? settings.parabola_curvature_coefficient
                : (settings.dead_zone_max_power !== undefined ? settings.dead_zone_max_power : 3.20);

            const getPowerForHeight = (parabolaHeight) => {
                if (parabolaHeight <= 0) return 1.0;
                if (parabolaHeight <= funnelHeight) {
                    const ratio = parabolaHeight / funnelHeight;
                    return 1.0 + 0.12 * Math.pow(ratio, 1.5);
                } else {
                    const extraHeight = parabolaHeight - funnelHeight;
                    const extraRatio = Math.max(0, Math.min(1.0, extraHeight / maxContainerExtraHeight));
                    return 1.12 + (maxPower - 1.12) * Math.pow(extraRatio, 1.15);
                }
            };

            const leftPower = getPowerForHeight(leftParabolaHeight);
            const rightPower = getPowerForHeight(rightParabolaHeight);

            const isLeftParabolaActive = (leftParabolaHeight >= minFreezeHeight && funnelBottomY > effectiveLeftMoundY);
            const isRightParabolaActive = (rightParabolaHeight >= minFreezeHeight && funnelBottomY > effectiveRightMoundY);

            const _lutStartY = Math.min(
                isLeftParabolaActive  ? effectiveLeftMoundY  : funnelBottomY,
                isRightParabolaActive ? effectiveRightMoundY : funnelBottomY
            );
            const _lutSpan    = funnelBottomY - _lutStartY;
            const _lutStep    = _lutSpan > 0 ? _lutSpan / (LUT_SIZE - 1) : 1;
            const _lutInvStep = _lutSpan > 0 ? 1.0 / _lutStep : 0;
            const _leftTopX   = isLeftParabolaActive  ? getOuterLeftWallX(effectiveLeftMoundY)  : frameLeftX;
            const _rightTopX  = isRightParabolaActive ? getOuterRightWallX(effectiveRightMoundY) : frameRightX;

            for (let _si = 0; _si < LUT_SIZE; _si++) {
                const _sLy = _lutStartY + _si * _lutStep;
                // Left side boundary X at this Y slice
                if (isLeftParabolaActive && _sLy >= effectiveLeftMoundY && _sLy <= funnelBottomY) {
                    const _span = funnelBottomY - effectiveLeftMoundY;
                    if (_span >= 5) {
                        const _t   = (_sLy - effectiveLeftMoundY) / _span;
                        const _cf  = 1.0 - Math.pow(1.0 - Math.max(0, Math.min(1, _t)), leftPower);
                        this._lutLeftSurfaceX[_si] = _leftTopX + (paraSpoutLeftX - _leftTopX) * _cf;
                    } else { this._lutLeftSurfaceX[_si] = -1e9; }
                } else { this._lutLeftSurfaceX[_si] = -1e9; }

                // Right side boundary X at this Y slice
                if (isRightParabolaActive && _sLy >= effectiveRightMoundY && _sLy <= funnelBottomY) {
                    const _span = funnelBottomY - effectiveRightMoundY;
                    if (_span >= 5) {
                        const _t   = (_sLy - effectiveRightMoundY) / _span;
                        const _cf  = 1.0 - Math.pow(1.0 - Math.max(0, Math.min(1, _t)), rightPower);
                        this._lutRightSurfaceX[_si] = _rightTopX - (_rightTopX - paraSpoutRightX) * _cf;
                    } else { this._lutRightSurfaceX[_si] = 1e9; }
                } else { this._lutRightSurfaceX[_si] = 1e9; }
            }

            // Cache computed values
            this._cachedLeftPileY = leftPileY;
            this._cachedRightPileY = rightPileY;
            this._cachedLeftParabolaHeight = leftParabolaHeight;
            this._cachedRightParabolaHeight = rightParabolaHeight;
            this._cachedEffectiveLeftMoundY = effectiveLeftMoundY;
            this._cachedEffectiveRightMoundY = effectiveRightMoundY;
            this._cachedLeftPower = leftPower;
            this._cachedRightPower = rightPower;
            this._cachedIsLeftParabolaActive = isLeftParabolaActive;
            this._cachedIsRightParabolaActive = isRightParabolaActive;
            this._cachedLutStartY = _lutStartY;
            this._cachedLutSpan = _lutSpan;
            this._cachedLutStep = _lutStep;
            this._cachedLutInvStep = _lutInvStep;
            this._cachedMinFreezeHeight = minFreezeHeight;
        }

        // Retrieve cached boundary and curve parameters across intermediate physics updates
        const leftParabolaHeight = this._cachedLeftParabolaHeight;
        const rightParabolaHeight = this._cachedRightParabolaHeight;
        const effectiveLeftMoundY = this._cachedEffectiveLeftMoundY;
        const effectiveRightMoundY = this._cachedEffectiveRightMoundY;
        const leftPower = this._cachedLeftPower;
        const rightPower = this._cachedRightPower;
        const isLeftParabolaActive = this._cachedIsLeftParabolaActive;
        const isRightParabolaActive = this._cachedIsRightParabolaActive;
        const _lutStartY = this._cachedLutStartY;
        const _lutSpan = this._cachedLutSpan;
        const _lutStep = this._cachedLutStep;
        const _lutInvStep = this._cachedLutInvStep;
        const _lutLeftSX = this._lutLeftSurfaceX;
        const _lutRightSX = this._lutRightSurfaceX;
        const moundPeakY = Math.min(effectiveLeftMoundY, effectiveRightMoundY);
        const _leftTopX = isLeftParabolaActive ? getOuterLeftWallX(effectiveLeftMoundY) : frameLeftX;
        const _rightTopX = isRightParabolaActive ? getOuterRightWallX(effectiveRightMoundY) : frameRightX;

        if (this.leftWallSlideBoost === undefined) this.leftWallSlideBoost = isLeftParabolaActive ? 0.0 : 1.0;
        if (this.rightWallSlideBoost === undefined) this.rightWallSlideBoost = isRightParabolaActive ? 0.0 : 1.0;

        const maxSlideBoost = settings.parabola_off_max_slide_boost !== undefined ? settings.parabola_off_max_slide_boost : 2.5;
        const slideBoostRate = settings.parabola_off_slide_boost_rate !== undefined ? settings.parabola_off_slide_boost_rate : 0.45;

        if (isLeftParabolaActive) {
            this.leftWallSlideBoost = 0.0;
        } else {
            this.leftWallSlideBoost = Math.min(maxSlideBoost, (this.leftWallSlideBoost || 0.0) + slideBoostRate * dt);
        }

        if (isRightParabolaActive) {
            this.rightWallSlideBoost = 0.0;
        } else {
            this.rightWallSlideBoost = Math.min(maxSlideBoost, (this.rightWallSlideBoost || 0.0) + slideBoostRate * dt);
        }

        const sideBoostLeft  = isConveyorFull ? 0.0 : (isLeftParabolaActive  ? 0.0 : (this.leftWallSlideBoost  !== undefined ? this.leftWallSlideBoost  : 1.0));
        const sideBoostRight = isConveyorFull ? 0.0 : (isRightParabolaActive ? 0.0 : (this.rightWallSlideBoost !== undefined ? this.rightWallSlideBoost : 1.0));
        const getSideBoost = (x) => x < funnelCenter ? sideBoostLeft : sideBoostRight;

        // ── Fast-Path Dead-Zone Query ───────────────────────────────────────────
        // Employs immediate bounding-box early exits before querying boundary geometry:
        // 1. Below / at funnel floor or strictly above the mound peak -> instantly false.
        // 2. Lateral limits outside spout aperture or outer container wall -> instantly false.
        // 3. O(1) indexed lookup into cached LUT without recalculating Math.pow per particle.
        const checkParabolaDeadZone = (lx, ly, p = -1) => {
            if (ly >= funnelBottomY || ly < _lutStartY) return false;

            if (lx < funnelCenter) {
                if (!isLeftParabolaActive || ly < effectiveLeftMoundY || lx >= paraSpoutLeftX || lx <= frameLeftX) return false;
                const _si = Math.min(LUT_SIZE - 1, Math.max(0, ((ly - _lutStartY) * _lutInvStep) | 0));
                return lx < _lutLeftSX[_si];
            } else {
                if (!isRightParabolaActive || ly < effectiveRightMoundY || lx <= paraSpoutRightX || lx >= frameRightX) return false;
                const _si = Math.min(LUT_SIZE - 1, Math.max(0, ((ly - _lutStartY) * _lutInvStep) | 0));
                return lx > _lutRightSX[_si];
            }
        };
        this.checkParabolaDeadZone = checkParabolaDeadZone;

        const isDebugParabola = !!(settings.debug_parabolas || settings.parabola_debug || settings.debug_parabola);
        if (isDebugParabola) {
            if (!this.debugParabolaGraphics && this.scene && this.scene.add) {
                this.debugParabolaGraphics = this.scene.add.graphics();
                this.debugParabolaGraphics.setDepth(15);
                if (this.scene.mainContainer) {
                    this.scene.mainContainer.add(this.debugParabolaGraphics);
                }
            }
        }

        if (this.debugParabolaGraphics) {
            this.debugParabolaGraphics.clear();
            if (isDebugParabola) {
                const gfx = this.debugParabolaGraphics;
                const minFreezeY = funnelBottomY - minFreezeHeight;

                // Threshold line for minFreezeHeight (yellow indicator line)
                gfx.lineStyle(1.5, 0xffea00, 0.65);
                gfx.lineBetween(frameLeftX + 5, minFreezeY, frameRightX - 5, minFreezeY);

                // ── Left Parabola Dead Zone Visualization ──
                if (isLeftParabolaActive && _lutSpan >= 5) {
                    // Semi-transparent fill of the dead-zone region
                    gfx.fillStyle(0x00e5ff, 0.22);
                    gfx.beginPath();
                    gfx.moveTo(_leftTopX, effectiveLeftMoundY);

                    // Inner curve downwards towards spout
                    for (let _si = 0; _si < LUT_SIZE; _si++) {
                        const _sLy = _lutStartY + _si * _lutStep;
                        if (_sLy >= effectiveLeftMoundY && _sLy <= funnelBottomY) {
                            const _sLx = _lutLeftSX[_si];
                            if (_sLx > -1e8) gfx.lineTo(_sLx, _sLy);
                        }
                    }

                    // Bottom across to left wall
                    const bWallX = getLeftWallX(funnelBottomY);
                    gfx.lineTo(paraSpoutLeftX, funnelBottomY);
                    gfx.lineTo(bWallX, funnelBottomY);

                    // Left wall up to funnel top
                    gfx.lineTo(colL.x1, colL.y1);

                    // Container wall up to mound height if mound is above funnel top
                    if (effectiveLeftMoundY < colL.y1) {
                        gfx.lineTo(frameLeftX, effectiveLeftMoundY);
                    }

                    gfx.closePath();
                    gfx.fillPath();

                    // Crisp boundary contour stroke
                    gfx.lineStyle(2.5, 0x00f0ff, 0.95);
                    gfx.beginPath();
                    let startedLeft = false;
                    for (let _si = 0; _si < LUT_SIZE; _si++) {
                        const _sLy = _lutStartY + _si * _lutStep;
                        if (_sLy >= effectiveLeftMoundY && _sLy <= funnelBottomY) {
                            const _sLx = _lutLeftSX[_si];
                            if (_sLx > -1e8) {
                                if (!startedLeft) {
                                    gfx.moveTo(_sLx, _sLy);
                                    startedLeft = true;
                                } else {
                                    gfx.lineTo(_sLx, _sLy);
                                }
                            }
                        }
                    }
                    gfx.strokePath();

                    // Top crest line
                    gfx.lineStyle(2, 0x00f0ff, 0.85);
                    gfx.lineBetween(_leftTopX, effectiveLeftMoundY, _lutLeftSX[0] > -1e8 ? _lutLeftSX[0] : _leftTopX, effectiveLeftMoundY);
                } else {
                    // Inactive mound height indicator (subtle cyan)
                    gfx.lineStyle(1.5, 0x00e5ff, 0.35);
                    gfx.lineBetween(frameLeftX + 5, effectiveLeftMoundY, funnelCenter - 10, effectiveLeftMoundY);
                }

                // ── Right Parabola Dead Zone Visualization ──
                if (isRightParabolaActive && _lutSpan >= 5) {
                    // Semi-transparent fill of the dead-zone region
                    gfx.fillStyle(0xff2a85, 0.22);
                    gfx.beginPath();
                    gfx.moveTo(_rightTopX, effectiveRightMoundY);

                    // Inner curve downwards towards spout
                    for (let _si = 0; _si < LUT_SIZE; _si++) {
                        const _sLy = _lutStartY + _si * _lutStep;
                        if (_sLy >= effectiveRightMoundY && _sLy <= funnelBottomY) {
                            const _sRx = _lutRightSX[_si];
                            if (_sRx < 1e8) gfx.lineTo(_sRx, _sLy);
                        }
                    }

                    // Bottom across to right wall
                    const bWallXR = getRightWallX(funnelBottomY);
                    gfx.lineTo(paraSpoutRightX, funnelBottomY);
                    gfx.lineTo(bWallXR, funnelBottomY);

                    // Right wall up to funnel top
                    gfx.lineTo(colR.x1, colR.y1);

                    // Container wall up to mound height if mound is above funnel top
                    if (effectiveRightMoundY < colR.y1) {
                        gfx.lineTo(frameRightX, effectiveRightMoundY);
                    }

                    gfx.closePath();
                    gfx.fillPath();

                    // Crisp boundary contour stroke
                    gfx.lineStyle(2.5, 0xff2a85, 0.95);
                    gfx.beginPath();
                    let startedRight = false;
                    for (let _si = 0; _si < LUT_SIZE; _si++) {
                        const _sLy = _lutStartY + _si * _lutStep;
                        if (_sLy >= effectiveRightMoundY && _sLy <= funnelBottomY) {
                            const _sRx = _lutRightSX[_si];
                            if (_sRx < 1e8) {
                                if (!startedRight) {
                                    gfx.moveTo(_sRx, _sLy);
                                    startedRight = true;
                                } else {
                                    gfx.lineTo(_sRx, _sLy);
                                }
                            }
                        }
                    }
                    gfx.strokePath();

                    // Top crest line
                    gfx.lineStyle(2, 0xff2a85, 0.85);
                    gfx.lineBetween(_rightTopX, effectiveRightMoundY, _lutRightSX[0] < 1e8 ? _lutRightSX[0] : _rightTopX, effectiveRightMoundY);
                } else {
                    // Inactive mound height indicator (subtle magenta)
                    gfx.lineStyle(1.5, 0xff2a85, 0.35);
                    gfx.lineBetween(funnelCenter + 10, effectiveRightMoundY, frameRightX - 5, effectiveRightMoundY);
                }
            }
        }

        // Wake exposed and surface resting particles outside dead zone
        // Zero-allocation candidate collection using pre-allocated typed arrays
        if (true) {
            const maxWake = settings.funnel_wake_rate !== undefined ? settings.funnel_wake_rate : 3;
            let wakeCount = 0;

            for (let i = 0; i < this.activeCount; i++) {
                const p = this.activeIndices[i];
                const s = this.states[p];
                if (s === STATE_RESTING || s === STATE_FUNNEL_RESTING) {
                    const lx = positions[p * 2 + 0] * imageScale + imgX;
                    const ly = positions[p * 2 + 1] * imageScale + imgY;

                    // Ensure spout exit is never physically blocked by resting grains
                    const isDirectSpoutExit = (ly >= funnelBottomY - 25 && lx >= spoutLeftX && lx <= spoutRightX);
                    if (isDirectSpoutExit) {
                        this.states[p] = STATE_ACTIVE;
                        this.stability[p] = 0;
                        if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                        this.fallStartY[p] = positions[p * 2 + 1];
                        this.vy[p] = Math.min(slideSpeed * 0.6, 25);
                        this.vx[p] = (Math.random() - 0.5) * 8;
                        this.stationaryFrames[p] = 0;
                        continue;
                    }

                    // ANTI-FLOATING CHECK: If unsupported from below, particle MUST wake up and fall!
                    if (!isSupportedBelow(p, lx, ly)) {
                        this.states[p] = STATE_ACTIVE;
                        this.stability[p] = 0;
                        if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                        this.fallStartY[p] = positions[p * 2 + 1];
                        this.vy[p] = Math.min(slideSpeed * 0.5, Math.max(vy[p], 15));
                        this.stationaryFrames[p] = 0;
                        continue;
                    }

                    // Check if particle is inside the opposite-bent parabola dead zone (fast-path bounding-box query)
                    const inDeadZone = checkParabolaDeadZone(lx, ly, p);
                    const sideActive = (lx < funnelCenter) ? isLeftParabolaActive : isRightParabolaActive;

                    // If parabola is OFF on this side, mobilize ALL resting particles on this side immediately!
                    if (!sideActive) {
                        this.states[p] = STATE_ACTIVE;
                        this.stability[p] = 0;
                        if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                        this.fallStartY[p] = positions[p * 2 + 1];
                        const sideBoost = getSideBoost(lx);
                        this.vy[p] = Math.max(vy[p], Math.min(slideSpeed * sideBoost * 0.4, 40));
                        const rollDir = (lx < funnelCenter) ? 1 : -1;
                        this.vx[p] = rollDir * Math.min(slideSpeed * sideBoost * 0.3, 30);
                        this.stationaryFrames[p] = 0;
                        continue;
                    }

                    // If hill descended, particles formerly in dead zone transition out
                    if (s === STATE_FUNNEL_RESTING && !inDeadZone) {
                        this.states[p] = STATE_RESTING;
                    }

                    if (inDeadZone) continue;

                    // Rate-limit waking from the dead zone so particles do not become mobile all at once
                    if (wakeCount >= maxWake) {
                        continue;
                    }
                    wakeCount++;

                    // Mobilize gently with a natural downhill roll rather than explosive burst
                    this.states[p] = STATE_ACTIVE;
                    this.stability[p] = 0.25;
                    if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                    this.fallStartY[p] = positions[p * 2 + 1];
                    this.vy[p] = Math.min(slideSpeed * 0.4, Math.max(vy[p], 10));
                    const rollDir = (lx < funnelCenter) ? 1 : -1;
                    this.vx[p] = rollDir * Math.min(slideSpeed * 0.3, 8) + (Math.random() - 0.5) * 4;
                    this.stationaryFrames[p] = 0;
                    continue;
                }
            }
        }

        // Check if any particles are actively moving or detached
        let activeMovingCount = 0;
        let restingCount = 0;
        for (let k = 0; k < this.activeCount; k++) {
            const s = this.states[this.activeIndices[k]];
            if (s === STATE_ACTIVE) {
                activeMovingCount++;
            } else if (s === STATE_RESTING || s === STATE_FUNNEL_RESTING) {
                restingCount++;
            }
        }
        this.hasMovingParticles = (activeMovingCount > 0);



        if (activeMovingCount === 0) {
            return false;
        }

        // Sub-stepped physics simulation: more iterations = better solver convergence against walls.
        // 4 sub-steps provide sufficient numerical stability with CCD velocity clamping already in place;
        // tunable via physics_sub_steps in game-settings.json (default 4).
        const subSteps = settings.physics_sub_steps !== undefined ? settings.physics_sub_steps : 2;
        const subDt = dt / subSteps;
        const dtScale = dt / 0.0166666;

        // Unrestricted spout despawn budget directly matching available conveyor capacity (no portioning/batching)
        const frameCullBudget = isConveyorFull ? 0 : freeCapacity;
        let despawnedThisFrame = 0;

        // CCD-like velocity clamp: max displacement per sub-step = particle diameter
        // This prevents tunneling through neighbor collision radii
        const maxVPerSubStep = colDiameter / subDt;

        const w = this.width;
        const h = this.height;
        const spacing = this.spacing;
        const offsetX = this.offsetX;
        const offsetY = this.offsetY;
        const staticGrid = this.staticGrid;

        // Calculate dynamic crowd friction scaling based on number of active particles in the funnel and mound
        let activeFunnelCount = 0;
        const funnelMoundThresholdY = Math.min(funnelTopY - 20, moundPeakY);
        for (let k = 0; k < this.activeCount; k++) {
            const ap = this.activeIndices[k];
            if (this.states[ap] === STATE_ACTIVE) {
                const py = positions[ap * 2 + 1] * imageScale + imgY;
                if (py >= funnelMoundThresholdY) activeFunnelCount++;
            }
        }

        const crowdScale = settings.funnel_crowd_friction_scale !== undefined ? settings.funnel_crowd_friction_scale : 1.0;
        const crowdThreshold = settings.funnel_crowd_threshold !== undefined ? settings.funnel_crowd_threshold : 1000;
        const calmingMinParticles = settings.funnel_calming_min_particles !== undefined
            ? settings.funnel_calming_min_particles
            : (settings.calming_min_particles !== undefined ? settings.calming_min_particles : 200);
        const allowCalming = activeFunnelCount >= calmingMinParticles;

        // Temporal moving average of funnel particle count to prevent frame-to-frame discrete jumps
        if (this.smoothFunnelCount === undefined) {
            this.smoothFunnelCount = activeFunnelCount;
        } else {
            this.smoothFunnelCount = this.smoothFunnelCount * 0.90 + activeFunnelCount * 0.10;
        }

        // massRatio ranges 0.0 (empty funnel / small mass) to 1.0 (full 1000+ particles)
        const massRatio = Math.min(1.0, (this.smoothFunnelCount / crowdThreshold) * (crowdScale / 2.0));
        // Cubic Hermite smoothstep (zero derivative at endpoints) for smooth, seamless acceleration onset
        const rawProg = Math.max(0.0, 1.0 - massRatio);
        const slideProgression = rawProg * rawProg * (3.0 - 2.0 * rawProg);

        // Calming & stability rules only active when particles in funnel >= calmingMinParticles
        const maxFunnelStab = allowCalming ? Math.min(1.0, Math.pow(massRatio, 1.3)) : 0;

        // Boundary zone for funnel walls: covers particles touching the funnel wall (Layer 1)
        // and those touching them (Layer 2). Transmits impulses 3x weaker to prevent over-mobilizing lower layers.
        const wallZoneThreshold = colDiameter * 2.3;
        const checkWallZone = (x, y) => {
            if (y < funnelTopY - 5) return false;
            const dLeft = x - (getLeftWallX(y) + pRadius);
            if (dLeft <= wallZoneThreshold) return true;
            const dRight = (getRightWallX(y) - pRadius) - x;
            if (dRight <= wallZoneThreshold) return true;
            const dBottom = (funnelBottomY - pRadius) - y;
            if (dBottom <= wallZoneThreshold) return true;
            return false;
        };


        for (let step = 0; step < subSteps; step++) {
            // Natural stability decay: if allowCalming is false (< 200 particles), stability drops to 0 and resting particles wake up
            const baseDecayRaw = allowCalming ? (0.30 + 0.65 * massRatio) : 0;
            const baseDecay = baseDecayRaw > 0 ? Math.pow(baseDecayRaw, dtScale) : 0;
            for (let i = 0; i < this.activeCount; i++) {
                const p = this.activeIndices[i];
                if (this.states[p] === STATE_RESTING || this.states[p] === STATE_FUNNEL_RESTING) {
                    if (allowCalming) {
                        this.stability[p] = 1.0;
                    } else {
                        this.stability[p] -= dt * 1.5;
                        if (this.stability[p] <= 0) {
                            this.stability[p] = 0;
                            this.states[p] = STATE_ACTIVE;
                            this.stationaryFrames[p] = 0;
                        }
                    }
                    continue;
                } else {
                    this.stability[p] = Math.min(maxFunnelStab, (this.stability[p] || 0) * baseDecay);
                }
            }

            // STEP A: Motion integration
            for (let i = 0; i < this.activeCount; i++) {
                const p = this.activeIndices[i];
                if (this.states[p] !== STATE_ACTIVE) continue;

                const stab = this.stability[p] || 0;

                let lx = positions[p * 2 + 0] * imageScale + imgX;
                let ly = positions[p * 2 + 1] * imageScale + imgY;
                const inPile = ly >= moundPeakY;
                const inFunnel = ly >= funnelTopY;
                // Inline O(1) side-boost lookup — avoids function call overhead on every particle every substep
                const sideBoost = lx < funnelCenter ? sideBoostLeft : sideBoostRight;
                const sideParabolaActive = (lx < funnelCenter) ? isLeftParabolaActive : isRightParabolaActive;

                // 1. Inertial gravity: supported particles in pile have normal force counteracting downward gravity
                const supportFactor = Math.min(1.0, stab * (isConveyorFull ? 1.0 : 0.85));
                const normalOpposedGravity = gravity * (1.0 - supportFactor * 0.90);

                if (inFunnel) {
                    if (sideParabolaActive || sideBoost <= 0.001) {
                        // While parabola is active, standard downward gravity without sliding boost
                        vy[p] += normalOpposedGravity * subDt;
                    } else {
                        const effSlideSpeed = Math.max(15, slideSpeed * sideBoost);
                        const speedRatio = Math.min(1.0, Math.max(0, vy[p] / effSlideSpeed));
                        const effGravity = normalOpposedGravity * (1.0 - speedRatio * 0.88);
                        vy[p] += effGravity * subDt;

                        // When parabola is OFF on this side AND conveyor is NOT full, add slope tangent drive to propel particles down the incline towards the spout
                        if (!isConveyorFull && sideBoost > 0) {
                            const slopeDrive = Math.min(effSlideSpeed * 3.0, 350 * sideBoost) * wallSlideFactor;
                            if (lx < funnelCenter) {
                                vx[p] += tLx * slopeDrive * subDt;
                                vy[p] += tLy * slopeDrive * subDt;
                            } else {
                                vx[p] += tRx * slopeDrive * subDt;
                                vy[p] += tRy * slopeDrive * subDt;
                            }
                        }
                    }
                } else if (inPile) {
                    vy[p] += normalOpposedGravity * subDt;
                } else {
                    vy[p] += gravity * subDt;
                }

                // 2. Fluid motion drag: smoothly reduced in the funnel as mass shrinks
                const airDampX = Math.pow(inFunnel ? (0.998 - 0.015 * massRatio) : 0.985, dtScale);
                const airDampY = Math.pow(inFunnel ? (0.999 - 0.008 * massRatio) : 0.99, dtScale);
                vx[p] *= airDampX * (1.0 - 0.15 * stab);
                vy[p] *= airDampY * (1.0 - 0.15 * stab);

                // Calming & smooth deceleration inside parabola dead zone over decelDuration (~4.0s)
                // Falling particles do NOT slow down; only slow down after contact with funnel walls or already slowed particles
                const touchedOrSlow = this.hasDecelContact ? (this.hasDecelContact[p] === 1) : false;
                const _isInDZ = sideParabolaActive && touchedOrSlow && checkParabolaDeadZone(lx, ly, p);
                if (_isInDZ) {
                    this.deadZoneTimer[p] = (this.deadZoneTimer[p] || 0) + subDt;
                    const decelProgress = Math.min(1.0, this.deadZoneTimer[p] / decelDuration);

                    // Height depth factor: 0.0 at the top of parabola (located above), 1.0 at funnel bottom (located below)
                    const moundY = (lx < funnelCenter) ? effectiveLeftMoundY : effectiveRightMoundY;
                    const parabolaSpan = Math.max(15, funnelBottomY - moundY);
                    const depthFactor = Math.max(0.0, Math.min(1.0, (ly - moundY) / parabolaSpan));

                    // Depth multiplier: particles located above slow down significantly less (starting at ~0.12),
                    // while particles located below (even if still falling) slow down strongly (up to 1.0+).
                    const depthMult = 0.12 + 0.88 * Math.pow(depthFactor, 1.3);

                    // Base time ramp + height gradient:
                    // Newly entered particles at the top feel almost zero damping (dampRate ~0.04/s).
                    // Falling particles located below feel much stronger braking (dampRate up to 2.5+/s).
                    const baseDampRate = 0.35 + 2.4 * decelProgress * decelProgress;
                    const fallBrake = (depthFactor > 0.35 && vy[p] > 15) ? (depthFactor * 1.8) : 0.0;
                    const dampRate = baseDampRate * depthMult + fallBrake;

                    const dzDamp = Math.exp(-dampRate * subDt);
                    vx[p] *= dzDamp;
                    vy[p] *= dzDamp;

                    // Micro-jitter suppression / fast-path sleep: only after full deceleration period AND near bottom / resting
                    const effDuration = decelDuration * (1.35 - 0.60 * depthFactor);
                    if (this.deadZoneTimer[p] >= effDuration && (vx[p] * vx[p] + vy[p] * vy[p] < 4)) {
                        vx[p] = 0;
                        vy[p] = 0;
                        this.stability[p] = 1.0;
                        this.states[p] = STATE_FUNNEL_RESTING;
                        this.stationaryFrames[p] = 0;
                        continue; // Skip position write and STEP C for this particle
                    }
                } else {
                    if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                    if (sideParabolaActive && allowCalming && stab > 0.4 && massRatio > 0.4) {
                        const speed = Math.hypot(vx[p], vy[p]);
                        if (speed > 30) {
                            const calmDamp = Math.pow(0.94, dtScale);
                            vx[p] *= calmDamp;
                            vy[p] *= calmDamp;
                        }
                    }
                }

                // Smooth inertial terminal velocity inside funnel chute governed by sand_slide_speed * sideBoost
                if (inFunnel && !sideParabolaActive && sideBoost > 0) {
                    const currentSpd = Math.hypot(vx[p], vy[p]);
                    const targetMaxSpd = Math.max(20, slideSpeed * sideBoost);
                    if (currentSpd > targetMaxSpd) {
                        const excess = currentSpd - targetMaxSpd;
                        const drag = Math.min(excess, (excess * 6.0 + 80.0) * subDt);
                        const damp = (currentSpd - drag) / currentSpd;
                        vx[p] *= damp;
                        vy[p] *= damp;
                    }
                }

                // Funnel opening suction: draws particles into the spout aperture
                // Completely turned OFF when the conveyor is 100% full (or if funnel_suction_strength <= 0)
                if (isSuctionActive && ly >= funnelBottomY - 70 && ly <= funnelBottomY + 5) {
                    const distToCenter = funnelCenter - lx;
                    const suctionZoneRadius = (spoutRightX - spoutLeftX) * 1.5;
                    if (Math.abs(distToCenter) <= suctionZoneRadius) {
                        const factor = 1.0 - (Math.abs(distToCenter) / suctionZoneRadius);
                        const pullX = Math.sign(distToCenter) * suctionStrength * factor;
                        const pullY = suctionStrength * 0.6 * factor;
                        vx[p] += pullX * subDt;
                        vy[p] += pullY * subDt;
                    }
                }

                // 3. Wake-up ripple: only break stability if there is massive displacement
                if (stab > 0.1 && (vy[p] > 180 || Math.abs(vx[p]) > 180)) {
                    this.stability[p] = 0;
                }

                const maxV = Math.min(1500, maxVPerSubStep * 1.25);
                if (Math.abs(vx[p]) > maxV) vx[p] = Math.sign(vx[p]) * maxV;
                if (Math.abs(vy[p]) > maxV) vy[p] = Math.sign(vy[p]) * maxV;
                this.preStepY[p] = ly;

                lx += vx[p] * subDt;
                ly += vy[p] * subDt;

                // Color tint removal when leaving the picture frame into the funnel
                if (ly >= funnelTopY && this.isTinted[p]) {
                    this.restoreOriginalColor(p);
                }

                positions[p * 2 + 0] = (lx - imgX) / imageScale;
                positions[p * 2 + 1] = (ly - imgY) / imageScale;
                this.markDirty(p);
            }

            // STEP B: Rebuild unified spatial hash using dirty cell list tracking (only clear occupied cells)
            rebuildSpatialHash();

            // STEP C: Dynamic Particle-Particle Collisions in Unified Space
            // Opt 2 — Conditional 2nd relaxation pass: skip pass=1 unless at least one active particle
            // is inside the narrow spout compression zone (ly >= funnelBottomY - spoutPassThreshold).
            // When the mound is held by the parabola and no sand is near the spout (~50–70% of frames),
            // this cuts the O(N·k) sweep count from 8 → 4 per tick with no loss in flow quality.
            const _spoutZoneThreshold = funnelBottomY - 48;
            let _needsPass1 = false;
            for (let _pi = 0; _pi < this.activeCount; _pi++) {
                const _pp = this.activeIndices[_pi];
                if (this.states[_pp] === STATE_ACTIVE) {
                    if (positions[_pp * 2 + 1] * imageScale + imgY >= _spoutZoneThreshold) {
                        _needsPass1 = true;
                        break;
                    }
                }
            }
            for (let pass = 0; pass < 2; pass++) {
                if (pass === 1 && !_needsPass1) break;
                for (let i = 0; i < this.activeCount; i++) {
                    const p = this.activeIndices[i];
                    if (this.states[p] !== STATE_ACTIVE) continue;

                    let px = positions[p * 2 + 0] * imageScale + imgX;
                    let py = positions[p * 2 + 1] * imageScale + imgY;
                    const pIsAboveFunnel = py < funnelTopY;
                    const stabP = this.stability[p] || 0;

                    const cx = Math.floor((px - originX) / cellSize);
                    const cy = Math.floor((py - originY) / cellSize);

                    for (let dy = -1; dy <= 1; dy++) {
                        const ny = cy + dy;
                        if (ny < 0 || ny >= gridRows) continue;

                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = cx + dx;
                            if (nx < 0 || nx >= gridCols) continue;

                            let other = head[ny * gridCols + nx];
                            while (other !== -1) {
                                if (other !== p) {
                                    const otherState = this.states[other];
                                    if (otherState === STATE_RESTING || p < other) {
                                        let ox = positions[other * 2 + 0] * imageScale + imgX;
                                        let oy = positions[other * 2 + 1] * imageScale + imgY;

                                        // Safe Fall-Phase Mutual Collision Bypass (Ghost Fall with Terrain Guardrails):
                                        // Bypass mutual particle-particle distance resolution when both particles are in airborne free-fall above the mound
                                        const freeAirY = moundPeakY - 25;
                                        if (py < freeAirY && oy < freeAirY
                                            && otherState !== STATE_RESTING && otherState !== STATE_FUNNEL_RESTING
                                            && stabP <= 0.3 && (this.stability[other] || 0) <= 0.3) {
                                            other = next[other];
                                            continue;
                                        }

                                        let diffX = px - ox;
                                        let diffY = py - oy;
                                        let dist2 = diffX * diffX + diffY * diffY;

                                        if (dist2 < colD2) {
                                            let dist = Math.sqrt(dist2);
                                            if (dist < 0.001) {
                                                dist = 0.001;
                                                diffX = (p % 2 === 0 ? 0.05 : -0.05);
                                                diffY = -0.001;
                                            }

                                            const normX = diffX / dist;
                                            const normY = diffY / dist;
                                            const overlap = colDiameter - dist;

                                            // Transfer stability between touching particles via direct contact propagation
                                            const stabO = this.stability[other] || 0;
                                            if (stabO > stabP) {
                                                this.stability[p] = Math.min(maxFunnelStab, Math.max(stabP, stabO * 0.95));
                                            } else if (stabP > stabO) {
                                                this.stability[other] = Math.min(maxFunnelStab, Math.max(stabO, stabP * 0.95));
                                            }

                                            const maxStab = Math.max(this.stability[p], this.stability[other]);
                                            const contactMobility = Math.max(0.08, 1.0 - maxStab * 0.88);

                                            if (this.hasDecelContact) {
                                                const pSlow = (this.hasDecelContact[p] === 1) || (stabP >= 0.3);
                                                const oSlow = (otherState === STATE_RESTING || otherState === STATE_FUNNEL_RESTING)
                                                    || (this.hasDecelContact[other] === 1) || (stabO >= 0.3);
                                                if (oSlow) this.hasDecelContact[p] = 1;
                                                if (pSlow) this.hasDecelContact[other] = 1;
                                            }

                                            if (otherState === STATE_RESTING || otherState === STATE_FUNNEL_RESTING) {
                                                if (this.hasTouchedWall) {
                                                    if (this.hasTouchedWall[other] === 1 && px < funnelCenter) this.hasTouchedWall[p] = 1;
                                                    else if (this.hasTouchedWall[other] === 2 && px >= funnelCenter) this.hasTouchedWall[p] = 2;
                                                }
                                                // Fast-path dead-zone lookup for active particle hitting resting one
                                                const isInsideDeadZone = checkParabolaDeadZone(px, py, p);
                                                const moundY = (px < funnelCenter) ? effectiveLeftMoundY : effectiveRightMoundY;
                                                const isAboveParabola = (!isInsideDeadZone || py <= moundY + 15);

                                                if (isAboveParabola) {
                                                    this.stability[p] = 0;
                                                    const rollDir = (py >= funnelTopY && (isSuctionActive || isConveyorFull))
                                                        ? ((px < funnelCenter) ? 1 : -1)
                                                        : ((diffX > 0.4) ? 1 : ((diffX < -0.4) ? -1 : ((px >= funnelCenter) ? -1 : 1)));
                                                    // Full firm non-penetrating separation from resting particle

                                                    // Smooth inertial roll acceleration scaled by sideBoost or fullConveyorSpeedScale
                                                    const sideBoost = getSideBoost(px);
                                                    const fullScale = isConveyorFull ? fullConveyorSpeedScale : 1.0;
                                                    const effSlide = Math.max(15, slideSpeed * Math.max(sideBoost, isConveyorFull ? 0.25 : 0.35)) * fullScale;
                                                    const targetRollVx = rollDir * effSlide * 0.85;
                                                    const rollAccel = Math.max(140, effSlide * 2.5) * subDt;
                                                    if (rollDir > 0) {
                                                        vx[p] = Math.min(targetRollVx, vx[p] + rollAccel);
                                                    } else {
                                                        vx[p] = Math.max(targetRollVx, vx[p] - rollAccel);
                                                    }
                                                    const targetRollVy = effSlide * 0.70;
                                                    const rollVyAccel = Math.max(100, effSlide * 2.0) * subDt;
                                                    vy[p] = Math.min(targetRollVy, vy[p] + rollVyAccel);
                                                    this.stationaryFrames[p] = 0;
                                                } else {
                                                    const sideParabolaActive = (px < funnelCenter) ? isLeftParabolaActive : isRightParabolaActive;
                                                    if (sideParabolaActive) {
                                                        const curTimer = this.deadZoneTimer ? this.deadZoneTimer[p] : 0;
                                                        const decelProgress = Math.min(1.0, curTimer / decelDuration);
                                                        this.stability[p] = Math.min(maxFunnelStab, Math.max(this.stability[p], 0.3 + 0.66 * decelProgress));
                                                    } else {
                                                        this.stability[p] = 0;
                                                    }

                                                    // Wake resting particle if it receives downward kinetic impact from an active particle
                                                    const rvy = vy[p] - vy[other];
                                                    if (rvy > 50 || vy[p] > 60) {
                                                        // Immunity check: particles strictly inside the parabolic dead zone ignore impacts
                                                        // Fast-path dead-zone lookup for the resting OTHER particle
                                                        let ox = positions[other * 2 + 0] * imageScale + imgX;
                                                        let oy = positions[other * 2 + 1] * imageScale + imgY;
                                                        const _otherNotInDZ = !checkParabolaDeadZone(ox, oy, other);
                                                        if (_otherNotInDZ) {
                                                            this.states[other] = STATE_ACTIVE;
                                                            this.stationaryFrames[other] = 0;
                                                        }
                                                    }

                                                    // Sound Trigger: falling active particle collides with an already settled particle
                                                    const currentY = this.positions[p * 2 + 1];
                                                    const fallDist = (currentY - this.fallStartY[p]) * imageScale;
                                                    if (fallDist >= SOUND_FALL_HEIGHT_DEAD_ZONE) {
                                                        this.playSandCollisionSound(fallDist, vy[p]);
                                                        this.fallStartY[p] = currentY; // Reset to avoid re-triggering during contact roll
                                                    }

                                                    // Resting particle in heap (whether in funnel or inside picture!)
                                                    if (normY < -0.15 && maxStab < 0.35) {
                                                        // On top of resting particle: roll toward center spout in funnel when chute is draining
                                                        let rollDir;
                                                        if (py >= funnelTopY && !isConveyorFull) {
                                                            rollDir = (px < funnelCenter) ? 1 : -1;
                                                        } else {
                                                            rollDir = (diffX > 0.4) ? 1 : ((diffX < -0.4) ? -1 : ((px >= funnelCenter) ? -1 : 1));
                                                            if (p % 2 === 0 && Math.abs(diffX) <= 0.4) rollDir = -rollDir;
                                                        }

                                                        const inDeadZone = checkParabolaDeadZone(px, py, p);
                                                        if (inDeadZone) {
                                                            // Inside dead zone: firm non-penetrating separation and gentle roll scaled down as particle stabilizes

                                                            const curTimer = this.deadZoneTimer ? this.deadZoneTimer[p] : 0;
                                                            const decelProgress = Math.min(1.0, curTimer / decelDuration);
                                                            const moundY = (px < funnelCenter) ? effectiveLeftMoundY : effectiveRightMoundY;
                                                            const parabolaSpan = Math.max(15, funnelBottomY - moundY);
                                                            const depthFactor = Math.max(0.0, Math.min(1.0, (py - moundY) / parabolaSpan));

                                                            const vDotN = vx[p] * normX + vy[p] * normY;
                                                            if (vDotN < 0) {
                                                                vx[p] -= vDotN * normX;
                                                                vy[p] -= vDotN * normY;
                                                            }
                                                            // Particles located above roll with much more freedom than particles located below
                                                            const rollSpeedScale = Math.max(0.05, (1.0 - decelProgress * (0.35 + 0.65 * depthFactor)) * (1.25 - 0.75 * depthFactor));
                                                            const effSlide = Math.max(10, slideSpeed * 0.25 * rollSpeedScale);
                                                            const targetRollVx = rollDir * effSlide * 0.85;
                                                            const rollAccel = Math.max(100, effSlide * 2.0) * subDt;
                                                            if (rollDir > 0) {
                                                                vx[p] = Math.min(targetRollVx, vx[p] + rollAccel);
                                                            } else {
                                                                vx[p] = Math.max(targetRollVx, vx[p] - rollAccel);
                                                            }
                                                            const targetRollVy = effSlide * 0.70;
                                                            const rollVyAccel = Math.max(80, effSlide * 1.8) * subDt;
                                                            vy[p] = Math.min(targetRollVy, vy[p] + rollVyAccel);
                                                        } else if (Math.abs(normX) < 0.70) {
                                                            // Outside dead zone: smooth roll down slope of heap with full separation out of resting particle

                                                            const effSlide = Math.max(slideSpeed, 30) * Math.max(0.35, sideBoost);
                                                            const targetRollVx = rollDir * effSlide * 0.85;
                                                            const rollAccel = Math.max(140, effSlide * 2.5) * subDt;
                                                            if (rollDir > 0) {
                                                                vx[p] = Math.min(targetRollVx, vx[p] + rollAccel);
                                                            } else {
                                                                vx[p] = Math.max(targetRollVx, vx[p] - rollAccel);
                                                            }
                                                            const targetRollVy = effSlide * 0.70;
                                                            const rollVyAccel = Math.max(100, effSlide * 2.0) * subDt;
                                                            vy[p] = Math.min(targetRollVy, vy[p] + rollVyAccel);
                                                            this.stationaryFrames[p] = 0;
                                                        } else {
                                                            // Supported on flank outside dead zone
                                                            px += normX * overlap;
                                                            py += normY * overlap;
                                                            const vDotN = vx[p] * normX + vy[p] * normY;
                                                            if (vDotN < 0) {
                                                                vx[p] -= vDotN * normX;
                                                                vy[p] -= vDotN * normY;
                                                            }
                                                            const flankDampX = sideBoost > 1.0 ? 0.98 : 0.80;
                                                            const flankDampY = sideBoost > 1.0 ? 0.98 : 0.80;
                                                            vx[p] *= flankDampX;
                                                            vy[p] *= flankDampY;
                                                        }
                                                    } else {
                                                        // Stable supported flank in settled pile
                                                        px += normX * overlap;
                                                        py += normY * overlap;
                                                        const vDotN = vx[p] * normX + vy[p] * normY;
                                                        if (vDotN < 0) {
                                                            vx[p] -= vDotN * normX;
                                                            vy[p] -= vDotN * normY;
                                                        }
                                                        const sideBoost = getSideBoost(px);
                                                        const flankDampX = Math.pow(sideBoost > 1.0 ? 0.98 : 0.70, dtScale);
                                                        const flankDampY = Math.pow(sideBoost > 1.0 ? 0.98 : 0.75, dtScale);
                                                        vx[p] *= flankDampX;
                                                        vy[p] *= flankDampY;
                                                    }
                                                }
                                            } else {
                                                // Dynamic vs Dynamic separation with mobility-weighted zero-penetration projection
                                                // Grounded / supported particles at floor or wall resist downward movement, pushing upper particles upward
                                                let ratioP = 0.5;
                                                let ratioO = 0.5;
                                                const isOAtFloor = (oy >= spoutHoleY - 2 && ox >= spoutLeftX && ox <= spoutRightX);
                                                const isPAtFloor = (py >= spoutHoleY - 2 && px >= spoutLeftX && px <= spoutRightX);

                                                if (normY < -0.05) {
                                                    // p is above other: pushing other downward and p upward
                                                    const supportBias = isOAtFloor ? 1.0 : Math.min(1.0, Math.max(0.0, (stabO - stabP) * 1.5 + (isConveyorFull ? 0.35 : 0.0)));
                                                    ratioP = 0.5 + 0.5 * supportBias;
                                                    ratioO = 1.0 - ratioP;
                                                } else if (normY > 0.05) {
                                                    // other is above p: pushing p downward and other upward
                                                    const supportBias = isPAtFloor ? 1.0 : Math.min(1.0, Math.max(0.0, (stabP - stabO) * 1.5 + (isConveyorFull ? 0.35 : 0.0)));
                                                    ratioO = 0.5 + 0.5 * supportBias;
                                                    ratioP = 1.0 - ratioO;
                                                }

                                                // Firm, non-penetrating separation (102% eliminates multi-particle compression)
                                                const sepFactor = 1.02;
                                                px += normX * overlap * ratioP * sepFactor;
                                                py += normY * overlap * ratioP * sepFactor;
                                                ox -= normX * overlap * ratioO * sepFactor;
                                                oy -= normY * overlap * ratioO * sepFactor;

                                                // Inlined checkWallZone with broad Y guard — skips wall-distance math entirely
                                                // for particles above the funnel, eliminating 2 closure calls + 4 K·y+B evaluations per pair.
                                                let isWallZone = false;
                                                if (py >= funnelTopY - 5) {
                                                    const _wlxP = py <= colL.y1 ? colL.x1 : leftWallK * py + leftWallB;
                                                    const _wrxP = py <= colR.y1 ? colR.x1 : rightWallK * py + rightWallB;
                                                    isWallZone = (px - (_wlxP + pRadius) <= wallZoneThreshold)
                                                        || ((_wrxP - pRadius) - px <= wallZoneThreshold)
                                                        || ((funnelBottomY - pRadius) - py <= wallZoneThreshold);
                                                }
                                                if (!isWallZone && oy >= funnelTopY - 5) {
                                                    const _wlxO = oy <= colL.y1 ? colL.x1 : leftWallK * oy + leftWallB;
                                                    const _wrxO = oy <= colR.y1 ? colR.x1 : rightWallK * oy + rightWallB;
                                                    isWallZone = (ox - (_wlxO + pRadius) <= wallZoneThreshold)
                                                        || ((_wrxO - pRadius) - ox <= wallZoneThreshold)
                                                        || ((funnelBottomY - pRadius) - oy <= wallZoneThreshold);
                                                }

                                                // Only apply lateral dispersion kicks to free-flowing particles outside the wall boundary zone and above the mound
                                                if (!isWallZone && Math.abs(normX) < 0.40 && maxStab < 0.30) {
                                                    if (py < moundPeakY - 25) {
                                                        const kickMag = 35 + slideProgression * 35;
                                                        const sDir = (diffX >= 0 || (p % 2 === 0)) ? 1 : -1;
                                                        vx[p] += sDir * kickMag;
                                                        vx[other] -= sDir * kickMag;
                                                        px += sDir * 0.8;
                                                        ox -= sDir * 0.8;
                                                    } else if (py >= funnelTopY) {
                                                        // In the funnel chute: smoothly steer particles inward toward the center spout only when suction is active
                                                        if (isSuctionActive) {
                                                            const steerMax = Math.min(slideSpeed * 0.45, suctionStrength);
                                                            const steerRate = Math.min(60, suctionStrength * 1.5) * subDt;
                                                            if (px < funnelCenter) {
                                                                if (vx[p] < steerMax) vx[p] = Math.min(steerMax, vx[p] + steerRate);
                                                            } else {
                                                                if (vx[p] > -steerMax) vx[p] = Math.max(-steerMax, vx[p] - steerRate);
                                                            }
                                                        }
                                                    }
                                                }

                                                positions[other * 2 + 0] = (ox - imgX) / imageScale;
                                                positions[other * 2 + 1] = (oy - imgY) / imageScale;
                                                this.markDirty(other);

                                                const rvx = vx[p] - vx[other];
                                                const rvy = vy[p] - vy[other];
                                                const rvDotN = rvx * normX + rvy * normY;
                                                if (rvDotN < 0) {
                                                    // Zero closing velocity along contact normal to eliminate penetration momentum
                                                    vx[p] -= rvDotN * ratioP * normX;
                                                    vy[p] -= rvDotN * ratioP * normY;
                                                    vx[other] += rvDotN * ratioO * normX;
                                                    vy[other] += rvDotN * ratioO * normY;

                                                    // Tangential friction between sand particles for inert, viscous granular flow
                                                    const tX = -normY;
                                                    const tY = normX;
                                                    const rvDotT = rvx * tX + rvy * tY;
                                                    const frictionMultiplier = 1.0 - Math.pow(1.0 - 0.30, dtScale);
                                                    const frictionImp = rvDotT * frictionMultiplier;
                                                    vx[p] -= frictionImp * tX;
                                                    vy[p] -= frictionImp * tY;
                                                    vx[other] += frictionImp * tX;
                                                    vy[other] += frictionImp * tY;
                                                }
                                                const sideBoost = getSideBoost(px);
                                                // Balanced damping: minimal energy loss for agile masses, absorbing damping for heavy heaps
                                                let damping = (sideBoost > 1.0) ? 0.995 : (maxStab > 0.4 ? (0.85 * (1.0 - 0.15 * maxStab)) : (0.985 - 0.065 * massRatio));
                                                damping = Math.pow(damping, dtScale);
                                                vx[p] *= damping;
                                                vy[p] *= damping;
                                                vx[other] *= damping;
                                                vy[other] *= damping;
                                            }

                                            positions[p * 2 + 0] = (px - imgX) / imageScale;
                                            positions[p * 2 + 1] = (py - imgY) / imageScale;
                                            this.markDirty(p);
                                        }
                                    }
                                }
                                other = next[other];
                            }
                        }
                    }
                }
            }

            // STEP D: Enforce absolute static image pixel and funnel boundaries
            for (let i = 0; i < this.activeCount; i++) {
                const p = this.activeIndices[i];
                if (this.states[p] !== STATE_ACTIVE) continue;

                let lx = positions[p * 2 + 0] * imageScale + imgX;
                let ly = positions[p * 2 + 1] * imageScale + imgY;

                // 1. Static image terrain boundary enforcement (impenetrable static pixel geometry)
                const localX = (lx - imgX) / imageScale;
                const localY = (ly - imgY) / imageScale;
                const centerCol = Math.round((localX + offsetX) / spacing);
                const centerRow = Math.round((localY + offsetY) / spacing);

                const minR = Math.max(0, centerRow - 1);
                const maxR = Math.min(h - 1, centerRow + 1);
                const minC = Math.max(0, centerCol - 1);
                const maxC = Math.min(w - 1, centerCol + 1);

                for (let nr = minR; nr <= maxR; nr++) {
                    const rOff = nr * w;
                    for (let nc = minC; nc <= maxC; nc++) {
                        const staticP = staticGrid[rOff + nc];
                        if (staticP === -1) continue;

                        const sx = (nc * spacing - offsetX) * imageScale + imgX;
                        const sy = (nr * spacing - offsetY) * imageScale + imgY;

                        const openTop = (nr === 0 || staticGrid[(nr - 1) * w + nc] === -1);
                        const openBottom = (nr === h - 1 || staticGrid[(nr + 1) * w + nc] === -1);
                        const openLeft = (nc === 0 || staticGrid[rOff + (nc - 1)] === -1);
                        const openRight = (nc === w - 1 || staticGrid[rOff + (nc + 1)] === -1);

                        if (!openTop && !openBottom && !openLeft && !openRight) continue;

                        const dx = lx - sx;
                        const dy = ly - sy;

                        // Top face (Floor)
                        if (openTop && dy < 0 && Math.abs(dx) <= halfCell) {
                            const topFaceY = sy - halfCell;
                            if (ly + pRadius > topFaceY) {
                                // Sound Trigger: falling particle lands on settled static particle
                                const currentY = (ly - imgY) / imageScale;
                                const fallDist = (currentY - this.fallStartY[p]) * imageScale;
                                if (fallDist >= SOUND_FALL_HEIGHT_DEAD_ZONE) {
                                    this.playSandCollisionSound(fallDist, vy[p]);
                                    this.fallStartY[p] = currentY;
                                }

                                ly = topFaceY - pRadius;
                                if (vy[p] > 0) vy[p] = 0;
                                vx[p] *= Math.pow(0.85, dtScale);
                            }
                        }

                        // Bottom face (Ceiling)
                        if (openBottom && dy > 0 && Math.abs(dx) <= halfCell) {
                            const bottomFaceY = sy + halfCell;
                            if (ly - pRadius < bottomFaceY) {
                                ly = bottomFaceY + pRadius;
                                if (vy[p] < 0) vy[p] = 0;
                            }
                        }

                        // Left face (Wall facing left - pushes particles strictly to the left, away from solid cell)
                        if (openLeft && dx < 0 && Math.abs(dy) <= halfCell) {
                            const leftFaceX = sx - halfCell;
                            if (lx + pRadius > leftFaceX) {
                                lx = leftFaceX - pRadius;
                                if (vx[p] > 0) vx[p] = 0;
                            }
                        }

                        // Right face (Wall facing right - pushes particles strictly to the right, away from solid cell)
                        if (openRight && dx > 0 && Math.abs(dy) <= halfCell) {
                            const rightFaceX = sx + halfCell;
                            if (lx - pRadius < rightFaceX) {
                                lx = rightFaceX + pRadius;
                                if (vx[p] < 0) vx[p] = 0;
                            }
                        }

                        // Convex corners for smooth rolling down slopes/steps into open space:
                        const cornerR2 = colD2 * 0.25;

                        if (openTop && openLeft && dx < -halfCell && dy < -halfCell) {
                            const cdx = lx - (sx - halfCell);
                            const cdy = ly - (sy - halfCell);
                            const cd2 = cdx * cdx + cdy * cdy;
                            if (cd2 < cornerR2) {
                                const cd = Math.sqrt(cd2) || 0.001;
                                const overlap = pRadius - cd;
                                lx += (cdx / cd) * overlap;
                                ly += (cdy / cd) * overlap;
                                const vDotN = vx[p] * (cdx / cd) + vy[p] * (cdy / cd);
                                if (vDotN < 0) {
                                    vx[p] -= vDotN * (cdx / cd);
                                    vy[p] -= vDotN * (cdy / cd);
                                }
                            }
                        }

                        if (openTop && openRight && dx > halfCell && dy < -halfCell) {
                            const cdx = lx - (sx + halfCell);
                            const cdy = ly - (sy - halfCell);
                            const cd2 = cdx * cdx + cdy * cdy;
                            if (cd2 < cornerR2) {
                                const cd = Math.sqrt(cd2) || 0.001;
                                const overlap = pRadius - cd;
                                lx += (cdx / cd) * overlap;
                                ly += (cdy / cd) * overlap;
                                const vDotN = vx[p] * (cdx / cd) + vy[p] * (cdy / cd);
                                if (vDotN < 0) {
                                    vx[p] -= vDotN * (cdx / cd);
                                    vy[p] -= vDotN * (cdy / cd);
                                }
                            }
                        }

                        if (openBottom && openLeft && dx < -halfCell && dy > halfCell) {
                            const cdx = lx - (sx - halfCell);
                            const cdy = ly - (sy + halfCell);
                            const cd2 = cdx * cdx + cdy * cdy;
                            if (cd2 < cornerR2) {
                                const cd = Math.sqrt(cd2) || 0.001;
                                const overlap = pRadius - cd;
                                lx += (cdx / cd) * overlap;
                                ly += (cdy / cd) * overlap;
                                const vDotN = vx[p] * (cdx / cd) + vy[p] * (cdy / cd);
                                if (vDotN < 0) {
                                    vx[p] -= vDotN * (cdx / cd);
                                    vy[p] -= vDotN * (cdy / cd);
                                }
                            }
                        }

                        if (openBottom && openRight && dx > halfCell && dy > halfCell) {
                            const cdx = lx - (sx + halfCell);
                            const cdy = ly - (sy + halfCell);
                            const cd2 = cdx * cdx + cdy * cdy;
                            if (cd2 < cornerR2) {
                                const cd = Math.sqrt(cd2) || 0.001;
                                const overlap = pRadius - cd;
                                lx += (cdx / cd) * overlap;
                                ly += (cdy / cd) * overlap;
                                const vDotN = vx[p] * (cdx / cd) + vy[p] * (cdy / cd);
                                if (vDotN < 0) {
                                    vx[p] -= vDotN * (cdx / cd);
                                    vy[p] -= vDotN * (cdy / cd);
                                }
                            }
                        }

                        // Absolute penetration safety: if particle is somehow inside the cell, eject toward the nearest open face
                        if (Math.abs(dx) < halfCell && Math.abs(dy) < halfCell) {
                            if (openTop) {
                                ly = (sy - halfCell) - pRadius;
                                if (vy[p] > 0) vy[p] = 0;
                            } else if (openRight) {
                                lx = (sx + halfCell) + pRadius;
                                if (vx[p] < 0) vx[p] = 0;
                            } else if (openLeft) {
                                lx = (sx - halfCell) - pRadius;
                                if (vx[p] > 0) vx[p] = 0;
                            } else if (openBottom) {
                                ly = (sy + halfCell) + pRadius;
                                if (vy[p] < 0) vy[p] = 0;
                            }
                        }
                    }
                }

                // 2. Container lateral walls & Funnel boundaries
                if (ly < funnelTopY) {
                    // Inside picture frame upper bounds: lateral walls of container
                    if (lx < frameLeftX + pRadius) {
                        lx = frameLeftX + pRadius;
                        vx[p] = Math.max(0, vx[p]);
                        if (this.hasTouchedWall) this.hasTouchedWall[p] = 1;
                    } else if (lx > frameRightX - pRadius) {
                        lx = frameRightX - pRadius;
                        vx[p] = Math.min(0, vx[p]);
                        if (this.hasTouchedWall) this.hasTouchedWall[p] = 2;
                    }
                    // Corner guide near bottom of container walls: steer inward toward chute (only if not in dead zone)
                    if (ly >= funnelTopY - 12 && !checkParabolaDeadZone(lx, ly, p)) {
                        if (lx < colL.x1 + pRadius + 8) {
                            vx[p] = Math.max(vx[p], 60);
                            vy[p] = Math.max(vy[p], 60);
                        } else if (lx > colR.x1 - pRadius - 8) {
                            vx[p] = Math.min(vx[p], -60);
                            vy[p] = Math.max(vy[p], 60);
                        }
                    }
                } else {
                    // Inside funnel region
                    // Inlined wall boundary — K·y+B multiply-add, replaces closure call per active particle per substep
                    const wallL = (ly <= colL.y1 ? colL.x1 : leftWallK * ly + leftWallB) + pRadius;
                    const wallR = (ly <= colR.y1 ? colR.x1 : rightWallK * ly + rightWallB) - pRadius;

                    if (lx < wallL) {
                        if (this.hasTouchedWall) this.hasTouchedWall[p] = 1;
                        if (this.hasDecelContact) this.hasDecelContact[p] = 1;
                        const leftBoost = (this.leftWallSlideBoost !== undefined) ? this.leftWallSlideBoost : (isLeftParabolaActive ? 0.0 : 1.0);
                        const baseWallFriction = settings.funnel_wall_friction !== undefined ? settings.funnel_wall_friction : 0.4;
                        // Scaled friction: smoothly increases with massRatio, reduced by leftBoost when parabola turns off
                        const minFriction = Math.min(0.005, baseWallFriction * 0.01);
                        const maxFriction = Math.min(0.85, Math.max(0.4, baseWallFriction));
                        const wallFriction = (minFriction + (maxFriction - minFriction) * massRatio) / Math.max(0.1, leftBoost);

                        // Sound Trigger & Initial Impact Damping
                        const currentY = (ly - imgY) / imageScale;
                        const fallDist = (currentY - this.fallStartY[p]) * imageScale;
                        if (fallDist >= SOUND_FALL_HEIGHT_DEAD_ZONE) {
                            this.playSandCollisionSound(fallDist, vy[p]);
                            this.fallStartY[p] = currentY; // Reset to avoid repeating sound during continuous sliding

                            // Apply cut to velocity on initial hit based on wall friction (near zero cut for small masses)
                            const impactDamping = Math.max(0, 1.0 - wallFriction);
                            vx[p] *= impactDamping;
                            vy[p] *= impactDamping;
                        }

                        lx = wallL;
                        if (isConveyorFull || isLeftParabolaActive || leftBoost <= 0.001) {
                            // While conveyor is full or parabola is active, slip in this half is strictly 0
                            vx[p] = 0;
                            vy[p] = 0;
                            this.stability[p] = 1.0;
                            this.stationaryFrames[p] = (this.stationaryFrames[p] || 0) + 1;
                        } else {
                            // Speed governed by sand_slide_speed from settings scaled by leftBoost
                            const maxWallSpeed = Math.max(20, slideSpeed * leftBoost);
                            const targetSlideSpeed = Math.max(slideSpeed * Math.min(1.0, leftBoost), maxWallSpeed * (0.65 + slideProgression * 0.35)) * wallSlideFactor;

                            let vTang = vx[p] * tLx + vy[p] * tLy;
                            // Funnel slope is strictly unidirectional: particles must never slide uphill into the corner!
                            if (vTang < 0) vTang = 0;

                            if (vTang > targetSlideSpeed) {
                                const decelRate = Math.max(120, wallFriction * 350) * subDt;
                                vTang = Math.max(targetSlideSpeed, vTang - decelRate);
                            } else {
                                const maxSlopeAccel = Math.min(600 * leftBoost, Math.max(120, slideSpeed * 3.5 * leftBoost));
                                const startSlopeAccel = maxSlopeAccel * 0.5;
                                const accelRate = (startSlopeAccel + slideProgression * (maxSlopeAccel - startSlopeAccel)) * subDt;
                                vTang = Math.min(targetSlideSpeed, vTang + accelRate);
                            }

                            vx[p] = tLx * vTang;
                            vy[p] = tLy * vTang;

                            // Velocity-gated stability: small masses stay completely unstable
                            const slideRatio = Math.abs(vTang) / Math.max(1, targetSlideSpeed);
                            if (slideRatio > 0.25 || massRatio < 0.4) {
                                this.stability[p] = Math.min(this.stability[p] || 0, maxFunnelStab * 0.05);
                            } else {
                                this.stability[p] = Math.min((this.stability[p] || 0) * 0.98 + (1.0 - slideRatio) * 0.05, maxFunnelStab);
                            }

                            // Wall-pinned jitter elimination: only active for heavy crowds
                            if (massRatio > 0.4) {
                                const totalSpeed = Math.sqrt(vx[p] * vx[p] + vy[p] * vy[p]);
                                if (this.stability[p] > 0.7 && totalSpeed < 15) {
                                    vx[p] *= 0.1;
                                    vy[p] *= 0.1;
                                } else if (this.stability[p] > 0.5 && totalSpeed < 30) {
                                    vx[p] *= 0.5;
                                    vy[p] *= 0.5;
                                }
                            }

                            const preY = this.preStepY[p] || ly;
                            ly = Math.max(funnelTopY, Math.max(ly, preY + Math.max(0, vy[p]) * subDt));
                            lx = getLeftWallX(ly) + pRadius;
                            this.stationaryFrames[p] = 0;
                        }
                    } else if (lx > wallR) {
                        if (this.hasTouchedWall) this.hasTouchedWall[p] = 2;
                        if (this.hasDecelContact) this.hasDecelContact[p] = 1;
                        const rightBoost = (this.rightWallSlideBoost !== undefined) ? this.rightWallSlideBoost : (isRightParabolaActive ? 0.0 : 1.0);
                        const baseWallFriction = settings.funnel_wall_friction !== undefined ? settings.funnel_wall_friction : 0.4;
                        // Scaled friction: smoothly increases with massRatio, reduced by rightBoost when parabola turns off
                        const minFriction = Math.min(0.005, baseWallFriction * 0.01);
                        const maxFriction = Math.min(0.85, Math.max(0.4, baseWallFriction));
                        const wallFriction = (minFriction + (maxFriction - minFriction) * massRatio) / Math.max(0.1, rightBoost);

                        // Sound Trigger & Initial Impact Damping
                        const currentY = (ly - imgY) / imageScale;
                        const fallDist = (currentY - this.fallStartY[p]) * imageScale;
                        if (fallDist >= SOUND_FALL_HEIGHT_DEAD_ZONE) {
                            this.playSandCollisionSound(fallDist, vy[p]);
                            this.fallStartY[p] = currentY; // Reset to avoid repeating sound during continuous sliding

                            // Apply cut to velocity on initial hit based on wall friction
                            const impactDamping = Math.max(0, 1.0 - wallFriction);
                            vx[p] *= impactDamping;
                            vy[p] *= impactDamping;
                        }

                        lx = wallR;
                        if (isConveyorFull || isRightParabolaActive || rightBoost <= 0.001) {
                            // While conveyor is full or parabola is active, slip in this half is strictly 0
                            vx[p] = 0;
                            vy[p] = 0;
                            this.stability[p] = 1.0;
                            this.stationaryFrames[p] = (this.stationaryFrames[p] || 0) + 1;
                        } else {
                            // Speed governed by sand_slide_speed from settings scaled by rightBoost
                            const maxWallSpeed = Math.max(20, slideSpeed * rightBoost);
                            const targetSlideSpeed = Math.max(slideSpeed * Math.min(1.0, rightBoost), maxWallSpeed * (0.65 + slideProgression * 0.35)) * wallSlideFactor;

                            let vTang = vx[p] * tRx + vy[p] * tRy;
                            // Funnel slope is strictly unidirectional: particles must never slide uphill into the corner!
                            if (vTang < 0) vTang = 0;

                            if (vTang > targetSlideSpeed) {
                                const decelRate = Math.max(120, wallFriction * 350) * subDt;
                                vTang = Math.max(targetSlideSpeed, vTang - decelRate);
                            } else {
                                const maxSlopeAccel = Math.min(600 * rightBoost, Math.max(120, slideSpeed * 3.5 * rightBoost));
                                const startSlopeAccel = maxSlopeAccel * 0.5;
                                const accelRate = (startSlopeAccel + slideProgression * (maxSlopeAccel - startSlopeAccel)) * subDt;
                                vTang = Math.min(targetSlideSpeed, vTang + accelRate);
                            }

                            vx[p] = tRx * vTang;
                            vy[p] = tRy * vTang;

                            // Velocity-gated stability: small masses stay completely unstable
                            const slideRatio = Math.abs(vTang) / Math.max(1, targetSlideSpeed);
                            if (slideRatio > 0.25 || massRatio < 0.4) {
                                this.stability[p] = Math.min(this.stability[p] || 0, maxFunnelStab * 0.05);
                            } else {
                                this.stability[p] = Math.min((this.stability[p] || 0) * 0.98 + (1.0 - slideRatio) * 0.05, maxFunnelStab);
                            }

                            // Wall-pinned jitter elimination: only active for heavy crowds
                            if (massRatio > 0.4) {
                                const totalSpeed = Math.sqrt(vx[p] * vx[p] + vy[p] * vy[p]);
                                if (this.stability[p] > 0.7 && totalSpeed < 15) {
                                    vx[p] *= 0.1;
                                    vy[p] *= 0.1;
                                } else if (this.stability[p] > 0.5 && totalSpeed < 30) {
                                    vx[p] *= 0.5;
                                    vy[p] *= 0.5;
                                }
                            }

                            const preY = this.preStepY[p] || ly;
                            ly = Math.max(funnelTopY, Math.max(ly, preY + Math.max(0, vy[p]) * subDt));
                            lx = getRightWallX(ly) - pRadius;
                            this.stationaryFrames[p] = 0;
                        }
                    }

                    // Funnel floor / Spout collision
                    const isInsideSpoutAperture = (ly >= spoutHoleY && lx >= spoutLeftX && lx <= spoutRightX);

                    if (isInsideSpoutAperture && !isConveyorFull && (despawnedThisFrame < frameCullBudget)) {
                        // CULLING ZONE: Transfer particle to conveyor in direct 1:1 real-time sync
                        this.despawnQueue.push({
                            p: p,
                            logicalX: lx,
                            logicalY: ly,
                            colorInt: this.dots[p]
                        });
                        despawnedThisFrame++;
                        this.removeParticleFromSimulation(p);
                        i--; // Revisit this index as removeParticle swaps the last active particle here
                        continue;
                    } else if (ly >= spoutHoleY) {
                        // Funnel bottom floor / Spout plug dam
                        if (this.hasDecelContact) this.hasDecelContact[p] = 1;
                        if (lx >= spoutLeftX && lx <= spoutRightX) {
                            // Inside spout aperture but conveyor is full:
                            // Strictly dam and block particle from entering or passing through the funnel opening (zero slide / no pile)
                            ly = spoutHoleY;
                            vy[p] = 0;
                            vx[p] = 0;
                            this.stability[p] = 1.0;
                            this.stationaryFrames[p] = (this.stationaryFrames[p] || 0) + 1;
                        } else {
                            // Bottom corners of funnel: clamp to bottom
                            ly = spoutHoleY;
                            vy[p] = 0;
                            vx[p] *= 0.8;
                            this.stability[p] = 1.0;
                        }
                    }
                }

                positions[p * 2 + 0] = (lx - imgX) / imageScale;
                positions[p * 2 + 1] = (ly - imgY) / imageScale;
                this.markDirty(p);
            }
        }

        // Sleep / Idle State Transitions:
        // Transition resting and dampened particles into proper sleep states only when supported in the funnel.
        for (let i = 0; i < this.activeCount; i++) {
            const p = this.activeIndices[i];
            const s = this.states[p];

            // If particle was previously frozen in parabolic dead zone, but mound lowered or active count < calming threshold:
            if (s === STATE_FUNNEL_RESTING) {
                const ly = positions[p * 2 + 1] * imageScale + imgY;
                const lx = positions[p * 2 + 0] * imageScale + imgX;
                const sideActive = (lx < funnelCenter) ? isLeftParabolaActive : isRightParabolaActive;
                // Fast-path dead-zone lookup — sleep transition (once per frame per FUNNEL_RESTING particle)
                const _stInDZ = checkParabolaDeadZone(lx, ly, p);
                if (!allowCalming || !sideActive || !_stInDZ) {
                    if (!isConveyorFull || !allowCalming) {
                        this.states[p] = STATE_ACTIVE;
                        this.stability[p] = 0.25;
                        this.stationaryFrames[p] = 0;
                        if (this.hasDecelContact) this.hasDecelContact[p] = 0;
                        if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                        const sideBoost = getSideBoost(lx);
                        const rollDir = (lx < funnelCenter) ? 1 : -1;
                        this.vx[p] = rollDir * Math.min(slideSpeed * sideBoost * 0.3, 20);
                        this.vy[p] = Math.min(slideSpeed * sideBoost * 0.4, 25);
                    } else {
                        this.states[p] = STATE_RESTING;
                    }
                }
                continue;
            }

            if (s !== STATE_ACTIVE) continue;

            const curVx = vx[p];
            const curVy = vy[p];
            const speedSq = curVx * curVx + curVy * curVy;

            const ly = positions[p * 2 + 1] * imageScale + imgY;
            const lx = positions[p * 2 + 0] * imageScale + imgX;
            const sideActive = (lx < funnelCenter) ? isLeftParabolaActive : isRightParabolaActive;

            // When conveyor is 100% full or parabola is OFF: particles outside dead zone MUST STAY ACTIVE and move slowly!
            if (isConveyorFull || !sideActive || !allowCalming) {
                // Fast-path dead-zone lookup — sleep-transition guard
                const _stInDZ2 = checkParabolaDeadZone(lx, ly, p);
                if (!_stInDZ2) {
                    this.states[p] = STATE_ACTIVE;
                    this.stability[p] = 0;
                    this.stationaryFrames[p] = 0;
                    continue;
                }
            }

            // Check if particle is physically supported in the funnel:
            // 1. Near the funnel floor or spout exit
            // 2. Settled in a stable heap
            const floorY = getFunnelFloorY(lx) - pRadius;
            const isNearFloor = ly >= (funnelBottomY - pRadius - 8) || ly >= (floorY - 4);
            if (isNearFloor && this.hasDecelContact) {
                this.hasDecelContact[p] = 1;
            }
            // Fast-path dead-zone lookup — final sleep-eligibility check
            const isParabolaDeadZone = checkParabolaDeadZone(lx, ly, p);

            // ANTI-FLOATING: If unsupported from below, NEVER allow freezing or sleeping in mid-air!
            const hasSupportBelow = isSupportedBelow(p, lx, ly);
            if (!hasSupportBelow) {
                this.stationaryFrames[p] = 0;
                continue;
            }

            if (isParabolaDeadZone && this.hasDecelContact && this.hasDecelContact[p] === 1) {
                const curTimer = this.deadZoneTimer ? this.deadZoneTimer[p] : 0;
                const decelProgress = Math.min(1.0, curTimer / decelDuration);

                const moundY = (lx < funnelCenter) ? effectiveLeftMoundY : effectiveRightMoundY;
                const parabolaSpan = Math.max(15, funnelBottomY - moundY);
                const depthFactor = Math.max(0.0, Math.min(1.0, (ly - moundY) / parabolaSpan));

                // Particles located above stay dynamic longer, while particles below stabilize faster
                const effDuration = decelDuration * (1.35 - 0.60 * depthFactor);

                // Build stability gradually over the deceleration window, faster for deeper particles
                this.stability[p] = Math.max(this.stability[p], (0.25 + 0.70 * decelProgress) * (0.35 + 0.65 * depthFactor));

                // Only allow complete freezing once the particle has had time to stabilize AND is nearly motionless
                if (curTimer >= effDuration && speedSq < 25 && Math.abs(curVy) < 5) {
                    this.stationaryFrames[p]++;
                    const targetFramesDZ = Math.max(2, Math.round(5 / dtScale));
                    if (this.stationaryFrames[p] >= targetFramesDZ) {
                        this.vx[p] = 0;
                        this.vy[p] = 0;
                        this.stability[p] = 1.0;
                        this.states[p] = STATE_FUNNEL_RESTING;
                        this.stationaryFrames[p] = 0;
                    }
                } else {
                    this.stationaryFrames[p] = 0;
                }
            } else {
                if (this.deadZoneTimer) this.deadZoneTimer[p] = 0;
                // Outside parabola dead zone:
                // ALL particles outside the dead zone MUST STAY ACTIVE while conveyor is draining!
                if (!isConveyorFull) {
                    this.states[p] = STATE_ACTIVE;
                    this.stability[p] = 0;
                    this.stationaryFrames[p] = 0;
                    continue;
                }

                // If conveyor is completely full, particles outside the dead zone can gently settle
                const isStableHeap = (this.stability[p] || 0) >= 0.40;
                const isSupported = isNearFloor || isStableHeap;
                if (isSupported) {
                    if (speedSq < 400.0 && Math.abs(curVy) < 12) {
                        this.stationaryFrames[p]++;
                        const targetFramesNormal = Math.max(1, Math.round(15 / dtScale));
                        if (this.stationaryFrames[p] >= targetFramesNormal) {
                            this.states[p] = STATE_RESTING;
                            this.vx[p] = 0;
                            this.vy[p] = 0;
                            this.stability[p] = 1.0;
                            this.stationaryFrames[p] = 0;
                        }
                    } else {
                        this.stationaryFrames[p] = 0;
                    }
                } else {
                    this.stationaryFrames[p] = 0;
                }
            }
        }

        return true;
    }

    stepKinematicPhysics(dt, settings, funnelColliders) {
        return this.stepPhysics(dt, settings, funnelColliders);
    }
}
