import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OwnerLoginPage() {
  const session = await getSession();
  if (session?.role === "admin") redirect("/archive");
  return (
    <main className="gate-shell">
      <section className="gate-card" aria-labelledby="owner-title">
        <p className="eyebrow">Режим владельца</p>
        <h1 id="owner-title">Управление архивом</h1>
        <p>Войдите с паролем владельца. Здесь доступны синхронизация и другие служебные инструменты; обычные участники их не видят.</p>
        <LoginForm ownerOnly />
        <p className="owner-entry"><Link href="/">← Обычный вход в архив</Link></p>
      </section>
    </main>
  );
}
