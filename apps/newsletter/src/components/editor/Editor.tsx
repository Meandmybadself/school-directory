// The authoring surface: TipTap with a deliberately small extension set.
//
// Every node and mark enabled here has a matching case in @sd/shared's
// newsletterRender.ts. That correspondence is the whole safety story — the
// renderer emits only what it recognizes, so an extension added here without a
// renderer case would silently drop content, and a formatting button the
// renderer can't express would lie to the author. Keep the two in step.
//
// Notably absent: code blocks, tables, text colour and alignment. Not because
// they're hard, but because each one is another thing to get right across Gmail,
// Outlook and Apple Mail, and none of them earn that for a school newsletter.

import { useCallback, useRef } from "react";
import { EditorContent, useEditor, type Editor as TipTapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import type { NewsletterNode } from "@sd/shared";
import { Icon, type IconName } from "../Icon.js";
import { EventsBlock } from "./EventsBlock.js";
import { api, errorMessage } from "../../lib/api.js";

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
    // A bare domain is what people type; without a scheme the renderer would
    // drop the mark as unsafe, so normalize here rather than silently losing it.
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
      <ToolButton label="H1" active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
      <ToolButton label="H2" active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <ToolButton label="H3" active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
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
      <ToolButton label="Quote" active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <ToolButton icon="minus" label="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <span className="nlx-tool-sep" />
      <ToolButton icon="upload" label="Image" onClick={() => fileInput.current?.click()} />
      <ToolButton icon="calendar" label="Upcoming events"
        onClick={() => editor.chain().focus().insertEventsBlock().run()} />
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

export function Editor({
  content,
  editable,
  onChange,
}: {
  content: NewsletterNode;
  editable: boolean;
  onChange: (doc: NewsletterNode) => void;
}) {
  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({
          // Disabled because newsletterRender.ts has no case for it; enabling a
          // node without adding its renderer case would drop content silently.
          codeBlock: false,
        }),
        Link.configure({ openOnClick: false, autolink: true }),
        Image,
        Placeholder.configure({ placeholder: "Write the newsletter…" }),
        EventsBlock,
      ],
      content,
      onUpdate: ({ editor: e }) => onChange(e.getJSON() as NewsletterNode),
    },
    // Only rebuild when the mode flips. Re-creating on every content change
    // would reset the cursor on each keystroke.
    [editable],
  );

  if (!editor) return <div className="nlx-editor-loading">Loading editor…</div>;

  return (
    <div className={`nlx-editor${editable ? "" : " ro"}`}>
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
