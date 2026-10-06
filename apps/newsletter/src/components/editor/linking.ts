// The one way both editors link text: the toolbar button and ⌘K / Ctrl+K (the
// shortcut Google Docs taught everyone) call the same function.

import { Extension, type Editor } from "@tiptap/core";
import { urlFromSelection, withScheme } from "./linkUrl.js";

/** Link the selection. When the highlighted text is a web address and not
 *  already a link, it is linked to itself with no prompt — highlighting
 *  "signupgenius.com/go/abc" and pressing ⌘K is the whole job. Otherwise the
 *  prompt asks for the URL, prefilled with any link already there; clearing it
 *  removes the link. */
export function linkSelection(editor: Editor): void {
  const { from, to, empty } = editor.state.selection;
  if (!empty && !editor.isActive("link")) {
    const href = urlFromSelection(editor.state.doc.textBetween(from, to, " "));
    if (href) {
      editor.chain().focus().setLink({ href }).run();
      return;
    }
  }
  const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
  const url = window.prompt("Link URL", previous);
  if (url === null) return;
  if (url.trim() === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: withScheme(url.trim()) }).run();
}

/** ⌘K on a Mac, Ctrl+K elsewhere. Returning true stops the browser's own
 *  binding, which on Windows and Linux focuses the address bar's search. */
export const LinkShortcut = Extension.create({
  name: "linkShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        linkSelection(this.editor);
        return true;
      },
    };
  },
});

/** The shortcut as this reader's keyboard writes it, for the button's tooltip. */
export const LINK_SHORTCUT_LABEL =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";
