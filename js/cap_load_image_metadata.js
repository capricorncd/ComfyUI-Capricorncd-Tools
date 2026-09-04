import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

app.registerExtension({
    name: "Capricorncd.LoadImageMetadata",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "CAP_LoadImageMetadata") return;

        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            created?.apply(this, arguments);
            const fields = {};
            for (const [key, label] of [["prompt", "提示词"], ["description", "描述"]]) {
                const { widget } = ComfyWidgets.STRING(this, `metadata_${key}`, ["STRING", { multiline: true }], app);
                widget.inputEl.readOnly = true;
                widget.inputEl.spellcheck = false;
                widget.inputEl.placeholder = `${label}：图片没有相应信息时为空`;
                widget.options.serialize = false;
                fields[key] = widget;
            }
            this.capSetImageMetadata = (data) => {
                for (const key of Object.keys(fields)) fields[key].value = data[key] ?? "";
                app.graph.setDirtyCanvas(true, false);
            };
            let revision = 0;
            this.capRefreshImageMetadata = async () => {
                const current = ++revision;
                this.capSetImageMetadata({});
                const image = this.widgets?.find((widget) => widget.name === "image")?.value;
                if (!image) return;
                try {
                    const response = await api.fetchApi(`/cap/image_metadata?image=${encodeURIComponent(image)}`);
                    const data = await response.json();
                    if (current !== revision) return;
                    this.capSetImageMetadata(response.ok ? data : { description: data.error });
                } catch {
                    if (current === revision) this.capSetImageMetadata({ description: "读取失败，请运行节点重试。" });
                }
            };
            const imageWidget = this.widgets?.find((widget) => widget.name === "image");
            if (imageWidget) {
                const callback = imageWidget.callback;
                const node = this;
                imageWidget.callback = function () {
                    const result = callback?.apply(this, arguments);
                    void node.capRefreshImageMetadata();
                    return result;
                };
            }
            this.setSize([Math.max(this.size[0], 360), Math.max(this.size[1], 560)]);
            queueMicrotask(() => this.capRefreshImageMetadata());
        };

        const configured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            configured?.apply(this, arguments);
            void this.capRefreshImageMetadata?.();
        };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            executed?.apply(this, arguments);
            this.capSetImageMetadata?.({ prompt: message.prompt?.[0], description: message.description?.[0] });
        };
    },
});
