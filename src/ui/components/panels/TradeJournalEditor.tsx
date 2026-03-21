"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useTradeNote } from "@ui/hooks";
import { Loader2, Check, ImagePlus, Bold, Italic, List, ListOrdered, Quote, Palette, Type, Minus, Plus, RotateCcw, X } from "lucide-react";

interface TradeJournalEditorProps {
  tradeId: number;
  initialComment?: string | null;
}

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  title: string;
}

function ToolbarButton({ onClick, active, children, title }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded p-1.5 ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function TradeJournalEditor({ tradeId, initialComment }: TradeJournalEditorProps) {
  const { note, isLoading, error, saveNote } = useTradeNote(tradeId, initialComment);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [fontSizePickerOpen, setFontSizePickerOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [isImageGestureActive, setIsImageGestureActive] = useState(false);
  const isInitializedRef = useRef(false);
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const initialContentRef = useRef<string>("");
  const lastHtmlRef = useRef<string>("");
  const hasDirtyRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);
  const panStateRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const clampZoom = useCallback((value: number) => Math.min(4, Math.max(1, Number(value.toFixed(2)))), []);
  const getFitSize = useCallback((container: { width: number; height: number }, image: { width: number; height: number }) => {
    if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
      return { width: 0, height: 0 };
    }

    const widthRatio = container.width / image.width;
    const heightRatio = container.height / image.height;
    const scale = Math.min(widthRatio, heightRatio, 1);

    return {
      width: image.width * scale,
      height: image.height * scale,
    };
  }, []);
  const clampOffset = useCallback((offset: { x: number; y: number }, zoom: number) => {
    const fitSize = getFitSize(stageSize, imageNaturalSize);
    const overflowX = Math.max(0, fitSize.width * zoom - stageSize.width);
    const overflowY = Math.max(0, fitSize.height * zoom - stageSize.height);
    const maxX = overflowX / 2;
    const maxY = overflowY / 2;

    return {
      x: Math.min(maxX, Math.max(-maxX, offset.x)),
      y: Math.min(maxY, Math.max(-maxY, offset.y)),
    };
  }, [getFitSize, imageNaturalSize, stageSize]);
  const closeZoomedImage = useCallback(() => {
    setZoomedImage(null);
    setImageZoom(1);
    setImageOffset({ x: 0, y: 0 });
    setImageNaturalSize({ width: 0, height: 0 });
    setIsImageGestureActive(false);
    activePointersRef.current.clear();
    pinchStateRef.current = null;
    panStateRef.current = null;
  }, []);
  const updateImageZoom = useCallback((nextZoom: number | ((current: number) => number)) => {
    setImageZoom((current) => {
      const resolved = typeof nextZoom === "function" ? nextZoom(current) : nextZoom;
      const next = clampZoom(resolved);
      if (next <= 1) {
        setImageOffset({ x: 0, y: 0 });
      } else {
        setImageOffset((currentOffset) => clampOffset(currentOffset, next));
      }
      return next;
    });
  }, [clampOffset, clampZoom]);
  const fitSize = useMemo(
    () => getFitSize(stageSize, imageNaturalSize),
    [getFitSize, imageNaturalSize, stageSize]
  );
  const syncStageSize = useCallback(() => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setStageSize({
      width: bounds.width,
      height: bounds.height,
    });
  }, []);
  const syncTouchGesture = useCallback((touches: {
    length: number;
    item: (index: number) => { clientX: number; clientY: number } | null;
  }) => {
    const points = Array.from({ length: touches.length }, (_, index) => touches.item(index))
      .filter((touch): touch is { clientX: number; clientY: number } => touch !== null)
      .map((touch) => ({
        x: touch.clientX,
        y: touch.clientY,
      }));

    if (points.length >= 2) {
      pinchStateRef.current = {
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        zoom: imageZoom,
      };
      panStateRef.current = null;
      setIsImageGestureActive(true);
      return;
    }

    if (points.length === 1) {
      panStateRef.current = {
        x: points[0].x,
        y: points[0].y,
      };
      pinchStateRef.current = null;
      setIsImageGestureActive(true);
      return;
    }

    pinchStateRef.current = null;
    panStateRef.current = null;
    setIsImageGestureActive(false);
  }, [imageZoom]);

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
      editor.commands.setContent(c, { emitUpdate: false });
      initialContentRef.current = c;
      lastHtmlRef.current = c;
      hasDirtyRef.current = false;
      isInitializedRef.current = true;
    } else {
      editor.commands.setContent("<p></p>", { emitUpdate: false });
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

  useEffect(() => {
    if (!zoomedImage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [zoomedImage]);

  useEffect(() => {
    if (!zoomedImage) return;
    const rafId = requestAnimationFrame(() => syncStageSize());

    const resizeObserver =
      typeof ResizeObserver !== "undefined" && stageRef.current
        ? new ResizeObserver(() => syncStageSize())
        : null;

    if (resizeObserver && stageRef.current) {
      resizeObserver.observe(stageRef.current);
    }

    const handleResize = () => syncStageSize();
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [syncStageSize, zoomedImage]);

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
          if (img?.src) {
            setZoomedImage(img.src);
            setImageZoom(1);
            setImageOffset({ x: 0, y: 0 });
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {zoomedImage && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[300] flex flex-col bg-black/92 backdrop-blur-sm"
          onClick={closeZoomedImage}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image viewer"
          onWheel={(e) => {
            e.preventDefault();
            updateImageZoom((current) => current + (e.deltaY < 0 ? 0.2 : -0.2));
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end p-4 sm:p-6">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeZoomedImage();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-lg transition hover:bg-black/60"
              title="Close image"
              aria-label="Close image"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            ref={stageRef}
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-20 sm:px-8 sm:py-24"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                closeZoomedImage();
              } else if (e.key === "+" || e.key === "=") {
                updateImageZoom((current) => current + 0.25);
              } else if (e.key === "-") {
                updateImageZoom((current) => current - 0.25);
              } else if (e.key === "0") {
                setImageZoom(1);
              }
            }}
            tabIndex={0}
          >
            <div
              className="relative flex h-full w-full items-center justify-center overflow-hidden touch-none"
              onPointerDown={(e) => {
                e.stopPropagation();
                stageRef.current?.setPointerCapture?.(e.pointerId);
                activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                setIsImageGestureActive(true);

                if (activePointersRef.current.size === 1) {
                  panStateRef.current = { x: e.clientX, y: e.clientY };
                } else if (activePointersRef.current.size === 2) {
                  const points = Array.from(activePointersRef.current.values());
                  pinchStateRef.current = {
                    distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
                    zoom: imageZoom,
                  };
                  panStateRef.current = null;
                }
              }}
              onPointerMove={(e) => {
                e.stopPropagation();
                if (!activePointersRef.current.has(e.pointerId)) return;

                activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                const points = Array.from(activePointersRef.current.values());

                if (points.length >= 2 && pinchStateRef.current) {
                  const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                  if (pinchStateRef.current.distance > 0) {
                    const nextZoom = clampZoom((distance / pinchStateRef.current.distance) * pinchStateRef.current.zoom);
                    setImageZoom(nextZoom);
                    if (nextZoom <= 1) {
                      setImageOffset({ x: 0, y: 0 });
                    } else {
                      setImageOffset((currentOffset) => clampOffset(currentOffset, nextZoom));
                    }
                  }
                  return;
                }

                if (points.length === 1 && imageZoom > 1 && panStateRef.current) {
                  const deltaX = e.clientX - panStateRef.current.x;
                  const deltaY = e.clientY - panStateRef.current.y;
                  panStateRef.current = { x: e.clientX, y: e.clientY };
                  setImageOffset((currentOffset) =>
                    clampOffset(
                      {
                        x: currentOffset.x + deltaX,
                        y: currentOffset.y + deltaY,
                      },
                      imageZoom
                    )
                  );
                }
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                activePointersRef.current.delete(e.pointerId);
                if (activePointersRef.current.size < 2) {
                  pinchStateRef.current = null;
                }
                if (activePointersRef.current.size === 1) {
                  const remainingPoint = Array.from(activePointersRef.current.values())[0];
                  panStateRef.current = remainingPoint ? { x: remainingPoint.x, y: remainingPoint.y } : null;
                } else {
                  panStateRef.current = null;
                }
                if (activePointersRef.current.size === 0) {
                  setIsImageGestureActive(false);
                }
              }}
              onPointerCancel={(e) => {
                e.stopPropagation();
                activePointersRef.current.delete(e.pointerId);
                if (activePointersRef.current.size === 0) {
                  pinchStateRef.current = null;
                  panStateRef.current = null;
                  setIsImageGestureActive(false);
                }
              }}
              onWheel={(e) => {
                e.stopPropagation();
                e.preventDefault();
                updateImageZoom((current) => current + (e.deltaY < 0 ? 0.2 : -0.2));
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                syncTouchGesture(e.touches);
              }}
              onTouchMove={(e) => {
                e.stopPropagation();
                e.preventDefault();

                const points = Array.from(e.touches).map((touch) => ({
                  x: touch.clientX,
                  y: touch.clientY,
                }));

                if (points.length >= 2 && pinchStateRef.current) {
                  const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                  if (pinchStateRef.current.distance > 0) {
                    const nextZoom = clampZoom((distance / pinchStateRef.current.distance) * pinchStateRef.current.zoom);
                    setImageZoom(nextZoom);
                    if (nextZoom <= 1) {
                      setImageOffset({ x: 0, y: 0 });
                    } else {
                      setImageOffset((currentOffset) => clampOffset(currentOffset, nextZoom));
                    }
                  }
                  return;
                }

                if (points.length === 1 && imageZoom > 1 && panStateRef.current) {
                  const deltaX = points[0].x - panStateRef.current.x;
                  const deltaY = points[0].y - panStateRef.current.y;
                  panStateRef.current = { x: points[0].x, y: points[0].y };
                  setImageOffset((currentOffset) =>
                    clampOffset(
                      {
                        x: currentOffset.x + deltaX,
                        y: currentOffset.y + deltaY,
                      },
                      imageZoom
                    )
                  );
                }
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                syncTouchGesture(e.touches);
              }}
              onTouchCancel={(e) => {
                e.stopPropagation();
                syncTouchGesture(e.touches);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={zoomedImage}
                alt="Zoomed"
                className="select-none rounded-xl object-contain shadow-2xl"
                draggable={false}
                style={{
                  width: fitSize.width || undefined,
                  height: fitSize.height || undefined,
                  maxWidth: "100%",
                  maxHeight: "100%",
                  transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom})`,
                  transformOrigin: "center center",
                  transition: isImageGestureActive ? "none" : "transform 150ms ease",
                }}
                onLoad={(e) => {
                  setImageNaturalSize({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  });
                  syncStageSize();
                }}
                onDoubleClick={() => updateImageZoom((current) => (current > 1 ? 1 : 2))}
              />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4 sm:p-6">
            <div
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/55 px-2 py-2 text-white shadow-lg backdrop-blur"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => updateImageZoom((current) => current - 0.25)}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/12"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setImageZoom(1)}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex h-9 min-w-20 items-center justify-center rounded-full px-3 text-sm font-medium text-white transition hover:bg-white/12"
                title="Reset zoom"
                aria-label="Reset zoom"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {Math.round(imageZoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => updateImageZoom((current) => current + 0.25)}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/12"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
