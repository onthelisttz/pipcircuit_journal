"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, Quote, Palette, Type, ImagePlus } from "lucide-react";

interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  disabled?: boolean;
}

const ToolbarButton = ({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`rounded p-1.5 ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
  >
    {children}
  </button>
);

export function RichTextEditor({
  value = "",
  onChange,
  placeholder = "Write here…",
  minHeight = "120px",
  disabled = false,
}: RichTextEditorProps) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [fontSizePickerOpen, setFontSizePickerOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontSize,
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "<p></p>",
    editorProps: {
      handlePaste: (_view, event) => {
        const items = Array.from(event.clipboardData?.items ?? []);
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                if (dataUrl) editorRef.current?.chain().focus().setImage({ src: dataUrl }).run();
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (files?.length) {
          for (const file of Array.from(files)) {
            if (file.type.startsWith("image/")) {
              event.preventDefault();
              const reader = new FileReader();
              reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                if (dataUrl) editorRef.current?.chain().focus().setImage({ src: dataUrl }).run();
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || "<p></p>";
    if (current !== incoming) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor || !onChange) return;
    const onUpdate = () => onChange(editor.getHTML());
    editor.on("update", onUpdate);
    return () => editor.off("update", onUpdate);
  }, [editor, onChange]);

  const addImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file && editor) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          if (dataUrl) editor.chain().focus().setImage({ src: dataUrl }).run();
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="space-y-2">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet list"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title="Quote"
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <div className="relative">
            <button
              type="button"
              onClick={() => setFontSizePickerOpen((o) => !o)}
              title="Font size"
              className={`rounded p-1.5 ${editor.isActive("textStyle", { fontSize: true }) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Type className="h-4 w-4" />
            </button>
            {fontSizePickerOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden onClick={() => setFontSizePickerOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 flex flex-col gap-0.5 rounded-lg border border-border bg-background p-2 shadow-lg">
                  {["12px", "14px", "16px", "18px", "20px", "24px", "28px"].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().setFontSize(size).run();
                        setFontSizePickerOpen(false);
                      }}
                      className="rounded px-2 py-1 text-left text-sm hover:bg-muted"
                      style={{ fontSize: size }}
                    >
                      {size}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().unsetFontSize().run();
                      setFontSizePickerOpen(false);
                    }}
                    className="mt-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Reset
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setColorPickerOpen((o) => !o)}
              title="Text color"
              className={`rounded p-1.5 ${editor.isActive("textStyle", { color: true }) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Palette className="h-4 w-4" />
            </button>
            {colorPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden onClick={() => setColorPickerOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 flex flex-wrap gap-1 rounded-lg border border-border bg-background p-2 shadow-lg">
                  {["#000000", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#7c3aed", "#6b7280", "#ffffff"].map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().setColor(hex).run();
                        setColorPickerOpen(false);
                      }}
                      className="h-6 w-6 rounded border border-border"
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().unsetColor().run();
                      setColorPickerOpen(false);
                    }}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Reset
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={addImage}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Add image"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        </div>
      )}
      <div
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm
          [&_.ProseMirror]:outline-none
          [&_.ProseMirror_p]:my-1 [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h3]:text-sm
          [&_.ProseMirror_img]:cursor-zoom-in [&_.ProseMirror_img]:rounded-lg [&_.ProseMirror_img]:max-w-full
          [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:italic"
        style={{ minHeight }}
        onClick={(e) => {
          const img = (e.target as HTMLElement).closest("img");
          if (img?.src) setZoomedImage(img.src);
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {zoomedImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomedImage(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Escape" && setZoomedImage(null)}
          aria-label="Close zoomed image"
        >
          <img
            src={zoomedImage}
            alt="Zoomed"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
