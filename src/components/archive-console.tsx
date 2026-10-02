"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ArchiveComment, ArchiveCommentPreview, Asset, AssetMetadata, AssetVersion, CommentKind } from "@/types/archive";
import { useArchiveStore } from "@/store/archive-store";
import { ArchiveDeployButton } from "@/components/archive-deploy-button";

interface Props {
  assets: Asset[];
  commentedIds: string[];
  commentPreviews: ArchiveCommentPreview[];
  metadata: AssetMetadata[];
  session: { displayName: string; role: "contributor" | "admin" };
  generatedAt: string;
  canSync: boolean;
}

const COMMENT_KINDS: Array<{ value: CommentKind; label: string }> = [
  { value: "memory", label: "Воспоминание" },
  { value: "identification", label: "Кто на снимке" },
  { value: "date_suggestion", label: "Предположение о дате" },
  { value: "correction", label: "Уточнение" },
  { value: "comment", label: "Комментарий" },
];
const INITIAL_GRID_ITEMS = 72;
const GRID_STEP = 72;
const INITIAL_IMAGE_BATCH = 36;
const DIVIDERS: Record<string, string> = {
  "БАБУШКА": "razdelit01.svg",
  "МАМА": "razdelit02.svg",
  DAN: "razdelit03.svg",
  DEN: "razdelit04.svg",
  PAPA: "razdelit05.svg",
};
const BRANCH_ICONS: Record<string, [string, string]> = {
  all: ["ALL_0.jpg", "ALL_1.jpg"],
  "БАБУШКА": ["BAB_0.jpg", "BAB_01.jpg"],
  "МАМА": ["MAMA_0.jpg", "MAMA_1.jpg"],
  DAN: ["DAN_0.jpg", "DAN_1.jpg"],
  DEN: ["DEN_0.jpg", "DEN_1.jpg"],
  PAPA: ["PAPA_0.jpg", "PAPA_1.jpg"],
};
const COMPACT_VIEW_MODES = [
  { value: "mosaic", label: "Мозаика" },
  { value: "medium", label: "Средние" },
  { value: "compact", label: "Мелкие" },
  { value: "table", label: "Таблица" },
] as const;

function ViewModeIcon({ mode }: { mode: typeof COMPACT_VIEW_MODES[number]["value"] }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {mode === "mosaic" && <><rect x="2" y="2" width="11" height="12" /><rect x="15" y="2" width="7" height="7" /><rect x="15" y="11" width="7" height="11" /><rect x="2" y="16" width="11" height="6" /></>}
    {mode === "medium" && <><rect x="2" y="2" width="9" height="9" /><rect x="13" y="2" width="9" height="9" /><rect x="2" y="13" width="9" height="9" /><rect x="13" y="13" width="9" height="9" /></>}
    {mode === "compact" && [2, 9, 16].flatMap((y) => [2, 9, 16].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" />))}
    {mode === "table" && <><rect x="2" y="2" width="20" height="20" /><path d="M2 8h20M2 15h20M9 2v20" /></>}
  </svg>;
}

function nextRosette(current: number): number {
  return ((current + Math.floor(Math.random() * 17)) % 18) + 1;
}

function BranchIcon({ name }: { name: string }) {
  const icons = BRANCH_ICONS[name];
  if (!icons) return null;
  return <span className="branch-button-art" aria-hidden="true">
    {/* eslint-disable @next/next/no-img-element -- authenticated local icon variants need a direct URL */}
    <img src={`/api/branch-icon/${icons[0]}`} alt="" />
    <img src={`/api/branch-icon/${icons[1]}`} alt="" />
    {/* eslint-enable @next/next/no-img-element */}
  </span>;
}

function subscribeMobile(callback: () => void): () => void {
  const query = window.matchMedia("(max-width: 620px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function isMobile(): boolean {
  return window.matchMedia("(max-width: 620px)").matches;
}

function cardSpan(index: number, mode: string, mobile: boolean): number {
  if (mobile || mode === "compact") return 1;
  if (mode === "medium") return 3;
  if ((index + 1) % 9 === 6) return 2;
  if (index % 7 === 0 || (index + 1) % 11 === 4) return 4;
  return 3;
}

function rowCapacity(mode: string, mobile: boolean): number {
  return mode === "compact" ? (mobile ? 4 : 6) : (mobile ? 2 : 12);
}

function groupPhotoRows(assets: Asset[], mode: string, mobile: boolean, startIndex: number): Asset[][] {
  const capacity = rowCapacity(mode, mobile);
  const rows: Asset[][] = [];
  let row: Asset[] = [];
  let used = 0;
  assets.forEach((asset, index) => {
    const span = cardSpan(startIndex + index, mode, mobile);
    if (used + span > capacity) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(asset);
    used += span;
  });
  if (row.length) rows.push(row);
  return rows;
}

type Rosette = { index: number; id: number; x: number; y: number; size: number };

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function randomRosettes(height: number, width: number, seed: number): Rosette[] {
  const random = seededRandom(seed);
  const ids = Array.from({ length: 18 }, (_, index) => index + 1);
  for (let index = ids.length - 1; index > 0; index--) {
    const selected = Math.floor(random() * (index + 1));
    [ids[index], ids[selected]] = [ids[selected], ids[index]];
  }
  // A centre every 480 px gives two or three rosettes in any 1080 px stretch.
  const firstCentre = 120 + random() * 240;
  const result: Rosette[] = [];
  for (let index = 0; firstCentre + index * 480 < height + 160; index++) {
    const size = Math.round(Math.min(width <= 620 ? 180 : 310, Math.max(130, width * (0.15 + random() * 0.08))));
    result.push({
      index,
      id: ids[index % ids.length],
      x: Math.round(random() * width - size / 2),
      y: Math.round(firstCentre + index * 480 - size / 2),
      size,
    });
  }
  return result;
}

function ArchiveRosettes({ branch, viewMode }: { branch: string; viewMode: string }) {
  const [rosettes, setRosettes] = useState<Rosette[]>([]);
  const layerRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef<number | null>(null);
  useEffect(() => {
    const archive = layerRef.current?.parentElement;
    if (!archive) return;
    seedRef.current = Math.floor(Math.random() * 4294967296);
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setRosettes(randomRosettes(Math.max(window.innerHeight, archive.getBoundingClientRect().height), archive.getBoundingClientRect().width, seedRef.current!));
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(archive);
    window.addEventListener("resize", update);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [branch, viewMode]);
  return <div className="archive-rosettes" ref={layerRef} aria-hidden="true">
    {rosettes.map((rosette) => <span key={rosette.index} className="archive-rosette" style={{
      width: rosette.size,
      height: rosette.size,
      left: rosette.x,
      top: rosette.y,
      maskImage: `url(/api/decor/rosett${String(rosette.id).padStart(2, "0")}.svg)`,
    }} />)}
  </div>;
}

function versionsFor(asset: Asset): AssetVersion[] {
  return asset.versions?.length ? asset.versions : [{ id: asset.id, relativePath: asset.relativePath, fileName: asset.fileName, technicalMetadata: asset.technicalMetadata, webPreview: asset.webPreview, versionHint: asset.versionHint }];
}

function formatBytes(bytes: number): string {
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

function groupCommentPreviews(comments: ArchiveCommentPreview[]): Map<string, ArchiveCommentPreview[]> {
  const grouped = new Map<string, ArchiveCommentPreview[]>();
  for (const comment of comments) {
    const assetComments = grouped.get(comment.assetId);
    if (assetComments) assetComments.push(comment);
    else grouped.set(comment.assetId, [comment]);
  }
  return grouped;
}

function mediaUrl(assetId: string, variant: "thumb" | "screen" | "full", page?: number): string {
  return `/api/media/${encodeURIComponent(assetId)}/${variant}${page === undefined ? "" : `?page=${page}`}`;
}

type AlbumGroup = { key: string; title: string; assets: Asset[] };

function albumsForBranch(assets: Asset[], branch: string): AlbumGroup[] {
  const priority = branch === "МАМА" ? ["MAMA", "mama_piter", "NASTJA"] : [];
  const byFolder = new Map<string, Asset[]>();
  for (const asset of assets) {
    const parts = asset.relativePath.replaceAll("\\", "/").split("/");
    const folder = parts.length <= 2 ? "" : parts[1];
    const group = byFolder.get(folder);
    if (group) group.push(asset); else byFolder.set(folder, [asset]);
  }
  const order = ["", ...priority, ...[...byFolder.keys()].filter((folder) => folder && !priority.includes(folder)).sort((a, b) => a.localeCompare(b, "ru"))];
  return order.flatMap((folder) => {
    const group = byFolder.get(folder);
    if (!group?.length) return [];
    return [{ key: folder || "root", title: folder || branch, assets: group }];
  });
}

export function ArchiveConsole({ assets, commentedIds, commentPreviews, metadata, session, generatedAt, canSync }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = useArchiveStore((state) => state.activeId);
  const viewMode = useArchiveStore((state) => state.viewMode);
  const search = useArchiveStore((state) => state.search);
  const branch = useArchiveStore((state) => state.branch);
  const onlyWithComments = useArchiveStore((state) => state.onlyWithComments);
  const slideshow = useArchiveStore((state) => state.slideshow);
  const slideshowInterval = useArchiveStore((state) => state.slideshowInterval);
  const setActiveId = useArchiveStore((state) => state.setActiveId);
  const setViewMode = useArchiveStore((state) => state.setViewMode);
  const setSearch = useArchiveStore((state) => state.setSearch);
  const setBranch = useArchiveStore((state) => state.setBranch);
  const setOnlyWithComments = useArchiveStore((state) => state.setOnlyWithComments);
  const setSlideshow = useArchiveStore((state) => state.setSlideshow);
  const [knownCommented, setKnownCommented] = useState(() => new Set(commentedIds));
  const [commentsByAsset, setCommentsByAsset] = useState(() => groupCommentPreviews(commentPreviews));
  const [metadataById, setMetadataById] = useState(() => new Map(metadata.map((item) => [item.assetId, item])));
  const [gridLimit, setGridLimit] = useState(INITIAL_GRID_ITEMS);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [viewerRosette, setViewerRosette] = useState(1);
  const [initialLoaded, setInitialLoaded] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [boardCompact, setBoardCompact] = useState(false);
  const settledInitial = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const boardSentinelRef = useRef<HTMLSpanElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const sentinel = boardSentinelRef.current;
      setBoardCompact(window.innerWidth > 620 && Boolean(sentinel && sentinel.getBoundingClientRect().top <= -10));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const branches = useMemo(() => Array.from(new Set(assets.map((asset) => asset.branch))).sort((a, b) => a.localeCompare(b, "ru")), [assets]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    return assets.filter((asset) => {
      if (branch !== "all" && asset.branch !== branch) return false;
      if (onlyWithComments && !knownCommented.has(asset.id)) return false;
      if (!query) return true;
      const manual = metadataById.get(asset.id);
      return `${asset.fileName} ${asset.branch} ${manual?.names || ""} ${manual?.year || ""} ${manual?.caption || ""}`.toLocaleLowerCase("ru").includes(query);
    });
  }, [assets, branch, knownCommented, metadataById, onlyWithComments, search]);
  const visibleGrid = filtered.slice(0, gridLimit);
  const hasMorePhotos = viewMode !== "table" && visibleGrid.length < filtered.length;
  const visibleIndexById = useMemo(() => new Map(visibleGrid.map((asset, index) => [asset.id, index])), [visibleGrid]);
  const albumGroups = useMemo(() => ["МАМА", "PAPA", "DEN"].includes(branch) ? albumsForBranch(visibleGrid, branch) : [], [branch, visibleGrid]);
  const initialImageIds = useMemo(() => new Set(visibleGrid.slice(0, INITIAL_IMAGE_BATCH).filter((asset) => asset.webPreview).map((asset) => asset.id)), [visibleGrid]);
  const initialImageKey = [...initialImageIds].join(",");
  const initialImageTotal = initialImageIds.size;
  const gridReady = initialImageTotal === 0 || initialLoaded >= initialImageTotal;

  useEffect(() => {
    settledInitial.current.clear();
    setInitialLoaded(0);
  }, [initialImageKey]);

  const markInitialImageSettled = useCallback((assetId: string) => {
    if (!initialImageIds.has(assetId) || settledInitial.current.has(assetId)) return;
    settledInitial.current.add(assetId);
    setInitialLoaded((current) => current + 1);
  }, [initialImageIds]);

  const addCommentToGrid = useCallback((comment: ArchiveComment) => {
    setKnownCommented((current) => new Set(current).add(comment.assetId));
    setCommentsByAsset((current) => {
      const next = new Map(current);
      const assetComments = next.get(comment.assetId) || [];
      next.set(comment.assetId, [...assetComments, {
        id: comment.id,
        assetId: comment.assetId,
        authorDisplayName: comment.authorDisplayName,
        kind: comment.kind,
        body: comment.body,
        createdAt: comment.createdAt,
      }]);
      return next;
    });
  }, []);

  useEffect(() => setGridLimit(INITIAL_GRID_ITEMS), [branch, onlyWithComments, search]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!hasMorePhotos || !sentinel) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return;
      requested = true;
      observer.disconnect();
      setGridLimit((current) => Math.min(filtered.length, current + GRID_STEP));
    }, { rootMargin: "800px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filtered.length, gridLimit, hasMorePhotos]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const activeIndex = filtered.findIndex((asset) => asset.id === activeId);
  const active = activeIndex >= 0 ? filtered[activeIndex] : assets.find((asset) => asset.id === activeId) || null;

  const openAsset = useCallback((id: string | null, versionId?: string) => {
    setActiveId(id);
    setActiveVersionId(versionId || null);
    if (id) setViewerRosette(nextRosette);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("photo", id);
    else params.delete("photo");
    window.history.replaceState(null, "", `/archive${params.size ? `?${params}` : ""}`);
  }, [setActiveId]);

  const selectCompactBranch = (value: string) => {
    setBranch(value);
    window.requestAnimationFrame(() => {
      const sentinel = boardSentinelRef.current;
      if (sentinel) window.scrollTo({ top: window.scrollY + sentinel.getBoundingClientRect().top + 24, behavior: "auto" });
    });
  };

  useEffect(() => {
    const fromUrl = searchParams.get("photo");
    if (fromUrl && assets.some((asset) => asset.id === fromUrl)) setActiveId(fromUrl);
  }, [assets, searchParams, setActiveId]);

  const move = useCallback((direction: -1 | 1) => {
    if (!filtered.length) return;
    const current = Math.max(0, activeIndex);
    const next = (current + direction + filtered.length) % filtered.length;
    openAsset(filtered[next].id);
  }, [activeIndex, filtered, openAsset]);

  useEffect(() => {
    if (!slideshow || !active) return;
    const timer = window.setInterval(() => move(1), slideshowInterval * 1000);
    return () => window.clearInterval(timer);
  }, [active, move, slideshow, slideshowInterval]);

  useEffect(() => {
    if (!active) return;
    function keyboard(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") openAsset(null);
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === " ") {
        event.preventDefault();
        setSlideshow(!slideshow);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [active, move, openAsset, setSlideshow, slideshow]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="archive-shell" data-branch={branch}>
      <ArchiveRosettes branch={branch} viewMode={viewMode} />
      <header className="archive-header">
        <div>
          <p className="eyebrow">Личная коллекция · {session.role === "admin" ? "режим владельца" : "семейный доступ"}</p>
          <h1>Семейный фотоархив</h1>
        </div>
        <div className="session-block">
          <span>{session.displayName}</span>
          <button className="text-action" onClick={logout}>Выйти</button>
        </div>
      </header>
      {session.role === "admin" && <section className="owner-tools" aria-label="Инструменты владельца">
        <div><strong>Инструменты владельца</strong><span>{canSync ? "Синхронизация с веб-архивом доступна на этом компьютере." : "Синхронизация не настроена на этом компьютере."}</span></div>
        <div className="owner-actions">
          <Link className="secondary-action" href="/owner/comments">Комментарии</Link>
          {canSync && <ArchiveDeployButton />}
        </div>
      </section>}

      <span className="control-board-sentinel" ref={boardSentinelRef} aria-hidden="true" />
      <section className={`control-board ${boardCompact ? "is-compact" : ""}`} aria-label="Управление каталогом">
        <div className="compact-controls">
          <span>{branch === "all" ? "Все фото" : branch}</span>
          <nav className="compact-branches" aria-label="Быстрый переход по ветвям">
            <button type="button" className="compact-branch-button" aria-label="Все фото" title="Все фото" aria-pressed={branch === "all"} onClick={() => selectCompactBranch("all")}><BranchIcon name="all" /></button>
            {branches.map((value) => <button type="button" className="compact-branch-button" key={value} aria-label={value} title={value} aria-pressed={branch === value} onClick={() => selectCompactBranch(value)}><BranchIcon name={value} /></button>)}
          </nav>
          <div className="compact-view-switch" role="group" aria-label="Вид каталога">
            {COMPACT_VIEW_MODES.map((mode) => <button type="button" className="compact-view-button" key={mode.value} aria-label={mode.label} title={mode.label} aria-pressed={viewMode === mode.value} onClick={() => setViewMode(mode.value)}><ViewModeIcon mode={mode.value} /></button>)}
          </div>
          <button type="button" className="compact-up-button" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })} aria-label="Вернуться к началу страницы"><span aria-hidden="true">↑</span><span className="compact-up-label"> Наверх</span></button>
        </div>
        <div className="catalog-actions">
          <button className={`search-toggle ${searchOpen ? "is-open" : ""}`} type="button" aria-expanded={searchOpen} aria-controls="catalog-search" onClick={() => {
            if (searchOpen) setSearch("");
            setSearchOpen((open) => !open);
          }}>
            <SearchIcon />
            <span>Поиск</span>
          </button>
          {searchOpen && <label className="search-field" id="catalog-search">
            <span className="sr-only">Поиск</span>
            <input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя файла, имя человека, год" />
          </label>}
        </div>
        <nav className="branch-buttons" aria-label="Семейные ветви">
          <button type="button" className={`branch-button ${branch === "all" ? "is-active" : ""}`} aria-pressed={branch === "all"} onClick={() => setBranch("all")}>
            <BranchIcon name="all" />
            <span>Все фото</span>
          </button>
          {branches.map((value) => <button type="button" key={value} className={`branch-button ${branch === value ? "is-active" : ""}`} aria-pressed={branch === value} onClick={() => setBranch(value)}>
            <BranchIcon name={value} />
            <span>{value}</span>
          </button>)}
        </nav>
        <div className="view-switch" aria-label="Вид каталога">
          <button aria-pressed={viewMode === "mosaic"} onClick={() => setViewMode("mosaic")}>Мозаика</button>
          <button aria-pressed={viewMode === "medium"} onClick={() => setViewMode("medium")}>Средние</button>
          <button aria-pressed={viewMode === "compact"} onClick={() => setViewMode("compact")}>Мелкие</button>
          <button aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")}>Таблица</button>
        </div>
        <label className="check-field">
          <input type="checkbox" checked={onlyWithComments} onChange={(event) => setOnlyWithComments(event.target.checked)} />
          <span>Только с историями</span>
        </label>
      </section>

      <div className="catalog-summary">
        <span>{filtered.length.toLocaleString("ru-RU")} из {assets.length.toLocaleString("ru-RU")}</span>
        <span>Индекс обновлен {new Date(generatedAt).toLocaleString("ru-RU")}</span>
      </div>

      {viewMode !== "table" ? (
        <>
          {!gridReady && <section className="catalog-loader" role="status" aria-live="polite" aria-label="Загрузка первых фотографий">
            <div><span>Подготавливаем сетку</span><strong>{initialLoaded} / {initialImageTotal}</strong></div>
            <span className="catalog-loader-track"><span style={{ width: `${initialImageTotal ? (initialLoaded / initialImageTotal) * 100 : 100}%` }} /></span>
          </section>}
          {["МАМА", "PAPA", "DEN"].includes(branch) ? <div className="album-list" aria-label={`Альбомы ${branch}`}>
            {albumGroups.map((album) => <section className={`album-section ${gridReady ? "is-ready" : "is-loading"}`} key={album.key} aria-labelledby={`album-${album.key}`}>
              <h2 id={`album-${album.key}`}>{album.title}</h2>
              <PhotoGrid assets={album.assets} branch={branch} viewMode={viewMode} gridReady={gridReady} indexById={visibleIndexById} commentsByAsset={commentsByAsset} metadataById={metadataById} onPreviewSettled={markInitialImageSettled} onOpen={openAsset} />
            </section>)}
          </div> : <PhotoGrid assets={visibleGrid} branch={branch} viewMode={viewMode} gridReady={gridReady} indexById={visibleIndexById} commentsByAsset={commentsByAsset} metadataById={metadataById} onPreviewSettled={markInitialImageSettled} onOpen={openAsset} />}
        </>
      ) : (
        <div className="table-wrap">
          <table className="asset-table">
            <thead><tr><th>Фотография</th><th>Ветвь</th><th>Формат</th><th>Разрешение</th><th>Размер</th><th>История</th></tr></thead>
            <tbody>{filtered.map((asset) => (
              <tr key={asset.id} onClick={() => openAsset(asset.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openAsset(asset.id)}>
                <td>{asset.fileName}</td><td>{asset.branch}</td><td>{asset.technicalMetadata.extension}</td>
                <td>{asset.technicalMetadata.width || "?"}×{asset.technicalMetadata.height || "?"}</td>
                <td>{formatBytes(asset.technicalMetadata.bytes)}</td><td>{knownCommented.has(asset.id) ? "Есть" : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {hasMorePhotos && <div className="load-sentinel" ref={loadMoreRef} aria-hidden="true" />}

      {!filtered.length && <section className="empty-state"><h2>Ничего не найдено</h2><p>Измените поиск или фильтр.</p></section>}
      {active && <PhotoViewer asset={active} metadataById={metadataById} initialVersionId={activeVersionId} position={Math.max(0, activeIndex) + 1} total={filtered.length || assets.length} slideshow={slideshow} onSetSlideshow={setSlideshow} onClose={() => openAsset(null)} onPrevious={() => move(-1)} onNext={() => move(1)} rosetteId={viewerRosette} onVersionChange={() => setViewerRosette(nextRosette)} onCommented={addCommentToGrid} onMetadataSaved={(item) => setMetadataById((current) => new Map(current).set(item.assetId, item))} />}
    </main>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.8" cy="10.8" r="5.8" /><path d="m15.2 15.2 4.3 4.3" /></svg>;
}

function PhotoGrid({ assets, branch, viewMode, gridReady, indexById, commentsByAsset, metadataById, onPreviewSettled, onOpen }: {
  assets: Asset[]; branch: string; viewMode: string; gridReady: boolean; indexById: Map<string, number>;
  commentsByAsset: Map<string, ArchiveCommentPreview[]>; metadataById: Map<string, AssetMetadata>;
  onPreviewSettled: (assetId: string) => void; onOpen: (id: string, versionId?: string) => void;
}) {
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  const rows = useMemo(() => groupPhotoRows(assets, viewMode, mobile, 0), [assets, viewMode, mobile]);
  let rowStart = 0;
  return <section className={`photo-grid ${viewMode} ${gridReady ? "is-ready" : "is-loading"}`} aria-label="Фотографии" aria-busy={!gridReady}>
    {rows.map((row, rowIndex) => {
      const firstIndex = rowStart;
      rowStart += row.length;
      const nextBranch = branch === "all" ? rows[rowIndex + 1]?.[0]?.branch : branch;
      const separator = nextBranch ? DIVIDERS[nextBranch] : null;
      return <div className="photo-row-block" key={row[0].id}>
        <div className="photo-row">
          {row.map((asset, index) => {
            const absoluteIndex = indexById.get(asset.id) ?? firstIndex + index;
            return <GridPhotoCard key={asset.id} asset={asset} comments={commentsByAsset.get(asset.id) || []} metadataById={metadataById} index={absoluteIndex} span={cardSpan(firstIndex + index, viewMode, mobile)} priority={absoluteIndex < INITIAL_IMAGE_BATCH} onPreviewSettled={onPreviewSettled} onOpen={onOpen} />;
          })}
        </div>
        {rowIndex < rows.length - 1 && separator && <div className="row-separator" style={{ maskImage: `url(/api/decor/${separator})` }} aria-hidden="true" />}
      </div>;
    })}
  </section>;
}

function GridPhotoCard({ asset, comments, metadataById, index, span, priority, onPreviewSettled, onOpen }: { asset: Asset; comments: ArchiveCommentPreview[]; metadataById: Map<string, AssetMetadata>; index: number; span: number; priority: boolean; onPreviewSettled: (assetId: string) => void; onOpen: (id: string, versionId?: string) => void }) {
  const versions = versionsFor(asset);
  const [versionId, setVersionId] = useState(versions[0].id);
  const selectedVersion = versions.find((version) => version.id === versionId) || versions[0];
  const metadata = metadataById.get(selectedVersion.id) || metadataById.get(asset.id);
  const [imageLoaded, setImageLoaded] = useState(false);
  const ratio = selectedVersion.technicalMetadata.width && selectedVersion.technicalMetadata.height ? `${selectedVersion.technicalMetadata.width} / ${selectedVersion.technicalMetadata.height}` : "4 / 3";

  useEffect(() => setVersionId(versions[0].id), [asset.id, versions]);
  useEffect(() => setImageLoaded(false), [selectedVersion.id]);

  function imageSettled() {
    setImageLoaded(true);
    if (priority) onPreviewSettled(asset.id);
  }

  return <article className="photo-card" style={{ "--order": Math.min(index, 12), gridColumn: `span ${span}` } as React.CSSProperties}>
    {versions.length > 1 && <label className="grid-version-slider">
      <span>{asset.bridgeStack ? "Фото в группе" : "Вариант"}</span>
      <input type="range" min="0" max={versions.length - 1} value={versions.findIndex((version) => version.id === selectedVersion.id)} onChange={(event) => setVersionId(versions[Number(event.target.value)].id)} aria-label={asset.bridgeStack ? "Фото в группе" : "Вариант фотографии"} />
      <small>{versions.findIndex((version) => version.id === selectedVersion.id) + 1} / {versions.length}</small>
    </label>}
    <button className="photo-card-open" onClick={() => onOpen(asset.id, selectedVersion.id)}>
      <span className={`photo-frame ${imageLoaded ? "is-loaded" : ""}`} style={{ aspectRatio: ratio }}>
        {selectedVersion.webPreview ? <>
          {/* eslint-disable-next-line @next/next/no-img-element -- the authenticated route already serves a resized derivative */}
          <img src={mediaUrl(selectedVersion.id, "thumb")} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" onLoad={imageSettled} onError={imageSettled} alt={selectedVersion.fileName} />
        </> : <span className="unavailable">Нет превью</span>}
        {(metadata?.caption || metadata?.names || metadata?.year) && <span className="photo-description">
          {metadata.caption && <strong>{metadata.caption}</strong>}
          {metadata.names && <span>{metadata.names}</span>}
          {metadata.year && <span>{metadata.year}</span>}
        </span>}
      </span>
      <span className="photo-card-copy">
        <strong>{selectedVersion.fileName}</strong>
        {comments.length > 0 && <span className="photo-card-comments">
          {comments.map((comment) => <span className="photo-card-comment" key={comment.id}><small>{comment.authorDisplayName}</small>{comment.body}</span>)}
        </span>}
      </span>
    </button>
  </article>;
}

function PhotoViewer({ asset, metadataById, initialVersionId, position, total, slideshow, onSetSlideshow, onClose, onPrevious, onNext, rosetteId, onVersionChange, onCommented, onMetadataSaved }: {
  asset: Asset; initialVersionId: string | null; position: number; total: number; slideshow: boolean; onSetSlideshow: (value: boolean) => void;
  metadataById: Map<string, AssetMetadata>; onClose: () => void; onPrevious: () => void; onNext: () => void; rosetteId: number; onVersionChange: () => void; onCommented: (comment: ArchiveComment) => void; onMetadataSaved: (metadata: AssetMetadata) => void;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const zoom = useArchiveStore((state) => state.zoom);
  const setZoom = useArchiveStore((state) => state.setZoom);
  const detailsOpen = useArchiveStore((state) => state.detailsOpen);
  const setDetailsOpen = useArchiveStore((state) => state.setDetailsOpen);
  const versions = versionsFor(asset);
  const [versionId, setVersionId] = useState(initialVersionId || versions[0].id);
  const selectedVersion = versions.find((version) => version.id === versionId) || versions[0];
  const displayedAsset: Asset = { ...asset, ...selectedVersion };
  const metadata = metadataById.get(selectedVersion.id) || metadataById.get(asset.id);
  const isPdf = asset.technicalMetadata.mimeType === "application/pdf";

  useEffect(() => setVersionId(initialVersionId || versions[0].id), [asset.id, initialVersionId, versions]);

  async function fullscreen() {
    if (!document.fullscreenElement) await viewerRef.current?.requestFullscreen();
    else await document.exitFullscreen();
  }

  return (
    <div className="viewer" ref={viewerRef} role="dialog" aria-modal="true" aria-label={asset.title}>
      <span className="viewer-rosette" aria-hidden="true" style={{ maskImage: `url(/api/decor/rosett${String(rosetteId).padStart(2, "0")}.svg)` }} />
      <div className="viewer-toolbar">
        <button className="back-to-album" onClick={onClose}>← К альбому</button>
        <span>{position} / {total}</span>
        <div>
          <button onClick={() => setZoom(zoom - 0.25)} aria-label="Уменьшить">−</button>
          <button onClick={() => setZoom(1)}>По размеру</button>
          <button onClick={() => setZoom(zoom + 0.25)} aria-label="Увеличить">+</button>
          <button onClick={() => onSetSlideshow(!slideshow)}>{slideshow ? "Пауза" : "Слайд-шоу"}</button>
          {!isPdf && versions.length > 1 && <label className="version-slider">{asset.bridgeStack ? "Фото в группе" : "Версия"} <input type="range" min="0" max={versions.length - 1} value={versions.findIndex((version) => version.id === selectedVersion.id)} onChange={(event) => { setVersionId(versions[Number(event.target.value)].id); onVersionChange(); }} aria-label={asset.bridgeStack ? "Фото в группе" : "Версия фотографии"} /><span>{versions.findIndex((version) => version.id === selectedVersion.id) + 1} / {versions.length}</span></label>}
          <button onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? "Скрыть сведения" : "Сведения"}</button>
          <button onClick={fullscreen}>Полный экран</button>
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
      <button className="viewer-arrow previous" onClick={onPrevious} aria-label="Предыдущая фотография">‹</button>
      <div className="viewer-stage">
        {/* eslint-disable-next-line @next/next/no-img-element -- the authenticated route already serves a resized derivative */}
        {isPdf ? <PdfPages asset={asset} /> : <img key={selectedVersion.id} src={mediaUrl(selectedVersion.id, zoom > 1.5 ? "full" : "screen")} alt={asset.title} style={{ transform: `scale(${zoom})` }} />}
      </div>
      <button className="viewer-arrow next" onClick={onNext} aria-label="Следующая фотография">›</button>
      {detailsOpen && <PhotoDetails key={selectedVersion.id} asset={displayedAsset} metadata={metadata} onCommented={onCommented} onMetadataSaved={onMetadataSaved} />}
    </div>
  );
}

function PdfPages({ asset }: { asset: Asset }) {
  const pageCount = Math.max(1, asset.technicalMetadata.pages || 1);
  return <div className="pdf-pages" aria-label={`Все страницы PDF: ${pageCount}`}>
    {Array.from({ length: pageCount }, (_, index) => <figure key={index}><figcaption>Страница {index + 1} из {pageCount}</figcaption>{/* eslint-disable-next-line @next/next/no-img-element -- each PDF page is served as an authenticated WebP derivative */}<img src={mediaUrl(asset.id, "screen", index)} loading={index === 0 ? "eager" : "lazy"} alt={`Страница ${index + 1}: ${asset.title}`} /></figure>)}
  </div>;
}

function PhotoDetails({ asset, metadata, onCommented, onMetadataSaved }: { asset: Asset; metadata?: AssetMetadata; onCommented: (comment: ArchiveComment) => void; onMetadataSaved: (metadata: AssetMetadata) => void }) {
  const [comments, setComments] = useState<ArchiveComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<CommentKind>("memory");
  const [names, setNames] = useState(metadata?.names || "");
  const [year, setYear] = useState(metadata?.year || "");
  const [caption, setCaption] = useState(metadata?.caption || "");
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState("");
  const draft = useArchiveStore((state) => state.drafts[asset.id] || "");
  const setDraft = useArchiveStore((state) => state.setDraft);

  useEffect(() => {
    const stored = localStorage.getItem(`archive-draft:${asset.id}`);
    if (stored) {
      setDraft(asset.id, stored);
      setMessage("Найден черновик с этого устройства. Нажмите «Сохранить воспоминание», чтобы добавить его в общий архив.");
    }
  }, [asset.id, setDraft]);

  useEffect(() => {
    if (draft) localStorage.setItem(`archive-draft:${asset.id}`, draft);
    else localStorage.removeItem(`archive-draft:${asset.id}`);
  }, [asset.id, draft]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/comments/${asset.id}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { comments: ArchiveComment[]; storageAvailable?: boolean }) => {
        setComments(data.comments);
        if (data.storageAvailable === false) setMessage("Общее хранилище ещё подключается. Черновик остаётся на этом устройстве.");
      })
      .catch(() => !controller.signal.aborted && setMessage("Не удалось загрузить истории. Черновик остаётся на этом устройстве."))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [asset.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/comments/${asset.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft, kind }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setMessage(payload.error || "Текст остался на этом устройстве. Проверьте соединение и попробуйте еще раз.");
      setSaving(false);
      return;
    }
    const data = (await response.json()) as { comment: ArchiveComment };
    setComments((current) => [...current, data.comment]);
    setDraft(asset.id, "");
    setMessage("Сохранено в семейном архиве.");
    setSaving(false);
    onCommented(data.comment);
  }

  async function saveMetadata(event: FormEvent) {
    event.preventDefault();
    setMetadataSaving(true);
    setMetadataMessage("");
    const response = await fetch(`/api/metadata/${asset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, year, caption }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setMetadataMessage(payload.error || "Не удалось сохранить данные.");
      setMetadataSaving(false);
      return;
    }
    const data = await response.json() as { metadata: AssetMetadata };
    onMetadataSaved(data.metadata);
    setMetadataMessage("Сохранено.");
    setMetadataSaving(false);
  }

  return (
    <aside className="details-panel">
      <div className="details-scroll">
        <p className="eyebrow">Карточка снимка</p>
        <h2>{asset.fileName}</h2>
        <section className="stories" aria-labelledby="stories-title">
          <h3 id="stories-title">Истории и уточнения</h3>
          {loading && <p>Загружаем…</p>}
          {!loading && comments.length === 0 && <p className="muted">Здесь пока нет записей. Можно оставить первое воспоминание.</p>}
          {comments.map((comment) => (
            <article className="comment" key={comment.id}>
              <header><strong>{comment.authorDisplayName}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time></header>
              <p>{comment.body}</p>
              <small>{COMMENT_KINDS.find((item) => item.value === comment.kind)?.label}</small>
            </article>
          ))}
        </section>
        <dl className="technical-list">
          <div><dt>Ветвь</dt><dd>{asset.branch}</dd></div>
          <div><dt>Год снимка</dt><dd>{metadata?.year || "Не указан"}</dd></div>
          <div><dt>Файл</dt><dd>{asset.fileName}</dd></div>
          <div><dt>Параметры</dt><dd>{asset.technicalMetadata.width || "?"}×{asset.technicalMetadata.height || "?"}, {asset.technicalMetadata.extension}</dd></div>
          <div><dt>Размер</dt><dd>{formatBytes(asset.technicalMetadata.bytes)}</dd></div>
          <div><dt>Оцифровано/изменено</dt><dd>{new Date(asset.technicalMetadata.modifiedAt).toLocaleDateString("ru-RU")}</dd></div>
          {asset.versionHint && <div><dt>Версия</dt><dd>{asset.versionHint}</dd></div>}
        </dl>

        <form className="metadata-form" onSubmit={saveMetadata}>
          <h3>Данные снимка</h3>
          <label>Имя или имена<input value={names} onChange={(event) => setNames(event.target.value)} maxLength={500} placeholder="Например: Алла Арнольдовна, Настя" /></label>
          <label>Год<input type="number" inputMode="numeric" min="1800" max="2100" value={year} onChange={(event) => setYear(event.target.value)} placeholder="Например: 1968" /></label>
          <label>Подпись<textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2000} rows={3} placeholder="Что видно на снимке" /></label>
          <button className="secondary-action" disabled={metadataSaving}>{metadataSaving ? "Сохраняем…" : "Сохранить данные"}</button>
          {metadataMessage && <p className="save-message" role="status">{metadataMessage}</p>}
        </form>

        <form className="memory-form" onSubmit={save}>
          <label>
            Что вы хотите добавить?
            <select value={kind} onChange={(event) => setKind(event.target.value as CommentKind)}>
              {COMMENT_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Ваш рассказ
            <textarea value={draft} onChange={(event) => setDraft(asset.id, event.target.value)} maxLength={5000} rows={5} placeholder="Кто здесь, где и когда это было? Что вы помните об этом дне?" />
          </label>
          <button className="primary-action" disabled={saving || !draft.trim()}>{saving ? "Сохраняем…" : "Сохранить воспоминание"}</button>
          {message && <p className="save-message" role="status">{message}</p>}
        </form>
      </div>
    </aside>
  );
}
