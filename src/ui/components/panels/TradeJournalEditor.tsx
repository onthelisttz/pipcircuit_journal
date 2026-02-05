"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useTradeNote } from "@ui/hooks";
import { Loader2, Check, ImagePlus, Bold, Italic, List, ListOrdered, Quote, Palette, Type } from "lucide-react";

interface TradeJournalEditorProps {
  tradeId: number;
  initialComment?: string | null;
}

export function TradeJournalEditor({ tradeId, initialComment }: TradeJournalEditorProps) {
  const { note, isLoading, error, saveNote } = useTradeNote(tradeId, initialComment);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [fontSizePickerOpen, setFontSizePickerOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const isInitializedRef = useRef(false);
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const initialContentRef = useRef<string>("");
  const lastHtmlRef = useRef<string>("");
  const hasDirtyRef = useRef(false);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit,
        TextStyle,
        Color,
        FontSize,
        Image.configure({ allowBase64: true }),
        Placeholder.configure({
          placeholder: "Write your trade notes… Add images by pasting or using the button.",
        }),
      ],
      content: "",
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
                  if (dataUrl) {
                    editorRef.current?.chain().focus().setImage({ src: dataUrl }).run();
                  }
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
                  if (dataUrl) {
                    editorRef.current?.chain().focus().setImage({ src: dataUrl }).run();
                  }
                };
                reader.readAsDataURL(file);
                return true;
              }
            }
          }
          return false;
        },
      },
    },
    [tradeId]
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Load existing content when note (or trade) changes
  useEffect(() => {
    if (!editor) return;
    if (note) {
      const c = note.content || "<p></p>";
      editor.commands.setContent(c, false);
      initialContentRef.current = c;
      lastHtmlRef.current = c;
      hasDirtyRef.current = false;
      isInitializedRef.current = true;
    } else {
      editor.commands.setContent("<p></p>", false);
      initialContentRef.current = "<p></p>";
      lastHtmlRef.current = "<p></p>";
      hasDirtyRef.current = false;
      isInitializedRef.current = true;
    }
  }, [editor, note, tradeId]);

  // Track changes, but do not save on every keystroke
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const html = editor.getHTML();
      lastHtmlRef.current = html;
      hasDirtyRef.current = html !== initialContentRef.current;
      setSaveStatus("idle");
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  // Save when unmounting or when tradeId changes away
  useEffect(() => {
    return () => {
      if (!hasDirtyRef.current) return;
      const html = lastHtmlRef.current;
      if (!html || html === initialContentRef.current) return;
      setSaveStatus("saving");
      void saveNote(html).then(() => {
        // component may be unmounted; status is best-effort
      });
    };
  }, [saveNote]);

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

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error.message}
      </p>
    );
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Notes</span>
        <div className="flex items-center gap-1">
          {editor && (
            <>
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
                    <div
                      className="fixed inset-0 z-40"
                      aria-hidden
                      onClick={() => setFontSizePickerOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-0.5 rounded-lg border border-border bg-background p-2 shadow-lg">
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
                    <div
                      className="fixed inset-0 z-40"
                      aria-hidden
                      onClick={() => setColorPickerOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-50 mt-1 flex flex-wrap gap-1 rounded-lg border border-border bg-background p-2 shadow-lg">
                      {[
                        "#000000",
                        "#dc2626",
                        "#ea580c",
                        "#ca8a04",
                        "#16a34a",
                        "#2563eb",
                        "#7c3aed",
                        "#6b7280",
                        "#ffffff",
                      ].map((hex) => (
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
            </>
          )}
          <button
            type="button"
            onClick={addImage}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Add image"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          {saveStatus === "saving" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
      </div>
      <div
        className="min-h-[120px] rounded-lg border border-border bg-background px-3 py-2 text-sm
          [&_.ProseMirror]:min-h-[100px] [&_.ProseMirror]:outline-none
          [&_.ProseMirror_p]:my-1 [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h3]:text-sm
          [&_.ProseMirror_img]:cursor-zoom-in [&_.ProseMirror_img]:rounded-lg [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:italic"
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
