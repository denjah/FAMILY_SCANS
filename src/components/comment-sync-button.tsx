"use client";

import { useState } from "react";

export function CommentSyncButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function synchronize() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/sync-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json().catch(() => ({})) as { message?: string; error?: string; count?: number };
      if (!response.ok) throw new Error(result.error || "Синхронизация не завершилась.");
      setMessage(`${result.message || "Синхронизация завершена."} Записей: ${result.count ?? 0}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Синхронизация не завершилась.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="comment-sync-control">
    <button className="secondary-action" type="button" onClick={synchronize} disabled={busy}>
      {busy ? "Синхронизируем…" : "Синхронизировать с общей базой"}
    </button>
    {message && <p className="comment-sync-message" role="status">{message}</p>}
  </div>;
}
