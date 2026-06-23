import { app } from "../../scripts/app.js";
import { bindRichPromptWidget } from "./rich_prompt.js";

function scheduleBind(widget, node) {
    const tryBind = (tries = 0) => {
        if (bindRichPromptWidget(widget)) return;
        if (tries < 100 && document.contains(node?.el ?? node)) {
            setTimeout(() => tryBind(tries + 1), 50);
        }
    };
    tryBind();
}

app.registerExtension({
    name: "Capricorncd.RichPromptInput",

    nodeCreated(node) {
        if (node.comfyClass !== "CAP_RichPromptInput") return;

        for (const widget of node.widgets ?? []) {
            if (widget.name !== "prompt") continue;
            scheduleBind(widget, node);
            break;
        }
    },
});
