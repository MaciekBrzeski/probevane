import { useEffect, useState } from 'react';
import { fetchProducts, type Product } from './api.js';

export interface ProductsState {
  products: Product[];
  loading: boolean;
  error: string | null;
}

/** Load products on mount. Depends on the network via fetchProducts. */
export function useProducts(): ProductsState {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProducts()
      .then((p) => {
        if (alive) {
          setProducts(p);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return { products, loading, error };
}
