import Link from "next/link";
import { Rocket, Search } from "lucide-react";

import { listPublicCategories } from "@/lib/queries/public";

export async function SiteHeader() {
  const categories = await listPublicCategories();

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Rocket className="size-4" />
          </span>
          <span className="text-sm font-semibold">MiaoKit Catalog</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {categories.slice(0, 5).map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {category.name}
            </Link>
          ))}
        </nav>

        <form action="/search" className="ml-auto hidden sm:block">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              placeholder="搜索商品…"
              className="h-9 w-48 rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/20 md:w-56"
            />
          </div>
        </form>
      </div>
    </header>
  );
}
