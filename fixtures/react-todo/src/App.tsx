import { useState } from 'react';

export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

/** Pure helpers — easy unit targets, no DOM needed. */
export function addTodo(list: Todo[], text: string): Todo[] {
  const trimmed = text.trim();
  if (!trimmed) return list;
  const nextId = list.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  return [...list, { id: nextId, text: trimmed, done: false }];
}

export function toggleTodo(list: Todo[], id: number): Todo[] {
  return list.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}

export function removeTodo(list: Todo[], id: number): Todo[] {
  return list.filter((t) => t.id !== id);
}

export function remaining(list: Todo[]): number {
  return list.filter((t) => !t.done).length;
}

export function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTodos((list) => addTodo(list, draft));
    setDraft('');
  };

  return (
    <main>
      <h1>Todos</h1>
      <form onSubmit={submit}>
        <input
          aria-label="New todo"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What needs doing?"
        />
        <button type="submit">Add</button>
      </form>

      <p aria-label="remaining count">{remaining(todos)} remaining</p>

      <ul>
        {todos.map((t) => (
          <li key={t.id}>
            <label>
              <input
                type="checkbox"
                checked={t.done}
                aria-label={`toggle ${t.text}`}
                onChange={() => setTodos((list) => toggleTodo(list, t.id))}
              />
              <span style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
            </label>
            <button aria-label={`delete ${t.text}`} onClick={() => setTodos((list) => removeTodo(list, t.id))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
