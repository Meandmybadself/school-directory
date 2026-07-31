// The footer authoring surface: the same TipTap editor the composer uses, but
// bound to an HTML string instead of a TipTap document.
//
// The footer is stored as HTML (settings.footerHtml), not as TipTap JSON, and
// that stays true — `sanitizeFooterHtml` is still the single seam every footer
// passes through on write, and the email and archive pages still read the same
// stored markup. This component only changes how an admin produces it.
//
// The extension set is pinned to FOOTER_TAGS in @sd/shared's newsletterRender.ts,
// the same correspondence Editor.tsx keeps with the renderer: a button here whose
// tag the sanitizer drops would silently discard the admin's work on save. Note
// h1/h2 are absent — the footer allowlist starts at h3 — and `code` is disabled
// because <code> isn't on it either.
//
// Not everything the sanitizer allows can be drawn by this toolbar: layout
// tables, <div>/<span> wrappers and inline styles are all legal in a stored
// footer but have no TipTap node here, and loading them into the editor would
// quietly flatten them. Hence the HTML mode, and hence `needsHtmlMode` (in
// lib/footerMode.ts) — a footer that already contains such markup opens in HTML
// mode rather than getting mangled on first keystroke.

import { useCallback, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor as TipTapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Icon, type IconName } from "../Icon.js";
import { api, errorMessage } from "../../lib/api.js";
import { needsHtmlMode } from "../../lib/footerMode.js";

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon?: IconName;
  label?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nlx-tool${active ? " on" : ""}`}
      title={label}
      aria-label={label}
      // Keep the selection: a toolbar button that steals focus would apply its
      // mark to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={16} stroke={2} /> : <span>{label}</span>}
    </button>
  );
}

function Toolbar({ editor }: { editor: TipTapEditor }) {
  const fileInput = useRef<HTMLInputElement>(null);

  const setLink = useCallback(() => {
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Link URL", previous);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    // A bare domain is what people type; without a scheme the sanitizer would
    // drop the href as unsafe, so normalize here rather than silently losing it.
    const href = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }, [editor]);

  const upload = useCallback(
    async (file: File) => {
      try {
        const { url } = await api.uploadMedia(file);
        editor.chain().focus().setImage({ src: url }).run();
      } catch (err) {
        window.alert(errorMessage(err, "That image couldn't be uploaded."));
      }
    },
    [editor],
  );

  return (
    <div className="nlx-toolbar">
      <ToolButton label="H3" active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <ToolButton label="H4" active={editor.isActive("heading", { level: 4 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} />
      <span className="nlx-tool-sep" />
      <ToolButton label="B" active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolButton label="I" active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolButton label="S" active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()} />
      <span className="nlx-tool-sep" />
      <ToolButton icon="link" label="Link" active={editor.isActive("link")} onClick={setLink} />
      <ToolButton label="• List" active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolButton label="1. List" active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolButton icon="minus" label="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <ToolButton icon="upload" label="Image" onClick={() => fileInput.current?.click()} />
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

/** Mounted fresh whenever the mode flips, so it picks up whatever the HTML box
 *  was left holding. `initialHtml` is read once on purpose — re-seeding it on
 *  every parent render would reset the cursor on each keystroke. */
function RichFooter({
  initialHtml,
  onChange,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // The footer allowlist has no <code>/<pre> and starts headings at h3.
        code: false,
        codeBlock: false,
        heading: { levels: [3, 4, 5, 6] },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Placeholder.configure({ placeholder: "Written at the foot of every issue…" }),
    ],
    content: initialHtml,
    // An empty document serializes to "<p></p>", which would store a footer that
    // renders as a stray blank line. Empty means empty.
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  }, []);

  if (!editor) return <div className="nlx-editor-loading">Loading editor…</div>;

  return (
    <div className="nlx-editor nlx-editor-sm">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

export function FooterEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  // Decided once, from what was loaded. Recomputing per render would yank an
  // admin into HTML mode the moment they typed a "<".
  const [mode, setMode] = useState<"rich" | "html">(() =>
    needsHtmlMode(value) ? "html" : "rich",
  );
  const advanced = useMemo(() => needsHtmlMode(value), [value]);

  return (
    <div className="nlx-footer-editor">
      <div className="nlx-modeswitch" role="group" aria-label="Footer editing mode">
        <button type="button" className={`nlx-modebtn${mode === "rich" ? " on" : ""}`}
          onClick={() => setMode("rich")}>Rich text</button>
        <button type="button" className={`nlx-modebtn${mode === "html" ? " on" : ""}`}
          onClick={() => setMode("html")}>HTML</button>
      </div>

      {mode === "rich" ? (
        <RichFooter initialHtml={value} onChange={onChange} />
      ) : (
        <textarea
          className="sd-input"
          rows={8}
          spellCheck={false}
          value={value}
          style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 13, lineHeight: 1.5 }}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {mode === "rich" && advanced && (
        <p className="nlx-modewarn">
          This footer contains markup the rich editor can't show — a table, a
          <code>div</code>/<code>span</code>, or inline styles. Editing here will
          flatten it. Switch to HTML to keep it.
        </p>
      )}
    </div>
  );
}
