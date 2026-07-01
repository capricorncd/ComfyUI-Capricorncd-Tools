export class EventEmitter {
  #events = new Map();

  on(event, listener) {
    if (!this.#events.has(event)) this.#events.set(event, []);
    this.#events.get(event).push(listener);
    return this;
  }

  off(event, listener) {
    if (!this.#events.has(event)) return this;
    this.#events.set(event, this.#events.get(event).filter(l => l !== listener));
    return this;
  }

  emit(event, data) {
    this.#events.get(event)?.forEach(l => l(data));
    return this;
  }

  once(event, listener) {
    const w = (d) => { listener(d); this.off(event, w); };
    return this.on(event, w);
  }

  removeAllListeners(event) {
    event ? this.#events.delete(event) : this.#events.clear();
    return this;
  }
}
