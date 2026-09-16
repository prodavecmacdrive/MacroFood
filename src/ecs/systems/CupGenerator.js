import defaultSandData from '../../../assets/sand_image.json';

/**
 * CupGenerator
 * 
 * Parses sand_image.json and generates the cup queue based on:
 * - sand_image.json colors and quantities
 * - Target cup capacity (pot_capacity from game settings)
 * - Remainder cup handling for colors with fewer particles than pot_capacity
 * 
 * Outputs particle count, per-color breakdown, and total cup count to console.
 */
export function generateCupQueue(sandDataInput, targetPotCapacity = 250) {
    const rawData = sandDataInput || defaultSandData;
    const sandData = (rawData && rawData.default) ? rawData.default : rawData;
    const dots = sandData.dots || [];
    const w = sandData.width || 128;
    const h = sandData.height || 128;
    const potCapacity = Math.max(1, targetPotCapacity);

    // 1. Parse colors and total quantity from sand_image.json
    const totalParticles = dots.length;
    const colorCounts = new Map(); // colorInt -> count
    const firstSeen = new Map();

    for (let i = 0; i < totalParticles; i++) {
        const color = dots[i];
        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
        if (!firstSeen.has(color)) {
            firstSeen.set(color, i);
        }
    }

    // 2. Track top-most row (min row index) where each color appears in the image
    const topMostRow = new Map();
    for (let r = 0; r < h; r++) {
        const rowOffset = r * w;
        for (let c = 0; c < w; c++) {
            const color = dots[rowOffset + c];
            if (!topMostRow.has(color) || r < topMostRow.get(color)) {
                topMostRow.set(color, r);
            }
        }
    }

    // 3. Scan image bottom-up (matching the physical sand drain order)
    // Whenever a color accumulates pot_capacity particles, allocate a cup.
    // When scanning reaches the top-most row for that color, allocate a remainder cup.
    const queue = [];
    const accumulated = new Map();

    for (let r = h - 1; r >= 0; r--) {
        const rowOffset = r * w;
        for (let c = 0; c < w; c++) {
            const color = dots[rowOffset + c];
            const acc = (accumulated.get(color) || 0) + 1;
            accumulated.set(color, acc);

            if (acc >= potCapacity) {
                queue.push({
                    color: color,
                    acceptedColors: new Set([color]),
                    capacity: potCapacity
                });
                accumulated.set(color, 0);
            }
        }

        // Color completed in image -> allocate remainder cup if particles exist
        for (const [color, minR] of topMostRow.entries()) {
            if (r === minR) {
                const rem = accumulated.get(color) || 0;
                if (rem > 0) {
                    queue.push({
                        color: color,
                        acceptedColors: new Set([color]),
                        capacity: rem
                    });
                    accumulated.set(color, 0);
                }
            }
        }
    }

    // Failsafe for any leftover particles
    for (const [color, acc] of accumulated) {
        if (acc > 0) {
            queue.push({
                color: color,
                acceptedColors: new Set([color]),
                capacity: acc
            });
        }
    }

    // 4. Output detailed diagnostics to console at startup
    const totalCups = queue.length;
    console.log('%c[CupGenerator] Initialized from sand_image.json', 'color: #3b82f6; font-weight: bold; font-size: 13px;');
    console.log(`[CupGenerator] Total particles in sand_image.json: ${totalParticles}`);
    console.log(`[CupGenerator] Total unique colors: ${colorCounts.size}`);
    console.log(`[CupGenerator] Total cups generated: ${totalCups} (target pot_capacity: ${potCapacity})`);

    const breakdownTable = [];
    for (const [colorInt, count] of colorCounts) {
        const hex = '#' + colorInt.toString(16).padStart(6, '0');
        const cupsForColor = queue.filter(q => q.color === colorInt);
        const capacities = cupsForColor.map(q => q.capacity);
        const sumCapacity = capacities.reduce((a, b) => a + b, 0);

        console.log(`  - Color ${hex} (${colorInt}): ${count} particles -> ${cupsForColor.length} cups [capacities: ${capacities.join(', ')}]`);

        breakdownTable.push({
            Hex: hex,
            Int: colorInt,
            'Particle Count': count,
            'Cup Count': cupsForColor.length,
            'Total Cup Capacity': sumCapacity,
            'Capacities': capacities.join(', ')
        });
    }

    if (console.table) {
        console.table(breakdownTable);
    }

    return {
        queue,
        colorCounts,
        totalParticles,
        totalCups
    };
}
