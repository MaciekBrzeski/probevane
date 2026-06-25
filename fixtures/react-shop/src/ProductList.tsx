import { useProducts } from './useProducts.js';
import { formatPrice, inStockOnly } from './format.js';

/** Renders the catalog. Depends on useProducts (network) + format (pure). */
export function ProductList() {
  const { products, loading, error } = useProducts();

  if (loading) return <p aria-label="status">Loading…</p>;
  if (error) return <p aria-label="status" role="alert">Failed to load</p>;

  const visible = inStockOnly(products);
  return (
    <section>
      <h2>Products</h2>
      <p aria-label="count">{visible.length} in stock</p>
      <ul>
        {visible.map((p) => (
          <li key={p.id} aria-label={`product ${p.name}`}>
            {p.name} — {formatPrice(p.priceCents)}
          </li>
        ))}
      </ul>
    </section>
  );
}
