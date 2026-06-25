import { useState } from 'react';

export interface SignupErrors {
  name?: string;
  email?: string;
}

/** Pure validation — easy unit targets. */
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateSignup(name: string, email: string): SignupErrors {
  const errors: SignupErrors = {};
  if (!name.trim()) errors.name = 'Name is required';
  if (!email.trim()) errors.email = 'Email is required';
  else if (!validateEmail(email)) errors.email = 'Email is invalid';
  return errors;
}

export function isValid(errors: SignupErrors): boolean {
  return Object.keys(errors).length === 0;
}

export function App() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<SignupErrors>({});
  const [members, setMembers] = useState<string[]>([]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateSignup(name, email);
    setErrors(errs);
    if (!isValid(errs)) return;
    setMembers((m) => [...m, `${name.trim()} <${email.trim()}>`]);
    setName('');
    setEmail('');
  };

  return (
    <main>
      <h1>Sign up</h1>
      <form onSubmit={submit} noValidate>
        <label>
          Name
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {errors.name && <p role="alert" aria-label="name error">{errors.name}</p>}

        <label>
          Email
          <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {errors.email && <p role="alert" aria-label="email error">{errors.email}</p>}

        <button type="submit">Register</button>
      </form>

      <p aria-label="member count">{members.length} members</p>
      <ul>
        {members.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </main>
  );
}
