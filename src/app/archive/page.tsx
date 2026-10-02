import { redirect } from "next/navigation";
import { ArchiveConsole } from "@/components/archive-console";
import { getRuntimeManifest, publicAsset } from "@/lib/archive";
import { getSession } from "@/lib/auth";
import { commentedAssetIds, listAssetMetadata, listCommentPreviews } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const session = await getSession();
  if (!session) redirect("/");
  let manifest;
  try {
    manifest = await getRuntimeManifest();
  } catch {
    return (
      <main className="gate-shell">
        <section className="gate-card">
          <p className="eyebrow">Индекс не создан</p>
          <h1>Архив готовится</h1>
          <p>Владелец должен выполнить <code>npm run index</code>, затем обновить эту страницу.</p>
        </section>
      </main>
    );
  }
  const assets = manifest.assets
    .filter((asset) => !asset.sensitive || session.role === "admin")
    .map(publicAsset);
  const [commentedIds, metadata, commentPreviews] = await Promise.all([commentedAssetIds(), listAssetMetadata(), listCommentPreviews()]);
  return <ArchiveConsole assets={assets} commentedIds={commentedIds} commentPreviews={commentPreviews} metadata={metadata} session={{ displayName: session.displayName, role: session.role }} generatedAt={manifest.generatedAt} canSync={session.role === "admin" && process.env.ARCHIVE_SYNC_ENABLED === "1"} />;
}
