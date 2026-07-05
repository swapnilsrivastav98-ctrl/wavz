import Image from "next/image";
import Link from "next/link";
import { getLibrary } from "@/lib/library";
import { getPresignedGetUrl } from "@/lib/r2";
import LibraryGrid from "@/components/LibraryGrid";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { books } = await getLibrary();

  const booksWithCovers = await Promise.all(
    books.map(async (book) => ({
      ...book,
      coverUrl: book.coverKey ? await getPresignedGetUrl(book.coverKey) : null,
    }))
  );

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/icons/logo-128.png" alt="" width={52} height={52} />
          <h1 className="text-2xl font-semibold tracking-tight">Your library</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/upload"
            className="accent-gradient accent-glow neu-pressable rounded-full px-4 py-2 text-sm font-medium text-white"
          >
            + Add book
          </Link>
          <LogoutButton />
        </div>
      </div>

      {booksWithCovers.length === 0 ? (
        <div className="neu-inset rounded-2xl py-24 text-center text-zinc-400">
          <p className="mb-4">No audiobooks yet.</p>
          <Link href="/upload" className="text-orange-400 hover:text-orange-300">
            Upload your first one →
          </Link>
        </div>
      ) : (
        <LibraryGrid books={booksWithCovers} />
      )}
    </div>
  );
}
