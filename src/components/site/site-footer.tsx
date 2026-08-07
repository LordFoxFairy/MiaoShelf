export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto w-full max-w-6xl space-y-3 px-4 py-8 text-xs text-muted-foreground md:px-6">
        <p className="font-medium text-foreground">MiaoKit Catalog</p>
        {/* 这句是合规要求，不能省（spec §18.3） */}
        <p>
          本站仅展示商品信息并提供跳转，购买、付款、交付及售后均由第三方页面完成。
        </p>
        <p>商品价格与库存以跳转后的第三方页面实时显示为准。</p>
      </div>
    </footer>
  );
}
