export interface Product {
  id: number;
  name: string;
  priceCents: number;
  inStock: boolean;
}

const BASE = '/api';

/** Fetch the product catalog. Real network call — must be mocked in tests. */
export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch(`${BASE}/products`);
  if (!res.ok) throw new Error(`products ${res.status}`);
  return (await res.json()) as Product[];
}

/** Fetch one product by id. */
export async function fetchProduct(id: number): Promise<Product> {
  const res = await fetch(`${BASE}/products/${id}`);
  if (!res.ok) throw new Error(`product ${id}: ${res.status}`);
  return (await res.json()) as Product;
}
