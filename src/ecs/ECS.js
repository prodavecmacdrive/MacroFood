export class Entity {
    constructor() {
        this.id = Math.random().toString(36).substring(2, 9);
        this.components = {};
    }
    addComponent(component) {
        this.components[component.constructor.name] = component;
        return this;
    }
    removeComponent(componentClass) {
        delete this.components[componentClass.name];
        return this;
    }
    getComponent(componentClass) {
        return this.components[componentClass.name];
    }
    hasComponent(componentClass) {
        return !!this.components[componentClass.name];
    }
}

export class World {
    constructor() {
        this.entities = [];
        this.systems = [];
    }
    addEntity(entity) {
        this.entities.push(entity);
        return entity;
    }
    removeEntity(entity) {
        const index = this.entities.indexOf(entity);
        if (index !== -1) {
            this.entities.splice(index, 1);
        }
    }
    addSystem(system) {
        this.systems.push(system);
        return system;
    }
    getSystem(systemClassOrName) {
        return this.systems.find(s => 
            s === systemClassOrName || 
            s.constructor === systemClassOrName || 
            s.constructor.name === systemClassOrName
        );
    }
    update(time, delta) {
        for (const system of this.systems) {
            system.update(this, time, delta);
        }
    }
    getEntitiesWith(componentClasses) {
        return this.entities.filter(e => {
            for (const cls of componentClasses) {
                if (!e.hasComponent(cls)) return false;
            }
            return true;
        });
    }
}

export class System {
    constructor(game) {
        this.game = game;
    }
    update(world, time, delta) {}
}

export class Position {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
}

export class View {
    constructor(sprite) {
        this.sprite = sprite;
    }
}

export class Draggable {
    constructor() {
        this.isDragging = false;
        this.pointerOffset = { x: 0, y: 0 };
    }
}

export class Mergeable {
    constructor(type, level) {
        this.type = type;
        this.level = level; // 1, 2, or 3
    }
}

export class OrderTarget {
    constructor() {
        this.isFlying = false;
    }
}
