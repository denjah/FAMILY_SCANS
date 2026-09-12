"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type ViewMode = "grid" | "table";

export interface ArchiveState {
  activeId: string | null;
  viewMode: ViewMode;
  search: string;
  branch: string;
  onlyWithComments: boolean;
  slideshow: boolean;
  slideshowInterval: number;
  zoom: number;
  detailsOpen: boolean;
  drafts: Record<string, string>;
}

export interface ArchiveActions {
  setActiveId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearch: (value: string) => void;
  setBranch: (value: string) => void;
  setOnlyWithComments: (value: boolean) => void;
  setSlideshow: (value: boolean) => void;
  setSlideshowInterval: (seconds: number) => void;
  setZoom: (value: number) => void;
  setDetailsOpen: (value: boolean) => void;
  setDraft: (assetId: string, value: string) => void;
}

export type ArchiveStore = ArchiveState & ArchiveActions;

export const useArchiveStore = create<ArchiveStore>()(
  subscribeWithSelector((set) => ({
    activeId: null,
    viewMode: "grid",
    search: "",
    branch: "all",
    onlyWithComments: false,
    slideshow: false,
    slideshowInterval: 7,
    zoom: 1,
    detailsOpen: true,
    drafts: {},
    setActiveId: (activeId) => set({ activeId, zoom: 1 }),
    setViewMode: (viewMode) => set({ viewMode }),
    setSearch: (search) => set({ search }),
    setBranch: (branch) => set({ branch }),
    setOnlyWithComments: (onlyWithComments) => set({ onlyWithComments }),
    setSlideshow: (slideshow) => set({ slideshow }),
    setSlideshowInterval: (slideshowInterval) => set({ slideshowInterval }),
    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.5, zoom)) }),
    setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
    setDraft: (assetId, value) => set((state) => ({ drafts: { ...state.drafts, [assetId]: value } })),
  })),
);
