/**
 * Fireworks animation for victory celebration.
 * Creates multiple bursts of colorful, scattering particle fireworks across the screen.
 * All parameters can be tuned via game-settings.json under the "fireworks" key.
 */
export class Fireworks {
    constructor(scene, container, config = {}) {
        this.scene = scene;
        this.container = container;
        this.config = Object.assign({
            burst_count: 6,
            burst_delay_ms: 280,
            particles_per_burst: 45,
            colors: [0xffd700, 0xff3366, 0x00adff, 0x00ff00, 0xff00ff, 0xffffff, 0x00ffff],
            speed_min: 120,
            speed_max: 340,
            gravity: 180,
            duration_ms: 1200,
            particle_radius: 4.5
        }, config);

        this.graphics = this.scene.add.graphics();
        this.graphics.setDepth(90);
        if (this.container) {
            this.container.add(this.graphics);
        }
        this.particles = [];
        this.running = false;
        this.events = [];
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.particles = [];

        const burstCount = this.config.burst_count || 6;
        const burstDelay = this.config.burst_delay_ms || 280;

        // Spread bursts naturally across the upper/mid area of the screen
        const burstPositions = [
            { x: 300, y: 320 },
            { x: 180, y: 240 },
            { x: 420, y: 260 },
            { x: 220, y: 400 },
            { x: 380, y: 380 },
            { x: 300, y: 200 }
        ];

        for (let i = 0; i < burstCount; i++) {
            const pos = burstPositions[i % burstPositions.length];
            const jitterX = pos.x + (Math.random() * 60 - 30);
            const jitterY = pos.y + (Math.random() * 50 - 25);

            const timer = this.scene.time.delayedCall(i * burstDelay, () => {
                if (!this.running) return;
                this.burst(jitterX, jitterY);
            });
            this.events.push(timer);
        }
    }

    burst(originX, originY) {
        const count = this.config.particles_per_burst || 45;
        const colors = this.config.colors || [0xffd700, 0xff3366, 0x00adff];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const speedMin = this.config.speed_min || 120;
        const speedMax = this.config.speed_max || 340;
        const duration = this.config.duration_ms || 1200;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = speedMin + Math.random() * (speedMax - speedMin);
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            const radius = (this.config.particle_radius || 4) * (0.6 + Math.random() * 0.7);

            this.particles.push({
                x: originX,
                y: originY,
                vx,
                vy,
                color,
                radius,
                life: 1.0,
                decay: 1000 / duration
            });
        }
    }

    update(delta) {
        if (!this.running || !this.graphics) return;

        const dt = delta / 1000;
        const gravity = this.config.gravity !== undefined ? this.config.gravity : 75;
        const drag = this.config.drag !== undefined ? this.config.drag : 0.965;
        // Frame-rate independent drag factor based on dt
        const dragFactor = Math.pow(drag, dt * 60);

        this.graphics.clear();

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= p.decay * dt;

            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            p.vy += gravity * dt;
            p.vx *= dragFactor;
            p.vy *= dragFactor;
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            const progress = 1.0 - p.life;
            // Smooth bell curve for scale: starts expanding to 1.3x at peak, then smoothly settles
            let scaleMultiplier;
            if (progress < 0.25) {
                scaleMultiplier = 0.7 + 0.6 * Math.sin((progress / 0.25) * Math.PI * 0.5); // 0.7 -> 1.3
            } else {
                scaleMultiplier = 1.3 * Math.pow(p.life / 0.75, 0.7); // smooth float fade
            }

            const alpha = Math.max(0, Math.min(1, p.life * 1.15));
            const currentRadius = Math.max(0.5, p.radius * scaleMultiplier);

            this.graphics.fillStyle(p.color, alpha);
            this.graphics.fillCircle(p.x, p.y, currentRadius);
        }
    }

    stop() {
        this.running = false;
        for (const ev of this.events) {
            if (ev) ev.remove();
        }
        this.events = [];
        this.particles = [];
        if (this.graphics) {
            this.graphics.clear();
        }
    }

    destroy() {
        this.stop();
        if (this.graphics) {
            this.graphics.destroy();
            this.graphics = null;
        }
    }
}
