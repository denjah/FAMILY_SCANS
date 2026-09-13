import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntimeManifest } from "@/lib/archive";
import { getSession } from "@/lib/auth";
import { listAllComments } from "@/lib/db";
import type { CommentKind } from "@/types/archive";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<CommentKind, string> = {
  memory: "Воспоминание",
  identification: "Кто на снимке",
  date_suggestion: "Предположение о дате",
  correction: "Уточнение",
  comment: "Комментарий",
};

export default async function OwnerCommentsPage() {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/owner");

  const [manifest, comments] = await Promise.all([getRuntimeManifest(), listAllComments()]);
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));

  return <main className="audit-shell">
    <header className="audit-header">
      <div>
        <p className="eyebrow">Режим владельца · журнал</p>
        <h1>Добавленные комментарии</h1>
        <p className="audit-summary">Здесь видны только реально сохранённые записи из общего хранилища — с автором, временем и привязкой к фотографии.</p>
      </div>
      <Link className="secondary-action" href="/archive">← К архиву</Link>
    </header>

    <p className="audit-summary">Всего записей: {comments.length}</p>
    <div className="table-wrap">
      <table className="asset-table comments-table">
        <thead><tr><th>Когда</th><th>Автор</th><th>Фотография</th><th>Ветвь</th><th>Тип</th><th>Текст</th></tr></thead>
        <tbody>{comments.map((comment) => {
          const asset = assets.get(comment.assetId);
          return <tr key={comment.id}>
            <td><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time></td>
            <td>{comment.authorDisplayName}</td>
            <td><Link href={`/archive?photo=${encodeURIComponent(comment.assetId)}`}>{asset?.title || "Фотография вне текущего индекса"}</Link></td>
            <td>{asset?.branch || "—"}</td>
            <td>{KIND_LABEL[comment.kind]}</td>
            <td className="comment-body">{comment.body}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!comments.length && <section className="empty-state"><h2>Записей пока нет</h2><p>Когда Алла сохранит комментарий у фотографии, он появится в этой таблице.</p></section>}
  </main>;
}
