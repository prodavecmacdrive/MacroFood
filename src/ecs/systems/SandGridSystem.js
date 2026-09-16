import { System } from '../ECS';
import { SandGridComponent } from '../components/SandGridComponent';
import { ConveyorComponent } from '../components/ConveyorComponent';

class SandGridObject extends Phaser.GameObjects.GameObject {
    constructor(scene, renderCallback) {
        super(scene, 'SandGrid');
        this.renderCallback = renderCallback;
        this.blendMode = 0; // Phaser.BlendModes.NORMAL
        this.depth = 2;
        this.visible = true;
        this.renderFlags = 15;
        this.scrollFactorX = 1;
        this.scrollFactorY = 1;
        this.alpha = 1;
        this._alphaTL = 1;
        this._alphaTR = 1;
        this._alphaBL = 1;
        this._alphaBR = 1;
        this.mask = null;
    }

    setDepth(depth) {
        this.depth = depth;
        return this;
    }

    setScrollFactor(x, y) {
        this.scrollFactorX = x;
        this.scrollFactorY = (y !== undefined) ? y : x;
        return this;
    }

    setAlpha(tl, tr, bl, br) {
        return this;
    }

    willRender(camera) {
        return true;
    }

    renderWebGL(renderer, src, camera, calcMatrix) {
        this.renderCallback(renderer, camera, calcMatrix);
    }

    renderCanvas() { }
}

export class SandGridSystem extends System {
    constructor(game) {
        super(game);

        this.particleScale = game.SETTINGS.particle_scale || 2.0;

        this.vertShaderSource = `
            uniform vec2 uResolution;
            uniform vec2 uCameraScroll;
            uniform float uCameraZoom;
            uniform vec2 uImageOffset;
            uniform float uImageScale;
            uniform float uPointSize;
            
            uniform float uWaveRadius;
            uniform float uWaveThickness;
            uniform float uWaveHeight;
            
            attribute vec2 aPosition;
            attribute vec4 aColor;
            
            varying vec4 vColor;
            varying float vIsColorized;
            
            void main() {
                vec2 screenCenter = uResolution / 2.0;
                vec2 scaledPos = aPosition * uImageScale + uImageOffset;
                vec2 pos = (scaledPos - uCameraScroll) * uCameraZoom + screenCenter;
                
                // --- Wave Logic ---
                float d = length(aPosition);
                float waveDiff = d - uWaveRadius;
                float lift = 0.0;
                float isColorized = 1.0;
                
                if (waveDiff > uWaveThickness) {
                    isColorized = 0.0;
                } else if (waveDiff < -uWaveThickness) {
                    isColorized = 1.0;
                } else {
                    float t = (waveDiff + uWaveThickness) / (2.0 * uWaveThickness);
                    lift = sin(t * 3.14159265) * uWaveHeight;
                    isColorized = 1.0 - t;
                }
                
                // Apply lift to visual Y position
                pos.y -= lift * uCameraZoom;
                
                // Shift box center down by half particle size so top half is at pos, bottom half below it
                vec2 boxCenter = vec2(pos.x, pos.y + uPointSize * 0.5);
                
                // Convert pixel pos to NDC (-1 to +1)
                vec2 ndc = boxCenter / uResolution;
                ndc = ndc * 2.0 - 1.0;
                ndc.y = -ndc.y; // Flip Y for WebGL
                
                // Depth: lower particle on screen (greater pos.y) has greater z-index (closer to camera / smaller depthZ)
                float normY = clamp((pos.y + 200.0) / 1400.0, 0.0, 1.0);
                float depthZ = 0.9 - normY * 1.8;
                
                gl_Position = vec4(ndc.x, ndc.y, depthZ, 1.0);
                gl_PointSize = uPointSize * 2.0;
                vColor = aColor;
                vIsColorized = isColorized;
            }
        `;

        this.fragShaderSource = `
            precision mediump float;
            varying vec4 vColor;
            varying float vIsColorized;
            uniform float uDarkenFactor;
            
            void main() {
                // Keep only the vertical column of width = 0.5 (from 0.25 to 0.75 in pointCoord)
                if (gl_PointCoord.x < 0.25 || gl_PointCoord.x > 0.75) {
                    discard;
                }
                
                // Only fixed particles in the image (vColor.a > 0.5) are darkened when conveyor is full; free particles stay at full brightness
                float isFixed = step(0.5, vColor.a);
                float darken = mix(1.0, uDarkenFactor, isFixed);
                vec3 baseRgb = vColor.rgb * darken;
                
                // Grayscale transition logic
                float lum = dot(baseRgb, vec3(0.299, 0.587, 0.114));
                vec3 grayRgb = vec3(lum);
                baseRgb = mix(grayRgb, baseRgb, vIsColorized);
                
                // Top half: original particle color
                if (gl_PointCoord.y < 0.5) {
                    gl_FragColor = vec4(baseRgb, 1.0);
                } else {
                    // Bottom half: darkened by 2 times to simulate volume
                    gl_FragColor = vec4(baseRgb * 0.5, 1.0);
                }
            }
        `;

        this.extern = new SandGridObject(game, this.render.bind(this));
        if (game.mainContainer) {
            game.mainContainer.add(this.extern);
            this.extern.setDepth(2);
            if (typeof game.sort === 'function') game.sort();
        } else {
            game.add.existing(this.extern);
        }

        this.glInit = false;
        this.camera = game.cameras.main;

        // Brush stroke graphics
        this.brushGraphics = game.add.graphics();
        this.brushGraphics.setDepth(6); // Render above frame and particles for crisp visibility
        if (game.mainContainer) {
            game.mainContainer.add(this.brushGraphics);
        }

        this.isSwiping = false;
        this.canSwipe = false;
        this.trailPoints = [];
        // this.trailLifetime = 480;
        this.trailLifetime = 0;
        // this.baseTrailWidth = 36;
        this.baseTrailWidth = 0;

        this.lastParticleX = null;
        this.lastParticleY = null;
        this.lastLocalX = null;
        this.lastLocalY = null;

        this.waveRadius = 0.0;
        this.waveDelay = 0.5;
        this.waveSpeed = game.SETTINGS.reveal_wave_speed !== undefined ? game.SETTINGS.reveal_wave_speed : 266.67;
        this.waveThickness = 45.0;
        this.waveHeight = 20.0;

        game.input.on('pointerdown', this.onPointerDown, this);
        game.input.on('pointermove', this.onPointerMove, this);
        game.input.on('pointerup', this.onPointerUp, this);
    }

    getParticleCoords(pointer) {
        const mainContainer = this.game.mainContainer;
        const scale = (mainContainer && mainContainer.scaleX !== undefined) ? mainContainer.scaleX : (this.game.size?.scale || 1.0);
        const cx = mainContainer ? mainContainer.x : (this.camera.width / 2 - 300 * scale);
        const cy = mainContainer ? mainContainer.y : (this.camera.height / 2 - 450 * scale);

        const localX = (pointer.x - cx) / scale;
        const localY = (pointer.y - cy) / scale;

        const settings = this.game.SETTINGS || {};
        const logicalX = settings.image_logical_x !== undefined ? settings.image_logical_x : 300;
        const logicalY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
        const imageScale = settings.image_scale || 0.70;

        const particleX = (localX - logicalX) / imageScale;
        const particleY = (localY - logicalY) / imageScale;

        if (!this._ptCoordsResult) {
            this._ptCoordsResult = { particleX: 0, particleY: 0, localX: 0, localY: 0 };
        }
        this._ptCoordsResult.particleX = particleX;
        this._ptCoordsResult.particleY = particleY;
        this._ptCoordsResult.localX = localX;
        this._ptCoordsResult.localY = localY;

        return this._ptCoordsResult;
    }

    onPointerDown(pointer) {
        this.isPointerDown = true;
        if (this.game && typeof this.game.startChallenge === 'function') {
            this.game.startChallenge();
        }

        // Prevent swiping if conveyor is in sustained overflow
        if (this.game.ecsWorld) {
            if (!this.conveyorComponent) {
                const conveyorEntities = this.game.ecsWorld.getEntitiesWith([ConveyorComponent]);
                if (conveyorEntities.length > 0) {
                    this.conveyorComponent = conveyorEntities[0].getComponent(ConveyorComponent);
                }
            }
            if (this.conveyorComponent) {
                const conveyor = this.conveyorComponent;
                if (conveyor.isOverflow) {
                    this.canSwipe = false;
                    this.isSwiping = false;
                    return;
                }
            }
        }

        const pt = this.getParticleCoords(pointer);

        // Check if pointer starts on empty space or directly on particles
        const startedOnParticle = this.gridComponent && this.gridComponent.hasParticleAt(pt.particleX, pt.particleY, 15);
        if (startedOnParticle) {
            // Swipes that start directly on particles do NOT activate particles initially
            this.canSwipe = false;
            this.isSwiping = true;
            return;
        }

        // Swipes starting from an empty part of the screen activate normally
        this.canSwipe = true;
        this.isSwiping = true;
        if (this.trailPoints.length > 0 && this._trailPool) {
            for (let i = 0; i < this.trailPoints.length; i++) {
                if (this._trailPool.length < 120) this._trailPool.push(this.trailPoints[i]);
            }
        }
        this.trailPoints.length = 0;
        this.brushGraphics.clear();
        this.lastParticleX = null;
        this.lastParticleY = null;
        this.lastLocalX = null;
        this.lastLocalY = null;
        this.currentPointer = pointer;
        this.pendingPointerMove = true;
    }

    onPointerMove(pointer) {
        this.currentPointer = pointer;

        if (!this.isPointerDown && !pointer.isDown) {
            this.isSwiping = false;
            this.canSwipe = false;
            this.pendingPointerMove = false;
            return;
        }

        this.isSwiping = true;

        // If swipe was previously disabled (e.g. started on a particle or in overflow),
        // check if pointer has moved off particles onto empty space to start a new active swipe.
        if (!this.canSwipe && this.gridComponent) {
            const pt = this.getParticleCoords(pointer);
            const isOnParticle = this.gridComponent.hasParticleAt(pt.particleX, pt.particleY, 15);
            if (!isOnParticle) {
                // Pointer exited particle image area into empty space -> turn into a newly started swipe
                this.canSwipe = true;
                if (this.trailPoints.length > 0 && this._trailPool) {
                    for (let i = 0; i < this.trailPoints.length; i++) {
                        if (this._trailPool.length < 120) this._trailPool.push(this.trailPoints[i]);
                    }
                }
                this.trailPoints.length = 0;
                this.brushGraphics.clear();
                this.lastParticleX = null;
                this.lastParticleY = null;
                this.lastLocalX = null;
                this.lastLocalY = null;
            }
        }

        if (this.canSwipe) {
            this.pendingPointerMove = true;
        }
    }

    onPointerUp(pointer) {
        this.isPointerDown = false;
        this.isSwiping = false;
        this.canSwipe = false;
        this.pendingPointerMove = false;
        this.lastParticleX = null;
        this.lastParticleY = null;
        this.lastLocalX = null;
        this.lastLocalY = null;

        if (this.gridComponent) {
            this.gridComponent.pendingIslandCheckOnPointerUp = true;
        }
    }

    applyBrush(pointer) {
        if (!this.gridComponent || !this.canSwipe) return;

        if (this.game.ecsWorld) {
            if (!this.conveyorComponent) {
                const conveyorEntities = this.game.ecsWorld.getEntitiesWith([ConveyorComponent]);
                if (conveyorEntities.length > 0) {
                    this.conveyorComponent = conveyorEntities[0].getComponent(ConveyorComponent);
                }
            }
            if (this.conveyorComponent) {
                const conveyor = this.conveyorComponent;
                if (conveyor.isOverflow) {
                    return; // Disabled during sustained overflow
                }
            }
        }

        const pt = this.getParticleCoords(pointer);
        const settings = this.game.SETTINGS || {};
        const brushRadius = settings.brush_radius || 25;

        let totalActivated = 0;

        if (this.lastParticleX !== null && this.lastParticleY !== null) {
            const dx = pt.particleX - this.lastParticleX;
            const dy = pt.particleY - this.lastParticleY;
            const dist = Math.hypot(dx, dy);
            const stepSize = Math.max(4, brushRadius * 0.4);
            const steps = Math.max(1, Math.ceil(dist / stepSize));

            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const ix = this.lastParticleX + dx * t;
                const iy = this.lastParticleY + dy * t;
                totalActivated += this.gridComponent.brushAt(ix, iy, brushRadius);
            }
        } else {
            totalActivated += this.gridComponent.brushAt(pt.particleX, pt.particleY, brushRadius);
        }

        // Record trail point using pre-allocated pool
        if (!this._trailPool) {
            this._trailPool = [];
            for (let i = 0; i < 120; i++) {
                this._trailPool.push({ x: 0, y: 0, time: 0 });
            }
        }
        const now = (this.game.time && this.game.time.now) ? this.game.time.now : performance.now();
        let ptObj;
        if (this.trailPoints.length > 0 && (now - this.trailPoints[0].time) > this.trailLifetime) {
            ptObj = this.trailPoints.shift();
        } else if (this._trailPool.length > 0) {
            ptObj = this._trailPool.pop();
        } else {
            ptObj = { x: 0, y: 0, time: 0 };
        }
        ptObj.x = pt.localX;
        ptObj.y = pt.localY;
        ptObj.time = now;
        this.trailPoints.push(ptObj);

        this.lastParticleX = pt.particleX;
        this.lastParticleY = pt.particleY;
        this.lastLocalX = pt.localX;
        this.lastLocalY = pt.localY;
    }

    renderTrail() {
        if (!this.brushGraphics) return;

        const now = (this.game.time && this.game.time.now) ? this.game.time.now : performance.now();

        // Prune expired trail points back to pool
        while (this.trailPoints.length > 0 && (now - this.trailPoints[0].time) > this.trailLifetime) {
            const recycled = this.trailPoints.shift();
            if (this._trailPool && this._trailPool.length < 120) {
                this._trailPool.push(recycled);
            }
        }

        this.brushGraphics.clear();

        if (this.trailPoints.length < 2) {
            if (this.trailPoints.length === 1) {
                const p = this.trailPoints[0];
                const age = now - p.time;
                const lifeRatio = 1.0 - (age / this.trailLifetime);
                if (lifeRatio > 0) {
                    const radius = (this.baseTrailWidth / 2) * lifeRatio;
                    this.brushGraphics.fillStyle(0xffffff, lifeRatio * 0.75);
                    this.brushGraphics.fillCircle(p.x, p.y, radius);
                }
            }
            return;
        }

        // Draw segments with width and opacity decreasing towards the trailing tail edge
        const total = this.trailPoints.length;
        for (let i = 0; i < total - 1; i++) {
            const p0 = this.trailPoints[i];
            const p1 = this.trailPoints[i + 1];

            const age0 = now - p0.time;
            const age1 = now - p1.time;
            const avgAge = (age0 + age1) * 0.5;

            // Age factor: 1.0 at brand new, 0.0 at trailLifetime (fades out immediately)
            const ageFactor = Math.max(0, Math.min(1.0, 1.0 - (avgAge / this.trailLifetime)));
            // Position factor: 0.0 at oldest tail edge, 1.0 at pointer tip
            const posFactor = (i + 0.5) / (total - 1);

            // Decreases towards the edge as swipe moves: width is twice as big (up to ~24px at head)
            const width = Math.max(1.5, this.baseTrailWidth * posFactor * ageFactor);
            // Glowing white opacity: strongest at head, smoothly tapering to transparent at tail edge
            const alpha = Math.max(0.01, Math.min(0.85, 0.85 * posFactor * ageFactor));

            this.brushGraphics.lineStyle(width, 0xffffff, alpha);
            this.brushGraphics.beginPath();
            this.brushGraphics.moveTo(p0.x, p0.y);
            this.brushGraphics.lineTo(p1.x, p1.y);
            this.brushGraphics.strokePath();

            // Smooth rounded joints
            this.brushGraphics.fillStyle(0xffffff, alpha);
            this.brushGraphics.fillCircle(p1.x, p1.y, width * 0.5);
        }
    }

    initGL(gl, component) {
        this.gl = gl;

        // Compile Shaders
        const vertShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertShader, this.vertShaderSource);
        gl.compileShader(vertShader);
        if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
            console.error("[SandGrid] Vertex Shader error:", gl.getShaderInfoLog(vertShader));
        }

        const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragShader, this.fragShaderSource);
        gl.compileShader(fragShader);
        if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
            console.error("[SandGrid] Fragment Shader error:", gl.getShaderInfoLog(fragShader));
        }

        this.program = gl.createProgram();
        gl.attachShader(this.program, vertShader);
        gl.attachShader(this.program, fragShader);
        gl.linkProgram(this.program);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error("[SandGrid] Program link error:", gl.getProgramInfoLog(this.program));
        }

        this.aPositionLoc = gl.getAttribLocation(this.program, "aPosition");
        this.aColorLoc = gl.getAttribLocation(this.program, "aColor");

        this.uResolutionLoc = gl.getUniformLocation(this.program, "uResolution");
        this.uCameraScrollLoc = gl.getUniformLocation(this.program, "uCameraScroll");
        this.uCameraZoomLoc = gl.getUniformLocation(this.program, "uCameraZoom");
        this.uImageOffsetLoc = gl.getUniformLocation(this.program, "uImageOffset");
        this.uImageScaleLoc = gl.getUniformLocation(this.program, "uImageScale");
        this.uPointSizeLoc = gl.getUniformLocation(this.program, "uPointSize");
        this.uDarkenFactorLoc = gl.getUniformLocation(this.program, "uDarkenFactor");

        this.uWaveRadiusLoc = gl.getUniformLocation(this.program, "uWaveRadius");
        this.uWaveThicknessLoc = gl.getUniformLocation(this.program, "uWaveThickness");
        this.uWaveHeightLoc = gl.getUniformLocation(this.program, "uWaveHeight");

        // Buffers
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, component.positions, gl.DYNAMIC_DRAW);

        this.colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, component.colors, gl.DYNAMIC_DRAW);

        // Index buffer for Y-sorted drawing
        this.indexBuffer = gl.createBuffer();
        this.indices = new Uint16Array(component.particleCount);
        for (let i = 0; i < component.particleCount; i++) {
            this.indices[i] = i;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.DYNAMIC_DRAW);
        this.indicesInitialized = false;

        this.particleCount = component.particleCount;

        // Force a full position and color re-upload after (re-)init
        // This ensures the new GL context buffers are fully populated with current state
        component.dirtyMinIndex = 0;
        component.dirtyMaxIndex = component.particleCount - 1;
        component.isDirty = true;
        component.colorDirtyMinIndex = 0;
        component.colorDirtyMaxIndex = component.particleCount - 1;
        component.isColorDirty = true;

        this.glInit = true;
    }

    update(world, time, delta) {
        if (!this.gridComponent) {
            const entities = world.getEntitiesWith([SandGridComponent]);
            if (entities.length > 0) {
                this.gridComponent = entities[0].getComponent(SandGridComponent);
            }
        }

        // Smoothly darken sand image when conveyor is full / overflowed
        let targetDarken = 1.0;
        if (world) {
            if (!this.conveyorComponent) {
                const conveyorEntities = world.getEntitiesWith([ConveyorComponent]);
                if (conveyorEntities.length > 0) {
                    this.conveyorComponent = conveyorEntities[0].getComponent(ConveyorComponent);
                }
            }
            if (this.conveyorComponent) {
                const conveyor = this.conveyorComponent;
                if (conveyor.isOverflow) {
                    const settings = this.game.SETTINGS || {};
                    targetDarken = settings.image_darken_on_overflow !== undefined ? settings.image_darken_on_overflow : 0.40;
                }
            }
        }

        if (this.currentDarkenFactor === undefined) this.currentDarkenFactor = 1.0;
        const diff = targetDarken - this.currentDarkenFactor;
        const dtSec = (delta || 16) * 0.001;
        this.currentDarkenFactor += diff * Math.min(1.0, dtSec * 5.0);

        if (this.waveDelay > 0) {
            this.waveDelay -= dtSec;
        } else if (this.waveRadius < 1500.0) {
            this.waveRadius += dtSec * this.waveSpeed;
        }

        // Evaluate buffered pointer movement strictly once per frame
        if (this.canSwipe && (this.pendingPointerMove || (this.isPointerDown && this.currentPointer))) {
            if (this.currentPointer) {
                this.applyBrush(this.currentPointer);
            }
            this.pendingPointerMove = false;
        }

        // Continually update and fade the swipe tail
        this.renderTrail();
    }

    render(renderer, camera, calcMatrix) {
        if (!this.gridComponent && this.game.ecsWorld) {
            const entities = this.game.ecsWorld.getEntitiesWith([SandGridComponent]);
            if (entities.length > 0) {
                this.gridComponent = entities[0].getComponent(SandGridComponent);
            }
        }
        if (!this.gridComponent) return;

        // Flush Phaser's pipeline to avoid corrupting its state
        if (renderer.pipelines) {
            renderer.pipelines.clear();
        } else if (renderer.flush) {
            renderer.flush();
        }

        const gl = renderer.gl;

        // Detect GL context recreation after window resize (Phaser may recreate its WebGL context)
        // If our stored gl reference differs from the current one, our old program/buffers are invalid - re-init
        if (this.glInit && this.gl !== gl) {
            this.glInit = false;
            this.indicesInitialized = false;
        }

        if (!this.glInit) {
            this.initGL(gl, this.gridComponent);
        }

        const settings = this.game.SETTINGS || {};
        const mainContainer = this.game.mainContainer;
        const containerScale = (mainContainer && mainContainer.scaleX !== undefined) ? mainContainer.scaleX : (this.game.size?.scale || 1.0);
        const containerX = mainContainer ? mainContainer.x : (camera.width / 2 - 300 * containerScale);
        const containerY = mainContainer ? mainContainer.y : (camera.height / 2 - 450 * containerScale);

        // Logical center inside 600x900 viewport:
        const logicalX = settings.image_logical_x !== undefined ? settings.image_logical_x : 300;
        const logicalY = settings.image_logical_y !== undefined ? settings.image_logical_y : 245;
        const baseScale = settings.image_scale || 0.70;

        // Position on device screen:
        const screenX = containerX + logicalX * containerScale;
        const screenY = containerY + logicalY * containerScale;

        // Offset from camera center:
        const offsetX = screenX - (camera.width / 2);
        const offsetY = screenY - (camera.height / 2);
        const imageScale = baseScale * containerScale;

        this.imageOffset = { x: logicalX, y: logicalY };
        this.imageScale = baseScale;

        const wasDirty = this.gridComponent.isDirty;
        // Synchronize updated particle positions to GPU shader
        if (this.gridComponent.isDirty) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            const minIdx = Math.max(0, this.gridComponent.dirtyMinIndex);
            const maxIdx = Math.min(this.gridComponent.particleCount - 1, this.gridComponent.dirtyMaxIndex);
            if (minIdx <= maxIdx) {
                const byteOffset = minIdx * 2 * 4;
                const subArray = this.gridComponent.positions.subarray(minIdx * 2, (maxIdx + 1) * 2);
                gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, subArray);
            }
            this.gridComponent.resetDirty();
        }

        // Synchronize updated particle colors to GPU shader
        if (this.gridComponent.isColorDirty) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
            const minIdx = Math.max(0, this.gridComponent.colorDirtyMinIndex);
            const maxIdx = Math.min(this.gridComponent.particleCount - 1, this.gridComponent.colorDirtyMaxIndex);
            if (minIdx <= maxIdx) {
                const byteOffset = minIdx * 4 * 4;
                const subArray = this.gridComponent.colors.subarray(minIdx * 4, (maxIdx + 1) * 4);
                gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, subArray);
            }
            this.gridComponent.resetColorDirty();
        }

        const pInfo = this.game && this.game.getParticleSize ? this.game.getParticleSize() : null;
        const baseParticleScale = pInfo ? pInfo.baseScale : (settings.particle_scale || this.particleScale || 5.0);
        const targetPointSize = Math.max(baseParticleScale * imageScale, 1.0);

        // Sort indices by Y using O(N) Bucket Sort so higher particles are drawn first, lower particles drawn last (greater z-index)
        // Ensure sleeping particles do not trigger unnecessary CPU bucket sorts or GPU index buffer re-uploads
        const shouldSortIndices = !this.indicesInitialized || (wasDirty && this.gridComponent.hasMovingParticles);
        if (shouldSortIndices) {
            const pos = this.gridComponent.positions;
            const N = this.particleCount;

            // Initialize bucket arrays if not already initialized
            const NUM_BUCKETS = 512;
            if (!this.bucketCounts || this.bucketCounts.length !== NUM_BUCKETS) {
                this.bucketCounts = new Int32Array(NUM_BUCKETS);
                this.bucketOffsets = new Int32Array(NUM_BUCKETS);
            } else {
                this.bucketCounts.fill(0);
            }

            // 1. Pass 1: Count frequency in each bucket
            // Y positions range from ~0 to ~600 (logical grid coords)
            const minY = 0.0;
            const maxY = 650.0;
            const bucketScale = (NUM_BUCKETS - 1) / (maxY - minY);

            for (let i = 0; i < N; i++) {
                const y = pos[i * 2 + 1];
                let bIdx = ((y - minY) * bucketScale) | 0;
                if (bIdx < 0) bIdx = 0;
                else if (bIdx >= NUM_BUCKETS) bIdx = NUM_BUCKETS - 1;
                this.bucketCounts[bIdx]++;
            }

            // 2. Pass 2: Compute prefix sums (bucket offsets)
            let offset = 0;
            for (let b = 0; b < NUM_BUCKETS; b++) {
                this.bucketOffsets[b] = offset;
                offset += this.bucketCounts[b];
            }

            // 3. Pass 3: Scatter indices into sorted target array
            for (let i = 0; i < N; i++) {
                const y = pos[i * 2 + 1];
                let bIdx = ((y - minY) * bucketScale) | 0;
                if (bIdx < 0) bIdx = 0;
                else if (bIdx >= NUM_BUCKETS) bIdx = NUM_BUCKETS - 1;

                const destIndex = this.bucketOffsets[bIdx]++;
                this.indices[destIndex] = i;
            }

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.indices);
            this.indicesInitialized = true;
        }

        // Enable Depth Test with LEQUAL so lower particles occlude higher particles
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.SCISSOR_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Bind Program
        gl.useProgram(this.program);

        // Set Uniforms
        gl.uniform2f(this.uResolutionLoc, camera.width, camera.height);
        gl.uniform2f(this.uCameraScrollLoc, camera.scrollX || 0.0, camera.scrollY || 0.0);
        gl.uniform1f(this.uCameraZoomLoc, camera.zoom || 1.0);
        gl.uniform2f(this.uImageOffsetLoc, offsetX, offsetY);
        gl.uniform1f(this.uImageScaleLoc, imageScale);
        gl.uniform1f(this.uPointSizeLoc, targetPointSize);
        gl.uniform1f(this.uDarkenFactorLoc, (this.currentDarkenFactor !== undefined ? this.currentDarkenFactor : 1.0));

        gl.uniform1f(this.uWaveRadiusLoc, this.waveRadius);
        gl.uniform1f(this.uWaveThicknessLoc, this.waveThickness);
        gl.uniform1f(this.uWaveHeightLoc, this.waveHeight);

        // Bind Attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.aPositionLoc);
        gl.vertexAttribPointer(this.aPositionLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.enableVertexAttribArray(this.aColorLoc);
        gl.vertexAttribPointer(this.aColorLoc, 4, gl.FLOAT, false, 0, 0);

        // Draw with Y-sorted index buffer
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.POINTS, this.particleCount, gl.UNSIGNED_SHORT, 0);

        // Unbind and restore GL state to keep Phaser clean
        gl.depthMask(true);
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.depthMask(false);
        gl.disable(gl.DEPTH_TEST);
        gl.disableVertexAttribArray(this.aPositionLoc);
        gl.disableVertexAttribArray(this.aColorLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

        if (renderer.pipelines && typeof renderer.pipelines.rebind === 'function') {
            renderer.pipelines.rebind();
        }
    }
}
