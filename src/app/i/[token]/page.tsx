import { redirect } from "next/navigation";
import { getSession, verifyInviteToken } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { ArchiveLanding } from "@/components/archive-landing";
import { getManifest } from "@/lib/archive";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const session = await getSession();
  if (session) redirect("/archive");
  const { token } = await params;
  if (!verifyInviteToken(token)) {
    return (
      <main className="gate-shell">
        <section className="gate-card">
          <p className="eyebrow">Доступ закрыт</p>
          <h1>Ссылка устарела</h1>
          <p>Попросите владельца архива прислать новое приглашение.</p>
        </section>
      </main>
    );
  }
  let slides: string[] = [];
  try {
    const photos = getManifest().assets.filter((asset) => asset.kind === "photo" && asset.webPreview && !asset.sensitive);
    slides = [...photos].sort(() => Math.random() - 0.5).slice(0, Math.min(8, photos.length)).map((asset) => asset.id);
  } catch {
    // The entry form remains available even while the archive index is being rebuilt.
  }
  return (
    <ArchiveLanding slides={slides}>
      <section className="gate-card">
        <p className="eyebrow">Семейная фототека</p>
        <h1>Добро пожаловать</h1>
        <p>Введите свое имя и семейный пароль. Имя будет подписано под вашими воспоминаниями.</p>
        <LoginForm invite={token} />
      </section>
    </ArchiveLanding>
  );
}
