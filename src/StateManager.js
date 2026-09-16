export default class StateManager {
    constructor(flow = []) {
        this.flow = flow;
        this.currentIndex = 0;
    }

    getNextScene() {
        if (Array.isArray(this.flow) && this.flow.length > 0) {
            const scene = this.flow[this.currentIndex % this.flow.length];
            return typeof scene === 'string' ? scene : (scene[0] || 'scene-1');
        }
        return 'scene-1';
    }
}
