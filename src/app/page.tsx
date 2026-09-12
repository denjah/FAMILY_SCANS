import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getRuntimeManifest } from "@/lib/archive";
import { ArchiveLanding } from "@/components/archive-landing";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  let slides: string[] = [];
  try {
    const photos = (await getRuntimeManifest()).assets.filter((asset) => asset.kind === "photo" && asset.webPreview && !asset.sensitive);
    slides = [...photos].sort(() => Math.random() - 0.5).slice(0, Math.min(8, photos.length)).map((asset) => asset.id);
  } catch {
    // The sign-in screen must remain usable while the archive index is being rebuilt.
  }
  return (
    <ArchiveLanding slides={slides}>
      <section className="gate-card" aria-labelledby="archive-title">
        <p className="eyebrow">Частная коллекция</p>
        <h1 id="archive-title">Семейный фотоархив</h1>
        {session ? (
          <>
            <p>Вы вошли как {session.displayName}. Архив готов к просмотру.</p>
            <Link className="primary-action" href="/archive">Открыть фотографии</Link>
          </>
        ) : (
          <>
            <p>Введите имя и семейный пароль. Ваше имя будет указано рядом с каждым добавленным воспоминанием.</p>
            <LoginForm />
            <p className="owner-entry"><Link href="/owner">Вход владельца архива</Link></p>
          </>
        )}
      </section>
    </ArchiveLanding>
  );
}
