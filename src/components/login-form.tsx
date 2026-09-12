"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ invite, ownerOnly = false }: { invite?: string; ownerOnly?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [admin, setAdmin] = useState(ownerOnly);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(invite ? { invite } : {}),
        displayName: form.get("displayName"),
        password: form.get("password"),
        admin: ownerOnly || admin,
      }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Не удалось войти. Попробуйте еще раз.");
      setSaving(false);
      return;
    }
    router.replace("/archive");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Ваше имя
        <input name="displayName" autoComplete="name" minLength={2} maxLength={80} required placeholder="Например, Алла" autoFocus />
      </label>
      <label>
        {ownerOnly || admin ? "Пароль владельца" : "Семейный пароль"}
        <input name="password" type="password" autoComplete="current-password" minLength={4} required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-action" type="submit" disabled={saving}>{saving ? "Проверяем…" : ownerOnly ? "Войти как владелец" : "Открыть архив"}</button>
      {!ownerOnly && <button className="quiet-action" type="button" onClick={() => setAdmin((value) => !value)}>
        {admin ? "Войти как родственник" : "Вход для владельца"}
      </button>}
      <button className="quiet-action" type="button" onClick={() => setRecoveryOpen((value) => !value)}>
        Забыли пароль?
      </button>
      {recoveryOpen && <aside className="recovery-card" role="status">
        <strong>Восстановление доступа</strong>
        <p>Напишите архивариусу с адреса, по которому вас можно узнать. В письме не указывайте пароль.</p>
        <a href="mailto:denjah@gmail.com?subject=%D0%92%D0%BE%D1%81%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%B4%D0%BE%D1%81%D1%82%D1%83%D0%BF%D0%B0%20%D0%BA%20%D1%81%D0%B5%D0%BC%D0%B5%D0%B9%D0%BD%D0%BE%D0%BC%D1%83%20%D0%B0%D1%80%D1%85%D0%B8%D0%B2%D1%83">denjah@gmail.com</a>
      </aside>}
    </form>
  );
}
