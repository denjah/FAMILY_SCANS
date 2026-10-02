"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ArchiveDeployButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function deploy() {
    if (!window.confirm("Пересканировать архив и группы Bridge, затем загрузить в онлайн только новые и изменённые экранные копии? Оригиналы не изменяются.")) return;
    setBusy(true);
    setMessage("Пересканирование и подготовка обновлений…");
    try {
      const response = await fetch("/api/admin/sync", { method: "POST" });
      const result = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Публикация не завершилась.");
      setMessage(result.message || "Онлайн-архив обновлён.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Публикация не завершилась.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="archive-deploy-control">
    <button className="primary-action" type="button" onClick={deploy} disabled={busy} title="Пересканировать архив и загрузить новые или изменённые фото">
      {busy ? "Обновляем онлайн…" : "Обновить онлайн"}
    </button>
    {message && <p className="sync-message" role="status">{message}</p>}
  </div>;
}
