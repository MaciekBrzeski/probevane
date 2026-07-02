// src/mocks/handlers.test.tsx
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './server';
import { fetchProducts, fetchProduct } from '../api';
import { formatPrice, cartTotal, inStockOnly } from '../format';
import { useProducts } from '../useProducts';
import { ProductList } from '../ProductList';
import { App } from '../App';
import products from '../../test-fixtures/products.json';

// ------------------------------------------------------------------
// MSW lifecycle. src/api.ts fetches relative URLs (`/api/products`);
// undici's fetch requires absolute URLs even under MSW node interception,
// so after MSW patches global fetch we wrap it to resolve relative paths
// against the jsdom origin. Committed src stays untouched.
// ------------------------------------------------------------------

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  const mswFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    mswFetch(
      typeof input === 'string' ? new URL(input, window.location.origin) : input,
      init,
    ),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
});

// ------------------------------------------------------------------
// MSW handlers + api.ts fetcher
// ------------------------------------------------------------------

describe('MSW handlers', () => {
  it('fetchProducts returns the canonical fixture', async () => {
    const result = await fetchProducts();
    expect(result).toEqual(products);
  });

  it('fetchProduct returns the sample product', async () => {
    const result = await fetchProduct(1);
    expect(result).toEqual({
      id: 1,
      name: 'sample',
      priceCents: 0,
      inStock: true,
    });
  });

  it('fetchProducts does not mutate the fixture', async () => {
    const before = JSON.stringify(products);
    const result = await fetchProducts();
    result[0].name = 'mutated';
    expect(JSON.stringify(products)).toBe(before);
  });

  it('throws when the server returns an error', async () => {
    server.use(
      http.get('/api/products', () => HttpResponse.json({ error: 'boom' }, { status: 500 }))
    );
    await expect(fetchProducts()).rejects.toThrow('products 500');
  });

  it('fetchProduct throws with the id on a 404', async () => {
    server.use(
      http.get('/api/products/:id', () => HttpResponse.json({ error: 'gone' }, { status: 404 }))
    );
    await expect(fetchProduct(7)).rejects.toThrow('product 7: 404');
  });
});

// ------------------------------------------------------------------
// format.ts pure helpers
// ------------------------------------------------------------------

describe('formatPrice', () => {
  it('formats zero cents', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('formats positive cents', () => {
    expect(formatPrice(1234)).toBe('$12.34');
  });

  it('formats negative cents with the sign after the dollar', () => {
    expect(formatPrice(-99)).toBe('$-0.99');
  });

  it('formats large amounts without grouping separators', () => {
    expect(formatPrice(199999)).toBe('$1999.99');
  });
});

describe('cartTotal', () => {
  it('returns 0 for an empty cart', () => {
    expect(cartTotal([])).toBe(0);
  });

  it('sums quantities', () => {
    const item = {
      product: { id: 1, name: 'A', priceCents: 100, inStock: true },
      qty: 3,
    };
    expect(cartTotal([item])).toBe(300);
  });

  it('sums multiple items', () => {
    const items = [
      { product: { id: 1, name: 'A', priceCents: 100, inStock: true }, qty: 2 },
      { product: { id: 2, name: 'B', priceCents: 250, inStock: true }, qty: 1 },
    ];
    expect(cartTotal(items)).toBe(450);
  });
});

describe('inStockOnly', () => {
  it('returns the fixture unchanged when all products are in stock', () => {
    expect(inStockOnly(products)).toEqual(products);
  });

  it('filters out-of-stock products', () => {
    const mixed = [
      { id: 1, name: 'In', priceCents: 100, inStock: true },
      { id: 2, name: 'Out', priceCents: 200, inStock: false },
    ];
    expect(inStockOnly(mixed)).toEqual([{ id: 1, name: 'In', priceCents: 100, inStock: true }]);
  });

  it('returns an empty array when nothing is in stock', () => {
    const allOut = [{ id: 1, name: 'Out', priceCents: 100, inStock: false }];
    expect(inStockOnly(allOut)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [
      { id: 1, name: 'In', priceCents: 100, inStock: true },
      { id: 2, name: 'Out', priceCents: 200, inStock: false },
    ];
    const before = JSON.stringify(input);
    inStockOnly(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ------------------------------------------------------------------
// useProducts hook — exercised through a probe component so the real
// hook runs against the mocked network (no module mocking).
// ------------------------------------------------------------------

function HookProbe() {
  const { products, loading, error } = useProducts();
  if (loading) return <div data-testid="loading">Loading</div>;
  if (error) return <div data-testid="error">{error}</div>;
  return <div data-testid="count">{products.length}</div>;
}

describe('useProducts', () => {
  it('loads products through the mocked network', async () => {
    render(<HookProbe />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
  });

  it('surfaces a network error', async () => {
    server.use(
      http.get('/api/products', () => HttpResponse.json({ error: 'boom' }, { status: 500 }))
    );
    render(<HookProbe />);
    await waitFor(() => expect(screen.getByTestId('error')).toBeInTheDocument());
    expect(screen.getByTestId('error')).toHaveTextContent('products 500');
  });
});

// ------------------------------------------------------------------
// ProductList component — driven end-to-end through MSW (the real
// useProducts hook), so the loading → data/error transitions are real.
// ------------------------------------------------------------------

describe('ProductList', () => {
  it('shows a loading state before the fetch resolves', async () => {
    render(<ProductList />);
    expect(screen.getByLabelText('status')).toHaveTextContent('Loading…');
    await waitFor(() => expect(screen.getByLabelText('count')).toBeInTheDocument());
  });

  it('shows an error alert when the fetch fails', async () => {
    server.use(
      http.get('/api/products', () => HttpResponse.json({ error: 'boom' }, { status: 500 }))
    );
    render(<ProductList />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load'));
  });

  it('renders the in-stock product count and names', async () => {
    render(<ProductList />);
    await waitFor(() => expect(screen.getByLabelText('count')).toHaveTextContent('2 in stock'));
    expect(screen.getByLabelText('product Item 1')).toBeInTheDocument();
    expect(screen.getByLabelText('product Item 2')).toBeInTheDocument();
  });

  it('hides out-of-stock products', async () => {
    server.use(
      http.get('/api/products', () =>
        HttpResponse.json([
          { id: 1, name: 'Item 1', priceCents: 0, inStock: true },
          { id: 2, name: 'Item 2', priceCents: 0, inStock: false },
        ])
      )
    );
    render(<ProductList />);
    await waitFor(() => expect(screen.getByLabelText('count')).toHaveTextContent('1 in stock'));
    expect(screen.getByLabelText('product Item 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('product Item 2')).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------------
// App component
// ------------------------------------------------------------------

describe('App', () => {
  it('renders the shop heading and product list', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Shop' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('count')).toHaveTextContent('2 in stock'));
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
  });
});
