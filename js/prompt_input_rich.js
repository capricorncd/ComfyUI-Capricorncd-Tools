import { app } from "../../scripts/app.js";
import { attachRichPromptHandler } from "./rich_prompt.js";

app.registerExtension({
    name: "Capricorncd.RichPromptInput",

    nodeCreated(node) {
        if (node.comfyClass !== "CAP_RichPromptInput") return;

        for (const widget of node.widgets ?? []) {
            if (widget.name !== "prompt") continue;

            const ta = widget.inputEl ?? widget.element;
            if (ta instanceof HTMLTextAreaElement) {
                attachRichPromptHandler(ta, { mode: "widget" });
            } else if (ta) {
                const inner = ta.querySelector?.("textarea");
                if (inner) attachRichPromptHandler(inner, { mode: "widget" });
            }
            break;
        }
    },
});
