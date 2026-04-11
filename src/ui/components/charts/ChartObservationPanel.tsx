"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { format } from "date-fns";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  Observation,
  ObservationChartArea,
  ObservationChartContext,
  ObservationSource,
} from "@domain/entities";
import { ConfirmDialog } from "@ui/components/common";
import { ObservationFormModal } from "@ui/features/observations";
import { useObservationCategories } from "@ui/hooks/useObservationCategories";
import { useObservationRepository } from "@ui/hooks/useObservationRepository";
import { useObservations } from "@ui/hooks/useObservations";
import type { ChartObservationPanelData } from "./chartObservationTypes";

const DEFAULT_SOURCE_FILTER: ObservationSource | "all" = "all";
const DEFAULT_WORKSPACE_FILTER: "all" | "synced" | "history" = "all";
const DESKTOP_BREAKPOINT_PX = 768;
const DESKTOP_PANEL_WIDTH_PX = 26 * 16;
const DESKTOP_PANEL_MAX_WIDTH_PX = 32 * 16;
const PANEL_WIDTH_STORAGE_KEY = "chart-observation-panel-desktop-width-v1";

function stripHtml(html: string): string {
  if (!html || typeof document === "undefined") return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent?.trim() ?? "";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function hasChartAreaContent(area: ObservationChartArea | null | undefined): area is ObservationChartArea {
  if (!area) return false;

  return Boolean(
    area.workspaceMode ||
      area.broker ||
      area.symbol ||
      area.timeframe ||
      area.centerTimestamp != null ||
      area.windowSeconds != null ||
      (area.drawings?.length ?? 0) > 0
  );
}

function normalizeChartArea(
  area: ObservationChartArea | ObservationChartContext | null | undefined
): ObservationChartArea | null {
  if (!hasChartAreaContent(area)) return null;

  return {
    workspaceMode: area.workspaceMode ?? null,
    broker: area.broker ?? null,
    symbol: area.symbol ?? null,
    timeframe: area.timeframe ?? null,
    centerTimestamp: area.centerTimestamp ?? null,
    windowSeconds: area.windowSeconds ?? null,
    drawings: Array.isArray(area.drawings) ? area.drawings : undefined,
  };
}

function getLinkedChartAreas(
  context: ObservationChartContext | null | undefined
): ObservationChartArea[] {
  if (!context) return [];

  const rawAreas =
    Array.isArray(context.linkedContexts) && context.linkedContexts.length > 0
      ? context.linkedContexts
      : [context];

  return rawAreas
    .map((area) => normalizeChartArea(area))
    .filter((area): area is ObservationChartArea => area !== null);
}

function getPrimaryChartArea(
  context: ObservationChartContext | null | undefined
): ObservationChartArea | null {
  return getLinkedChartAreas(context)[0] ?? null;
}

function buildChartContextFromAreas(
  areas: ObservationChartArea[],
  primaryIndex = 0
): ObservationChartContext | null {
  const normalizedAreas = areas
    .map((area) => normalizeChartArea(area))
    .filter((area): area is ObservationChartArea => area !== null);

  if (normalizedAreas.length === 0) return null;

  const safePrimaryIndex = Math.min(
    normalizedAreas.length - 1,
    Math.max(0, primaryIndex)
  );
  const primary = normalizedAreas[safePrimaryIndex];
  const orderedAreas = [
    primary,
    ...normalizedAreas.filter((_, index) => index !== safePrimaryIndex),
  ];

  return {
    ...primary,
    linkedContexts: orderedAreas,
  };
}

function getChartAreaWorkspaceLabel(area: ObservationChartArea | null | undefined): string {
  if (!area) return "Chart area";
  return area.workspaceMode === "history" ? "MT5 History" : "Synced Chart";
}

function formatChartAreaMeta(area: ObservationChartArea | null | undefined): string {
  if (!area) return "Chart area";

  const header = [area.broker, area.symbol, area.timeframe].filter(Boolean).join(" - ");
  const location =
    area.centerTimestamp != null
      ? format(new Date(area.centerTimestamp), "MMM d, yyyy HH:mm")
      : null;

  return [header || getChartAreaWorkspaceLabel(area), location].filter(Boolean).join(" @ ");
}

function formatObservationMeta(observation: Observation): string {
  const primaryArea = getPrimaryChartArea(observation.chartContext);
  const linkedAreas = getLinkedChartAreas(observation.chartContext);
  if (!primaryArea) return "Observation";

  const meta = [primaryArea.broker, primaryArea.symbol, primaryArea.timeframe]
    .filter(Boolean)
    .join(" - ");
  const suffix = linkedAreas.length > 1 ? ` +${linkedAreas.length - 1} more` : "";

  return `${meta || getChartAreaWorkspaceLabel(primaryArea)}${suffix}`;
}

function getObservationSource(observation: Observation): ObservationSource {
  return observation.chartContext ? "chart" : observation.source ?? "manual";
}

function getObservationWorkspaceLabel(observation: Observation): string {
  if (getObservationSource(observation) === "manual") {
    return "Manual";
  }

  const areas = getLinkedChartAreas(observation.chartContext);
  const workspaceModes = Array.from(
    new Set(areas.map((area) => area.workspaceMode ?? "synced"))
  );

  if (workspaceModes.length > 1) {
    return "Mixed workspaces";
  }

  return workspaceModes[0] === "history" ? "MT5 History" : "Synced Chart";
}

function CategoryManagerModal({
  open,
  onClose,
  categories,
  editingNames,
  setEditingNames,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  categories: { id?: number; name: string; color: string }[];
  editingNames: Record<number, string>;
  setEditingNames: Dispatch<SetStateAction<Record<number, string>>>;
  onSave: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Manage categories</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Close
          </button>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-3">
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              You don&apos;t have any categories yet. Add one from the observation modal.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">
                Rename or delete categories. Existing observations keep their category until you
                change them.
              </p>
              <div className="space-y-1">
                {categories.map((category) =>
                  category.id == null ? null : (
                    <div
                      key={category.id}
                      className="flex items-center gap-2 rounded-md bg-background px-2 py-1"
                    >
                      <div
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: category.color }}
                      />
                      <input
                        type="text"
                        value={editingNames[category.id] ?? category.name}
                        onChange={(event) =>
                          setEditingNames((previous) => ({
                            ...previous,
                            [category.id!]: event.target.value,
                          }))
                        }
                        className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => onSave(category.id!)}
                        className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(category.id!)}
                        className="rounded border border-destructive px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChartObservationPanel({
  workspace,
  onLoadObservation,
  onClose,
}: ChartObservationPanelData) {
  const repo = useObservationRepository();
  const { observations, isLoading, refetch } = useObservations();
  const { categories, refetch: refetchCategories } = useObservationCategories();

  const [sourceFilter, setSourceFilter] =
    useState<ObservationSource | "all">(DEFAULT_SOURCE_FILTER);
  const [workspaceFilter, setWorkspaceFilter] =
    useState<"all" | "synced" | "history">(DEFAULT_WORKSPACE_FILTER);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilterId, setCategoryFilterId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingObservationId, setEditingObservationId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftChartContext, setDraftChartContext] = useState<ObservationChartContext | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [editingCategoryNames, setEditingCategoryNames] = useState<Record<number, string>>({});
  const [categoryDeleteId, setCategoryDeleteId] = useState<number | null>(null);
  const [observationDeleteId, setObservationDeleteId] = useState<number | null>(null);
  const [activeObservationId, setActiveObservationId] = useState<number | null>(null);
  const [pendingScrollObservationId, setPendingScrollObservationId] = useState<number | null>(null);
  const [positionInput, setPositionInput] = useState("1");
  const [cardChartAreaIndexes, setCardChartAreaIndexes] = useState<Record<number, number>>({});
  const [cardChartAreaInputs, setCardChartAreaInputs] = useState<Record<number, string>>({});
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= DESKTOP_BREAKPOINT_PX;
  });
  const [desktopPanelWidth, setDesktopPanelWidth] = useState(() => {
    if (typeof window === "undefined") return DESKTOP_PANEL_WIDTH_PX;
    const rawStoredWidth = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    const storedWidth = rawStoredWidth ? Number(rawStoredWidth) : DESKTOP_PANEL_WIDTH_PX;
    const nextWidth = Number.isFinite(storedWidth) ? storedWidth : DESKTOP_PANEL_WIDTH_PX;
    return Math.min(Math.max(nextWidth, DESKTOP_PANEL_WIDTH_PX), DESKTOP_PANEL_MAX_WIDTH_PX);
  });
  const [isResizing, setIsResizing] = useState(false);
  const desktopPanelWidthRef = useRef(desktopPanelWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const observationItemRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    desktopPanelWidthRef.current = desktopPanelWidth;
  }, [desktopPanelWidth]);

  const clampDesktopWidth = useCallback((width: number) => {
    if (typeof window === "undefined") return width;
    const maxPanelWidth = Math.min(
      DESKTOP_PANEL_MAX_WIDTH_PX,
      Math.floor(window.innerWidth * 0.5)
    );
    return Math.min(Math.max(width, DESKTOP_PANEL_WIDTH_PX), maxPanelWidth);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT_PX);
      setDesktopPanelWidth((current) => clampDesktopWidth(current));
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampDesktopWidth]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!isResizing || typeof document === "undefined") return;
    const bodyStyle = document.body.style;
    const previousCursor = bodyStyle.cursor;
    const previousUserSelect = bodyStyle.userSelect;
    bodyStyle.cursor = "col-resize";
    bodyStyle.userSelect = "none";
    return () => {
      bodyStyle.cursor = previousCursor;
      bodyStyle.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  useEffect(() => {
    setEditingCategoryNames((previous) => {
      const next: Record<number, string> = {};
      for (const category of categories) {
        if (category.id == null) continue;
        next[category.id] = previous[category.id] ?? category.name;
      }
      return next;
    });
  }, [categories]);

  const filteredObservations = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return observations.filter((observation) => {
      const linkedAreas = getLinkedChartAreas(observation.chartContext);
      const source = getObservationSource(observation);

      if (sourceFilter !== "all" && source !== sourceFilter) {
        return false;
      }

      if (
        sourceFilter === "chart" &&
        workspaceFilter !== "all" &&
        !linkedAreas.some((area) => (area.workspaceMode ?? "synced") === workspaceFilter)
      ) {
        return false;
      }

      if (categoryFilterId != null && observation.categoryId !== categoryFilterId) {
        return false;
      }

      if (normalizedSearch) {
        const categoryName =
          observation.categoryId != null
            ? categories.find((item) => item.id === observation.categoryId)?.name ?? ""
            : "";
        const chartAreaMeta = linkedAreas.map((area) => formatChartAreaMeta(area)).join(" ");
        const haystack = [
          observation.title,
          stripHtml(observation.content || ""),
          formatObservationMeta(observation),
          getObservationWorkspaceLabel(observation),
          categoryName,
          chartAreaMeta,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }
      return true;
    });
  }, [categories, categoryFilterId, observations, searchQuery, sourceFilter, workspaceFilter]);

  const activeObservationIndex = useMemo(
    () => filteredObservations.findIndex((observation) => observation.id === activeObservationId),
    [activeObservationId, filteredObservations]
  );

  const editingObservation = useMemo(
    () =>
      editingObservationId == null
        ? null
        : observations.find((observation) => observation.id === editingObservationId) ?? null,
    [editingObservationId, observations]
  );

  useEffect(() => {
    if (filteredObservations.length === 0) {
      setActiveObservationId(null);
      return;
    }

    if (
      activeObservationId == null ||
      !filteredObservations.some((observation) => observation.id === activeObservationId)
    ) {
      setActiveObservationId(filteredObservations[0].id ?? null);
    }
  }, [activeObservationId, filteredObservations]);

  useEffect(() => {
    if (activeObservationIndex >= 0) {
      setPositionInput(String(activeObservationIndex + 1));
    } else if (filteredObservations.length === 0) {
      setPositionInput("1");
    }
  }, [activeObservationIndex, filteredObservations.length]);

  useEffect(() => {
    if (pendingScrollObservationId == null) return;
    if (!filteredObservations.some((observation) => observation.id === pendingScrollObservationId)) {
      return;
    }

    const timer = window.setTimeout(() => {
      const target = observationItemRefs.current[pendingScrollObservationId];
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setPendingScrollObservationId(null);
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [filteredObservations, pendingScrollObservationId]);

  const activateObservation = useCallback(
    (observation: Observation | null, contextOverride?: ObservationChartArea | null) => {
      if (!observation) return;
      setActiveObservationId(observation.id ?? null);
      setPendingScrollObservationId(observation.id ?? null);
      const context = contextOverride ?? getPrimaryChartArea(observation.chartContext);
      if (context) {
        onLoadObservation(observation, context);
      }
    },
    [onLoadObservation]
  );

  const resetDraft = useCallback(() => {
    setDraftTitle("");
    setDraftCategoryId(categories[0]?.id ?? null);
    setDraftContent("");
    setDraftChartContext(null);
    setEditingObservationId(null);
    setShowModal(false);
    setShowAddCategory(false);
    setNewCategoryName("");
  }, [categories]);

  const handleOpenCreate = useCallback(() => {
    const capturedContext = workspace?.captureObservationContext() ?? null;
    if (!capturedContext) return;

    setEditingObservationId(null);
    setDraftTitle("");
    setDraftCategoryId(categories[0]?.id ?? null);
    setDraftContent("");
    setDraftChartContext(buildChartContextFromAreas([capturedContext]));
    setShowAddCategory(false);
    setNewCategoryName("");
    setShowModal(true);
  }, [categories, workspace]);

  const handleOpenEdit = useCallback((observation: Observation) => {
    setEditingObservationId(observation.id ?? null);
    setDraftTitle(observation.title);
    setDraftCategoryId(observation.categoryId ?? null);
    setDraftContent(observation.content || "<p></p>");
    setDraftChartContext(buildChartContextFromAreas(getLinkedChartAreas(observation.chartContext)));
    setShowAddCategory(false);
    setNewCategoryName("");
    setShowModal(true);
  }, []);

  const persistObservation = useCallback(
    async (chartContextOverride?: ObservationChartContext | null) => {
      if (!draftTitle.trim()) return;

      setSaving(true);
      try {
        const now = new Date();
        const nextChartContext =
          chartContextOverride === undefined ? draftChartContext : chartContextOverride;

        if (editingObservationId != null) {
          await repo.update(editingObservationId, {
            title: draftTitle.trim(),
            categoryId: draftCategoryId,
            content: draftContent || "<p></p>",
            source: "chart",
            chartContext: nextChartContext,
            updatedAt: now,
          });
          setActiveObservationId(editingObservationId);
          setPendingScrollObservationId(editingObservationId);
        } else {
          const created = await repo.create({
            title: draftTitle.trim(),
            categoryId: draftCategoryId ?? undefined,
            content: draftContent || "<p></p>",
            source: "chart",
            chartContext: nextChartContext,
            createdAt: now,
            updatedAt: now,
          });
          setActiveObservationId(created.id ?? null);
          setPendingScrollObservationId(created.id ?? null);
        }
        await refetch();
        resetDraft();
      } catch (error) {
        console.error("Failed to save chart observation:", error);
      } finally {
        setSaving(false);
      }
    },
    [
      draftCategoryId,
      draftChartContext,
      draftContent,
      draftTitle,
      editingObservationId,
      refetch,
      repo,
      resetDraft,
    ]
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      await persistObservation();
    },
    [persistObservation]
  );

  const handleAddCategory = useCallback(async () => {
    if (!newCategoryName.trim()) return;
    try {
      const now = new Date();
      const category = await repo.createCategory({
        name: newCategoryName.trim(),
        color: "#6b7280",
        createdAt: now,
        updatedAt: now,
      });
      await refetchCategories();
      setDraftCategoryId(category.id ?? null);
      setNewCategoryName("");
      setShowAddCategory(false);
    } catch (error) {
      console.error("Failed to add category:", error);
    }
  }, [newCategoryName, refetchCategories, repo]);

  const handleUpdateCategory = useCallback(
    async (id: number) => {
      const nextName = editingCategoryNames[id]?.trim();
      if (!nextName) return;
      try {
        await repo.updateCategory(id, {
          name: nextName,
          updatedAt: new Date(),
        });
        await refetchCategories();
      } catch (error) {
        console.error("Failed to update category:", error);
      }
    },
    [editingCategoryNames, refetchCategories, repo]
  );

  const handleDeleteCategory = useCallback(async () => {
    if (categoryDeleteId == null) return;
    try {
      await repo.deleteCategory(categoryDeleteId);
      if (draftCategoryId === categoryDeleteId) {
        setDraftCategoryId(null);
      }
      if (categoryFilterId === categoryDeleteId) {
        setCategoryFilterId(null);
      }
      await refetchCategories();
      await refetch();
      setCategoryDeleteId(null);
    } catch (error) {
      console.error("Failed to delete category:", error);
    }
  }, [categoryDeleteId, categoryFilterId, draftCategoryId, refetch, refetchCategories, repo]);

  const handleDeleteObservation = useCallback(async () => {
    if (observationDeleteId == null) return;
    try {
      await repo.delete(observationDeleteId);
      await refetch();
      if (activeObservationId === observationDeleteId) {
        setActiveObservationId(null);
      }
      setObservationDeleteId(null);
    } catch (error) {
      console.error("Failed to delete observation:", error);
    }
  }, [activeObservationId, observationDeleteId, refetch, repo]);

  const handleApplyPosition = useCallback(() => {
    if (filteredObservations.length === 0) return;
    const parsed = Number(positionInput);
    if (!Number.isFinite(parsed)) {
      setPositionInput(String((activeObservationIndex >= 0 ? activeObservationIndex : 0) + 1));
      return;
    }

    const nextIndex = Math.min(
      filteredObservations.length - 1,
      Math.max(0, Math.round(parsed) - 1)
    );
    const nextObservation = filteredObservations[nextIndex] ?? null;
    if (!nextObservation) return;
    activateObservation(nextObservation);
  }, [activateObservation, activeObservationIndex, filteredObservations, positionInput]);

  const setCardChartAreaPosition = useCallback((observationId: number, index: number) => {
    setCardChartAreaIndexes((previous) => ({
      ...previous,
      [observationId]: index,
    }));
    setCardChartAreaInputs((previous) => ({
      ...previous,
      [observationId]: String(index + 1),
    }));
  }, []);

  const handleNavigateCardChartArea = useCallback(
    (observation: Observation, linkedAreas: ObservationChartArea[], index: number) => {
      const observationId = observation.id;
      if (observationId == null || linkedAreas.length === 0) return;

      const nextIndex = Math.min(linkedAreas.length - 1, Math.max(0, index));
      const nextArea = linkedAreas[nextIndex] ?? null;

      setCardChartAreaPosition(observationId, nextIndex);
      if (nextArea) {
        activateObservation(observation, nextArea);
      }
    },
    [activateObservation, setCardChartAreaPosition]
  );

  const handleApplyCardChartAreaPosition = useCallback(
    (observation: Observation, linkedAreas: ObservationChartArea[]) => {
      const observationId = observation.id;
      if (observationId == null || linkedAreas.length === 0) return;

      const currentIndex = Math.min(
        linkedAreas.length - 1,
        Math.max(0, cardChartAreaIndexes[observationId] ?? 0)
      );
      const parsed = Number(cardChartAreaInputs[observationId] ?? String(currentIndex + 1));
      if (!Number.isFinite(parsed)) {
        setCardChartAreaPosition(observationId, currentIndex);
        return;
      }

      const nextIndex = Math.min(
        linkedAreas.length - 1,
        Math.max(0, Math.round(parsed) - 1)
      );
      handleNavigateCardChartArea(observation, linkedAreas, nextIndex);
    },
    [
      cardChartAreaIndexes,
      cardChartAreaInputs,
      handleNavigateCardChartArea,
      setCardChartAreaPosition,
    ]
  );

  const draftChartAreas = useMemo(
    () => getLinkedChartAreas(draftChartContext),
    [draftChartContext]
  );

  const handleAddCurrentChartArea = useCallback(() => {
    const capturedContext = normalizeChartArea(workspace?.captureObservationContext() ?? null);
    if (!capturedContext) return;

    setDraftChartContext((current) => {
      const currentAreas = getLinkedChartAreas(current);
      return buildChartContextFromAreas([...currentAreas, capturedContext]);
    });
  }, [workspace]);

  const handleSetPrimaryChartArea = useCallback((index: number) => {
    setDraftChartContext((current) =>
      buildChartContextFromAreas(getLinkedChartAreas(current), index)
    );
  }, []);

  const handleRemoveChartArea = useCallback((index: number) => {
    setDraftChartContext((current) => {
      const currentAreas = getLinkedChartAreas(current);
      if (currentAreas.length <= 1) {
        return current;
      }
      return buildChartContextFromAreas(
        currentAreas.filter((_, areaIndex) => areaIndex !== index)
      );
    });
  }, []);

  const handleViewDraftChartArea = useCallback(
    (area: ObservationChartArea) => {
      if (!editingObservation) return;
      setShowModal(false);
      activateObservation(editingObservation, area);
    },
    [activateObservation, editingObservation]
  );

  const chartLinksSection = useMemo(() => {
    if (!showModal) return null;

    return (
      <div className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-foreground">Linked chart areas</h3>
          </div>
          <button
            type="button"
            onClick={handleAddCurrentChartArea}
            disabled={!workspace}
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add current chart
          </button>
        </div>

        {draftChartAreas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
            No chart areas linked yet. Capture the current chart to link it to this observation.
          </div>
        ) : (
          <div className="space-y-2">
            {draftChartAreas.map((area, index) => (
              <div
                key={`${area.workspaceMode ?? "chart"}-${area.symbol ?? "symbol"}-${area.centerTimestamp ?? index}-${index}`}
                className="rounded-lg border border-border bg-card px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {formatChartAreaMeta(area)}
                      </span>
                      {index === 0 ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getChartAreaWorkspaceLabel(area)}
                      {(area.drawings?.length ?? 0) > 0
                        ? ` · ${(area.drawings?.length ?? 0)} drawing${(area.drawings?.length ?? 0) === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleViewDraftChartArea(area)}
                      disabled={!editingObservation}
                      className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      title="View linked chart area"
                      aria-label="View linked chart area"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    {index > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleSetPrimaryChartArea(index)}
                        className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Make default"
                        aria-label="Make default"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span
                        className="rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary"
                        title="Default chart area"
                        aria-label="Default chart area"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveChartArea(index)}
                      disabled={draftChartAreas.length <= 1}
                      className="rounded-lg border border-destructive/40 p-2 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Remove linked chart area"
                      aria-label="Remove linked chart area"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }, [
    draftChartAreas,
    handleAddCurrentChartArea,
    handleRemoveChartArea,
    handleSetPrimaryChartArea,
    handleViewDraftChartArea,
    editingObservation,
    showModal,
    workspace,
  ]);

  const currentContextLabel = useMemo(() => {
    if (!workspace) return "Chart observations";
    return [workspace.broker, workspace.symbol, workspace.timeframe].filter(Boolean).join(" - ");
  }, [workspace]);

  const canCreateObservation = workspace != null;
  const panelStyle = useMemo<CSSProperties>(
    () => ({
      width: isDesktop ? desktopPanelWidth : undefined,
      minWidth: isDesktop ? desktopPanelWidth : undefined,
      maxWidth: isDesktop ? DESKTOP_PANEL_MAX_WIDTH_PX : undefined,
    }),
    [desktopPanelWidth, isDesktop]
  );

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (typeof window === "undefined" || window.innerWidth < DESKTOP_BREAKPOINT_PX) return;
      event.preventDefault();
      resizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = desktopPanelWidthRef.current;
      setIsResizing(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX;
        setDesktopPanelWidth(clampDesktopWidth(startWidth + delta));
      };

      const finishResize = () => {
        setIsResizing(false);
        window.localStorage.setItem(
          PANEL_WIDTH_STORAGE_KEY,
          String(desktopPanelWidthRef.current)
        );
        removeResizeListeners();
      };

      const removeResizeListeners = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
        resizeCleanupRef.current = null;
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
      resizeCleanupRef.current = removeResizeListeners;
    },
    [clampDesktopWidth]
  );

  const handleResetPanelWidth = useCallback(() => {
    const defaultWidth = clampDesktopWidth(DESKTOP_PANEL_WIDTH_PX);
    setDesktopPanelWidth(defaultWidth);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(defaultWidth));
    }
  }, [clampDesktopWidth]);

  return (
    <>
      <aside
        className="relative flex h-screen w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background md:w-auto"
        style={panelStyle}
        role="complementary"
        aria-labelledby="chart-observation-title"
      >
        <div
          className="absolute inset-y-0 left-0 z-10 hidden w-4 cursor-col-resize touch-none items-center justify-center md:flex"
          role="separator"
          aria-label="Resize chart observation panel"
          aria-orientation="vertical"
          onPointerDown={handleResizeStart}
        >
          <span
            className={`h-full w-px transition-colors ${
              isResizing ? "bg-primary/70" : "bg-border/70 hover:bg-primary/50"
            }`}
          />
        </div>
        <div className="border-b border-border px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="chart-observation-title" className="text-sm font-semibold text-foreground">
                Chart observations
              </h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">{currentContextLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              {isDesktop && desktopPanelWidth !== DESKTOP_PANEL_WIDTH_PX ? (
                <button
                  type="button"
                  onClick={handleResetPanelWidth}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Reset observation panel width"
                  title="Reset panel width"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleOpenCreate}
                disabled={!canCreateObservation}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Add chart observation"
                title="Add chart observation"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close chart observations"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-b border-border px-3 py-3">
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search title, description, symbol..."
                className="h-9 w-full rounded-lg border border-border bg-background px-3 pl-11 text-xs text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </label>
          <div className={`grid gap-2 ${sourceFilter === "chart" ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2"}`}>
            <label className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Source
              </span>
              <select
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as ObservationSource | "all")
                }
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none"
              >
                <option value="all">All sources</option>
                <option value="chart">Chart</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            {sourceFilter === "chart" ? (
              <label className="space-y-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Workspace
                </span>
                <select
                  value={workspaceFilter}
                  onChange={(event) =>
                    setWorkspaceFilter(event.target.value as "all" | "synced" | "history")
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none"
                >
                  <option value="all">All workspaces</option>
                  <option value="synced">Synced Chart</option>
                  <option value="history">MT5 History</option>
                </select>
              </label>
            ) : null}
            <label className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Category
              </span>
              <select
                value={categoryFilterId ?? ""}
                onChange={(event) =>
                  setCategoryFilterId(event.target.value ? Number(event.target.value) : null)
                }
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredObservations.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No observations match this chart and filter set.
            </div>
          ) : (
            <div ref={listContainerRef} className="h-full overflow-y-auto px-2 py-2">
              {filteredObservations.map((observation) => {
                const category =
                  observation.categoryId != null
                    ? categories.find((item) => item.id === observation.categoryId)
                    : null;
                const preview = truncate(stripHtml(observation.content || ""), 110);
                const source = getObservationSource(observation);
                const workspaceLabel = getObservationWorkspaceLabel(observation);
                const linkedAreas = getLinkedChartAreas(observation.chartContext);
                const observationId = observation.id ?? 0;
                const currentAreaIndex = Math.min(
                  Math.max(0, cardChartAreaIndexes[observationId] ?? 0),
                  Math.max(0, linkedAreas.length - 1)
                );
                const currentArea = linkedAreas[currentAreaIndex] ?? null;
                const currentAreaInput =
                  cardChartAreaInputs[observationId] ?? String(currentAreaIndex + 1);
                const isActive = observation.id != null && observation.id === activeObservationId;
                const canLoadObservation = linkedAreas.length > 0;

                return (
                  <div
                    key={observation.id}
                    ref={(element) => {
                      if (observation.id != null) {
                        observationItemRefs.current[observation.id] = element;
                      }
                    }}
                    className={`mb-2 overflow-hidden rounded-xl border bg-background ${
                      isActive
                        ? "border-2 border-primary/90 bg-primary/10 shadow-[0_0_0_1px_rgba(59,130,246,0.22)]"
                        : "border-border"
                    }`}
                  >
                    <div className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => activateObservation(observation, currentArea)}
                        className={`block w-full min-w-0 text-left transition-colors ${
                          canLoadObservation ? "cursor-pointer hover:text-foreground" : "cursor-default"
                        }`}
                      >
                        <div className="truncate text-sm font-semibold text-foreground">
                          {observation.title || "Untitled"}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              source === "chart"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {source === "chart" ? "Chart" : "Manual"}
                          </span>
                          {category ? (
                            <span
                              style={{ color: category.color }}
                              className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium"
                            >
                              {category.name}
                            </span>
                          ) : null}
                          <span className="text-muted-foreground">{workspaceLabel}</span>
                          {linkedAreas.length > 0 ? (
                            <span className="text-muted-foreground">
                              {linkedAreas.length} linked area{linkedAreas.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                            {formatObservationMeta(observation)}
                          </p>
                        </div>

                        {preview ? (
                          <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {preview}
                          </p>
                        ) : null}
                      </button>

                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="min-w-0 text-[11px] text-muted-foreground">
                          {format(new Date(observation.updatedAt), "MMM d, yyyy")}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(observation)}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={`View ${observation.title || "observation"}`}
                            title="View observation"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(observation)}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={`Edit ${observation.title || "observation"}`}
                            title="Edit observation"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setObservationDeleteId(observation.id ?? null)}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${observation.title || "observation"}`}
                            title="Delete observation"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {currentArea ? (
                        <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-3">
                          <button
                            type="button"
                            onClick={() => activateObservation(observation, currentArea)}
                            className="min-w-0 flex-1 text-left transition-colors hover:text-foreground"
                          >
                            <p className="truncate text-[11px] font-medium text-foreground">
                              {formatChartAreaMeta(currentArea)}
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {getChartAreaWorkspaceLabel(currentArea)}
                            </p>
                          </button>

                          {linkedAreas.length > 1 ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleNavigateCardChartArea(
                                    observation,
                                    linkedAreas,
                                    Math.max(0, currentAreaIndex - 1)
                                  )
                                }
                                disabled={currentAreaIndex <= 0}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Previous linked chart area"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <div className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={currentAreaInput}
                                  onChange={(event) => {
                                    const nextValue =
                                      event.target.value.replace(/[^\d]/g, "") || "1";
                                    setCardChartAreaInputs((previous) => ({
                                      ...previous,
                                      [observationId]: nextValue,
                                    }));
                                  }}
                                  onBlur={() =>
                                    handleApplyCardChartAreaPosition(observation, linkedAreas)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    event.preventDefault();
                                    handleApplyCardChartAreaPosition(observation, linkedAreas);
                                  }}
                                  className="w-8 bg-transparent text-center text-[11px] font-medium text-foreground outline-none"
                                  aria-label="Linked chart area position"
                                />
                                <span className="text-[11px] text-muted-foreground">
                                  / {linkedAreas.length}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleNavigateCardChartArea(
                                    observation,
                                    linkedAreas,
                                    Math.min(linkedAreas.length - 1, currentAreaIndex + 1)
                                  )
                                }
                                disabled={currentAreaIndex >= linkedAreas.length - 1}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Next linked chart area"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {filteredObservations.length > 0 ? (
          <div className="border-t border-border px-3 py-3">
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const nextIndex = Math.max(0, activeObservationIndex - 1);
                  activateObservation(filteredObservations[nextIndex] ?? null);
                }}
                disabled={activeObservationIndex <= 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Previous observation"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={positionInput}
                  onChange={(event) =>
                    setPositionInput(event.target.value.replace(/[^\d]/g, "") || "1")
                  }
                  onBlur={handleApplyPosition}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    handleApplyPosition();
                  }}
                  className="w-10 bg-transparent text-center text-sm font-medium text-foreground outline-none"
                  aria-label="Observation position"
                />
                <span className="text-sm text-muted-foreground">/ {filteredObservations.length}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const nextIndex = Math.min(
                    filteredObservations.length - 1,
                    activeObservationIndex + 1
                  );
                  activateObservation(filteredObservations[nextIndex] ?? null);
                }}
                disabled={
                  activeObservationIndex < 0 ||
                  activeObservationIndex >= filteredObservations.length - 1
                }
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Next observation"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <ObservationFormModal
        open={showModal}
        onClose={resetDraft}
        heading={editingObservation ? "Edit Chart Observation" : "New Chart Observation"}
        title={draftTitle}
        setTitle={setDraftTitle}
        categoryId={draftCategoryId}
        setCategoryId={setDraftCategoryId}
        content={draftContent}
        setContent={setDraftContent}
        categories={categories}
        newCategoryName={newCategoryName}
        setNewCategoryName={setNewCategoryName}
        showAddCategory={showAddCategory}
        setShowAddCategory={setShowAddCategory}
        onAddCategory={handleAddCategory}
        onManageCategories={() => setShowManageCategories(true)}
        onSubmit={handleSubmit}
        saving={saving}
        isEdit={editingObservation != null}
        supplementalContent={chartLinksSection}
        panelClassName="max-w-none"
        panelStyle={{ width: "min(750px, calc(100vw - 2rem))" }}
      />

      <CategoryManagerModal
        open={showManageCategories}
        onClose={() => setShowManageCategories(false)}
        categories={categories}
        editingNames={editingCategoryNames}
        setEditingNames={setEditingCategoryNames}
        onSave={handleUpdateCategory}
        onDelete={(id) => setCategoryDeleteId(id)}
      />

      <ConfirmDialog
        open={categoryDeleteId != null}
        title="Delete category?"
        message="Existing observations will keep their stored category value until you change them."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteCategory}
        onClose={() => setCategoryDeleteId(null)}
      />
      <ConfirmDialog
        open={observationDeleteId != null}
        title="Delete observation?"
        message="This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteObservation}
        onClose={() => setObservationDeleteId(null)}
      />
    </>
  );
}
