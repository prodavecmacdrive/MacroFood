### 1. Architectural & Render Optimizations (No Visual Changes)
These optimizations strictly maintain the current look and behavior of the game while vastly improving the frame rate:

*   **Batch Render Falling Particles (`ConveyorSystem.js`)**: Currently, every single falling particle (`activeSpoutDrops`) and flying particle (`activeCupTransfers`) uses its own separate `Phaser.GameObjects.Graphics` object (managed via `dropGfxPool`). Having hundreds of active GameObjects on the display list is a massive bottleneck in Phaser.
    *   **Solution**: We can consolidate all falling and flying particles into a single `batchGraphics` object (similar to how the conveyor belt works). This reduces draw calls from hundreds down to exactly one.
*   **Conveyor Loop Reduction**: The conveyor loop iterates through up to 4,600 individual particles every frame and calls `fillRect` twice for each (shadow + top half), resulting in up to 9,200 drawing operations per frame.
    *   **Solution**: Since particles on the belt move at a constant speed and form continuous lines of color, we can group contiguous particles of the same color into larger "segments" and draw them as single elongated rectangles instead of hundreds of tiny squares.
*   **Reduce Physics Sub-steps (`SandGridComponent.js`)**: The physics solver currently runs 4 sub-steps per frame (`physics_sub_steps = 4`). For thousands of active particles, this multiplies collision checks by 4.
    *   **Solution**: We can reduce this to `1` or `2` sub-steps. To maintain collision stability and prevent particles from falling through walls, we can slightly increase the spatial hash grid size or adjust the continuous collision detection (CCD) thresholds.

### 2. Static Animation Overhauls (Maximum Performance)
As you suggested, since the physics after the particles fall out of the funnel is unimportant, we can completely replace the rigid particle logic on the conveyor and cups with static animations to achieve peak optimization:

*   **RenderTexture for the Conveyor Belt**: Instead of tracking an array of thousands of particles, we can use a single scrolling `Phaser.GameObjects.RenderTexture` or a shader. When sand drops from the spout, we simply "stamp" a colored square onto the texture. As the conveyor updates, the texture simply scrolls left or right. This turns thousands of calculations into one simple texture scroll.
*   **Simplified Cup Transfers**: We can completely remove the quadratic bezier curve calculations (`activeCupTransfers`). When sand reaches the end of the conveyor, we increment the cup's fill counter and update a static animation (e.g., scaling a colored rectangle upwards from the bottom of the cup).

### 3. Improvements to Visual Interaction (UX/Polish)
If we transition to static animations, we can actually make the game look *better* while being more performant:

*   **Cup Splashes**: Instead of blocky squares flying into the cups, we can use a lightweight `Phaser.GameObjects.Particles.ParticleEmitter` positioned over the cup. When a color drops in, it emits a brief, smooth splash of colored pixels, giving a satisfying "liquid sand" feel.
*   **Continuous Sand Stream**: When the funnel releases a large amount of sand at once, instead of rendering individual falling squares, we can stretch a colored line or sprite from the spout to the conveyor. This simulates a heavy, continuous flow of sand (like a waterfall) and is virtually free to render.
