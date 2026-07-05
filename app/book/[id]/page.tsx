import { notFound } from "next/navigation";
import { getLibrary } from "@/lib/library";
import { getPresignedGetUrl } from "@/lib/r2";
import Player from "@/components/Player";

export const dynamic = "force-dynamic";

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { books } = await getLibrary();
  const book = books.find((b) => b.id === id);

  if (!book) notFound();

  const [chapterUrls, coverUrl] = await Promise.all([
    Promise.all(book.chapters.map((c) => getPresignedGetUrl(c.key))),
    book.coverKey ? getPresignedGetUrl(book.coverKey) : Promise.resolve(null),
  ]);

  const chapters = book.chapters.map((c, i) => ({
    key: c.key,
    label: c.label,
    duration: c.duration,
    url: chapterUrls[i],
  }));

  return (
    <Player
      // Remount when chapter order changes so playback/progress state resets cleanly.
      key={chapters.map((c) => c.key).join(",")}
      bookId={book.id}
      title={book.title}
      author={book.author}
      chapters={chapters}
      coverUrl={coverUrl}
    />
  );
}
