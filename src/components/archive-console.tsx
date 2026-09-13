"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ArchiveComment, Asset, AssetVersion, CommentKind } from "@/types/archive";
import { useArchiveStore } from "@/store/archive-store";

interface Props {
  assets: Asset[];
  commentedIds: string[];
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

function mediaUrl(assetId: string, variant: "thumb" | "screen" | "full", page?: number): string {
  return `/api/media/${encodeURIComponent(assetId)}/${variant}${page === undefined ? "" : `?page=${page}`}`;
}

export function ArchiveConsole({ assets, commentedIds, session, generatedAt, canSync }: Props) {
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
  const [gridLimit, setGridLimit] = useState(INITIAL_GRID_ITEMS);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => {
    const mamaDescriptions = assets
      .filter((asset) => asset.branch === "МАМА" && asset.caption)
      .map(({ id, title, fileName, caption }) => ({ id, title, fileName, caption }));
    console.info("[Фотоархив] Описания альбома «МАМА»", mamaDescriptions);
  }, [assets]);

  const branches = useMemo(() => Array.from(new Set(assets.map((asset) => asset.branch))).sort((a, b) => a.localeCompare(b, "ru")), [assets]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    return assets.filter((asset) => {
      if (branch !== "all" && asset.branch !== branch) return false;
      if (onlyWithComments && !knownCommented.has(asset.id)) return false;
      if (!query) return true;
      return `${asset.title} ${asset.fileName} ${asset.branch}`.toLocaleLowerCase("ru").includes(query);
    });
  }, [assets, branch, knownCommented, onlyWithComments, search]);
  const visibleGrid = filtered.slice(0, gridLimit);

  useEffect(() => setGridLimit(INITIAL_GRID_ITEMS), [branch, onlyWithComments, search]);

  const activeIndex = filtered.findIndex((asset) => asset.id === activeId);
  const active = activeIndex >= 0 ? filtered[activeIndex] : assets.find((asset) => asset.id === activeId) || null;

  const openAsset = useCallback((id: string | null, versionId?: string) => {
    setActiveId(id);
    setActiveVersionId(versionId || null);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("photo", id);
    else params.delete("photo");
    window.history.replaceState(null, "", `/archive${params.size ? `?${params}` : ""}`);
  }, [setActiveId]);

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

  async function syncArchive() {
    if (!window.confirm("Пересканировать папки, создать экранные копии и загрузить их в веб-архив? Оригиналы фотографий не изменяются.")) return;
    setSyncing(true);
    setSyncMessage("Сканирование и подготовка экранных копий…");
    try {
      const response = await fetch("/api/admin/sync", { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Синхронизация не выполнена.");
      setSyncMessage(payload.message || "Готово. Веб-архив обновится в течение нескольких минут.");
      router.refresh();
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Синхронизация не выполнена.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="archive-shell">
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
          {canSync && <button className="primary-action" onClick={syncArchive} disabled={syncing}>{syncing ? "Синхронизация…" : "Синхронизировать веб-архив"}</button>}
        </div>
      </section>}
      {canSync && syncMessage && <p className="sync-message" role="status">{syncMessage}</p>}

      <section className="control-board" aria-label="Управление каталогом">
        <label className="search-field">
          <span>Поиск</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя файла, ветвь, название" />
        </label>
        <label>
          <span>Семейная ветвь</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="all">Все ветви</option>
            {branches.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="view-switch" aria-label="Вид каталога">
          <button aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}>Сетка</button>
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

      {viewMode === "grid" ? (
        <section className="photo-grid" aria-label="Фотографии">
          {visibleGrid.map((asset, index) => <GridPhotoCard key={asset.id} asset={asset} index={index} onOpen={openAsset} />)}
        </section>
      ) : (
        <div className="table-wrap">
          <table className="asset-table">
            <thead><tr><th>Фотография</th><th>Ветвь</th><th>Формат</th><th>Разрешение</th><th>Размер</th><th>История</th></tr></thead>
            <tbody>{filtered.map((asset) => (
              <tr key={asset.id} onClick={() => openAsset(asset.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openAsset(asset.id)}>
                <td>{asset.title}</td><td>{asset.branch}</td><td>{asset.technicalMetadata.extension}</td>
                <td>{asset.technicalMetadata.width || "?"}×{asset.technicalMetadata.height || "?"}</td>
                <td>{formatBytes(asset.technicalMetadata.bytes)}</td><td>{knownCommented.has(asset.id) ? "Есть" : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {viewMode === "grid" && visibleGrid.length < filtered.length && <div className="load-more"><button className="primary-action" onClick={() => setGridLimit((current) => current + GRID_STEP)}>Показать ещё {Math.min(GRID_STEP, filtered.length - visibleGrid.length)}</button></div>}

      {!filtered.length && <section className="empty-state"><h2>Ничего не найдено</h2><p>Измените поиск или фильтр.</p></section>}
      {active && <PhotoViewer asset={active} initialVersionId={activeVersionId} position={Math.max(0, activeIndex) + 1} total={filtered.length || assets.length} slideshow={slideshow} onSetSlideshow={setSlideshow} onClose={() => openAsset(null)} onPrevious={() => move(-1)} onNext={() => move(1)} onCommented={() => setKnownCommented((current) => new Set(current).add(active.id))} />}
    </main>
  );
}

function GridPhotoCard({ asset, index, onOpen }: { asset: Asset; index: number; onOpen: (id: string, versionId?: string) => void }) {
  const versions = versionsFor(asset);
  const [versionId, setVersionId] = useState(versions[0].id);
  const selectedVersion = versions.find((version) => version.id === versionId) || versions[0];

  useEffect(() => setVersionId(versions[0].id), [asset.id, versions]);

  return <article className="photo-card" style={{ "--order": Math.min(index, 12) } as React.CSSProperties}>
    <button className="photo-card-open" onClick={() => onOpen(asset.id, selectedVersion.id)}>
      <span className="photo-frame">
        {selectedVersion.webPreview ? <>
          {/* eslint-disable-next-line @next/next/no-img-element -- the authenticated route already serves a resized derivative */}
          <img src={mediaUrl(selectedVersion.id, "thumb")} loading="lazy" alt={asset.title || "Архивная фотография"} />
        </> : <span className="unavailable">Нет превью</span>}
        {asset.caption && <span className="photo-description">{asset.caption}</span>}
      </span>
      <span className="photo-card-copy"><span className="photo-title-row"><strong>{asset.title}</strong><small className="file-name">{selectedVersion.fileName}</small></span><small>{asset.branch} · {selectedVersion.technicalMetadata.width || "?"}×{selectedVersion.technicalMetadata.height || "?"}</small></span>
    </button>
    {versions.length > 1 && <label className="grid-version-picker">Вариант <select value={selectedVersion.id} onChange={(event) => setVersionId(event.target.value)}>{versions.map((version, versionIndex) => <option key={version.id} value={version.id}>{versionIndex === 0 ? "Основной" : `Версия ${versionIndex + 1}`}</option>)}</select></label>}
  </article>;
}

function PhotoViewer({ asset, initialVersionId, position, total, slideshow, onSetSlideshow, onClose, onPrevious, onNext, onCommented }: {
  asset: Asset; initialVersionId: string | null; position: number; total: number; slideshow: boolean; onSetSlideshow: (value: boolean) => void;
  onClose: () => void; onPrevious: () => void; onNext: () => void; onCommented: () => void;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const zoom = useArchiveStore((state) => state.zoom);
  const setZoom = useArchiveStore((state) => state.setZoom);
  const detailsOpen = useArchiveStore((state) => state.detailsOpen);
  const setDetailsOpen = useArchiveStore((state) => state.setDetailsOpen);
  const versions = versionsFor(asset);
  const [versionId, setVersionId] = useState(initialVersionId || versions[0].id);
  const selectedVersion = versions.find((version) => version.id === versionId) || versions[0];
  const displayedAsset: Asset = { ...asset, ...selectedVersion, id: asset.id };
  const isPdf = asset.technicalMetadata.mimeType === "application/pdf";

  useEffect(() => setVersionId(initialVersionId || versions[0].id), [asset.id, initialVersionId, versions]);

  async function fullscreen() {
    if (!document.fullscreenElement) await viewerRef.current?.requestFullscreen();
    else await document.exitFullscreen();
  }

  return (
    <div className="viewer" ref={viewerRef} role="dialog" aria-modal="true" aria-label={asset.title}>
      <div className="viewer-toolbar">
        <button className="back-to-album" onClick={onClose}>← К альбому</button>
        <span>{position} / {total}</span>
        <div>
          <button onClick={() => setZoom(zoom - 0.25)} aria-label="Уменьшить">−</button>
          <button onClick={() => setZoom(1)}>По размеру</button>
          <button onClick={() => setZoom(zoom + 0.25)} aria-label="Увеличить">+</button>
          <button onClick={() => onSetSlideshow(!slideshow)}>{slideshow ? "Пауза" : "Слайд-шоу"}</button>
          {!isPdf && versions.length > 1 && <label className="version-slider">Версия <input type="range" min="0" max={versions.length - 1} value={versions.findIndex((version) => version.id === selectedVersion.id)} onChange={(event) => setVersionId(versions[Number(event.target.value)].id)} aria-label="Версия фотографии" /><span>{versions.findIndex((version) => version.id === selectedVersion.id) + 1} / {versions.length}</span></label>}
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
      {detailsOpen && <PhotoDetails key={asset.id} asset={displayedAsset} onCommented={onCommented} />}
    </div>
  );
}

function PdfPages({ asset }: { asset: Asset }) {
  const pageCount = Math.max(1, asset.technicalMetadata.pages || 1);
  return <div className="pdf-pages" aria-label={`Все страницы PDF: ${pageCount}`}>
    {Array.from({ length: pageCount }, (_, index) => <figure key={index}><figcaption>Страница {index + 1} из {pageCount}</figcaption>{/* eslint-disable-next-line @next/next/no-img-element -- each PDF page is served as an authenticated WebP derivative */}<img src={mediaUrl(asset.id, "screen", index)} loading={index === 0 ? "eager" : "lazy"} alt={`Страница ${index + 1}: ${asset.title}`} /></figure>)}
  </div>;
}

function PhotoDetails({ asset, onCommented }: { asset: Asset; onCommented: () => void }) {
  const [comments, setComments] = useState<ArchiveComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<CommentKind>("memory");
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
    onCommented();
  }

  return (
    <aside className="details-panel">
      <div className="details-scroll">
        <p className="eyebrow">Карточка снимка</p>
        <h2>{asset.title}</h2>
        <dl className="technical-list">
          <div><dt>Ветвь</dt><dd>{asset.branch}</dd></div>
          <div><dt>Дата снимка</dt><dd>Пока не установлена</dd></div>
          <div><dt>Файл</dt><dd>{asset.fileName}</dd></div>
          <div><dt>Параметры</dt><dd>{asset.technicalMetadata.width || "?"}×{asset.technicalMetadata.height || "?"}, {asset.technicalMetadata.extension}</dd></div>
          <div><dt>Размер</dt><dd>{formatBytes(asset.technicalMetadata.bytes)}</dd></div>
          <div><dt>Оцифровано/изменено</dt><dd>{new Date(asset.technicalMetadata.modifiedAt).toLocaleDateString("ru-RU")}</dd></div>
          {asset.versionHint && <div><dt>Версия</dt><dd>{asset.versionHint}</dd></div>}
        </dl>

        {asset.embeddedNotes?.length ? <section className="embedded-notes" aria-labelledby="embedded-notes-title">
          <h3 id="embedded-notes-title">Описание из файла</h3>
          {asset.embeddedNotes.map((note, index) => <article key={`${note.source}-${index}`}><small>{note.source}{note.title ? ` · ${note.title}` : ""}</small><p>{note.body}</p></article>)}
        </section> : null}

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
