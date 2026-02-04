"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useTradeNote } from "@ui/hooks";
import { DexieNoteRepository } from "@infrastructure/db/dexie";
import { Loader2, Check, ImagePlus, Bold, Italic, List, ListOrdered, Quote } from "lucide-react";

const noteRepo = new DexieNoteRepository();

interface TradeJournalEditorProps {
  tradeId: number;
  initialComment?: string | null;
}

const IDLE_SAVE_MS = 30_000;

export function TradeJournalEditor({ tradeId, initialComment }: TradeJournalEditorProps) {
  const { note, isLoading, error, saveNote } = useTradeNote(tradeId, initialComment);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitializedRef = useRef(false);
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
      StarterKit,
      Image.configure({ allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write your trade notes… Add images by pasting or using the button." }),
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

  const contentRef = useRef<string>("");
  const noteIdRef = useRef<number | null>(null);
  const tradeIdRef = useRef<number>(tradeId);
  tradeIdRef.current = tradeId;
  noteIdRef.current = note?.id ?? null;

  const saveNow = useCallback(
    async (html: string) => {
      if (!html || html === "<p></p>") return;
      setSaveStatus("saving");
      try {
        await saveNote(html);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    },
    [saveNote]
  );

  useEffect(() => {
    if (!editor) return;
    if (note) {
      if (!isInitializedRef.current) {
        isInitializedRef.current = true;
        const c = note.content || "<p></p>";
        editor.commands.setContent(c, false);
        contentRef.current = c;
      }
    } else {
      isInitializedRef.current = true;
      editor.commands.setContent("<p></p>", false);
      contentRef.current = "<p></p>";
    }
  }, [editor, note, tradeId]);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const html = editor.getHTML();
      contentRef.current = html;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        void saveNow(html);
      }, IDLE_SAVE_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      const lastContent = contentRef.current;
      const tid = tradeIdRef.current;
      const nid = noteIdRef.current;
      if (lastContent && lastContent !== "<p></p>" && tid) {
        const now = new Date();
        if (nid) {
          noteRepo.update(nid, { content: lastContent, updatedAt: now }).catch(() => {});
        } else {
          noteRepo.create({
            tradeId: tid,
            content: lastContent,
            createdAt: now,
            updatedAt: now,
          }).catch(() => {});
        }
      }
    };
  }, [editor, saveNow]);

  useEffect(() => {
    isInitializedRef.current = false;
  }, [tradeId]);

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
          [&_.ProseMirror_img]:rounded-lg [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:italic"
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
