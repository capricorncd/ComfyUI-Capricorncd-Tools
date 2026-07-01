export class PlayHead {
  constructor(timeline) {
    this.timeline = timeline;
    this.el = this._build();
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'tl-playhead';

    const head = document.createElement('div');
    head.className = 'tl-playhead-head';

    const line = document.createElement('div');
    line.className = 'tl-playhead-line';

    el.appendChild(head);
    el.appendChild(line);

    head.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const tl = this.timeline;

      const onMove = (e) => {
        const rect = tl.scrollEl.getBoundingClientRect();
        const x = e.clientX - rect.left + tl.scrollEl.scrollLeft;
        tl.setCurrentTime(Math.max(0, x / tl.pixelsPerSecond));
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    return el;
  }

  update() {
    const x = this.timeline.currentTime * this.timeline.pixelsPerSecond;
    this.el.style.transform = `translateX(${x}px)`;
  }
}
