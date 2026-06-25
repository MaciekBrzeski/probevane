import type { Product } from './api.js';

/** Pure helpers — easy unit targets, no mocking needed. */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface CartItem {
  product: Product;
  qty: number;
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.product.priceCents * i.qty, 0);
}

export function inStockOnly(products: Product[]): Product[] {
  return products.filter((p) => p.inStock);
}
